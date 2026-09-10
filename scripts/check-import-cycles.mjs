#!/usr/bin/env node
/**
 * @fileoverview 导入图环检测 + 分层违规检测（基于 TypeScript AST）
 *
 * 背景（见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）：
 *   本项目大量使用 barrel（`ts/index.ts`、`tools/util/index.ts`）再导出。一旦底层模块
 *   （tools/ sync/）反向 import 上层（ui/），分层就被破坏，模块初始化顺序变得敏感。
 *
 * ⚠️ 两个关键区分（否则满屏假阳性，噪声淹没真问题）：
 *
 *   1. **运行时边 vs 类型边**
 *      `import type` / `export type` 只参与编译期检查，编译产物里没有对应 import 语句，
 *      因此**不产生**运行时依赖。把类型边算成环是历史上本项目"环很多"的主因。
 *
 *   2. **致命环 vs 良性环**（本脚本的核心判据）
 *      ESM 的 import 是 live binding：环本身不必然出错。真正会炸的是
 *      **在模块顶层读取了环上另一模块的绑定** —— 此时对方模块body还没执行，
 *      拿到 `undefined`（本项目历史上踩过：barrel 顶层读 CONFIG_KEYS 得到 undefined）。
 *      函数体内读取是安全的（调用时模块早已初始化完毕）。
 *      所以：环 = 提示；**环 + 顶层读取 = 错误**。
 *
 * 判定为错误（退出码 1）：
 *   A. 分层反向依赖：底层（tools/ sync/ core/）runtime-import 上层（ui/ panel/ services/）
 *   B. 致命环：某个环上至少有一条边，其被导入的绑定在导入方的**顶层**被读取
 *
 * 仅提示（退出码 0）：
 *   C. 良性环：环上所有边都只在函数体内使用被导入的绑定（live binding，安全）
 *
 * 用法：
 *   node scripts/check-import-cycles.mjs
 */

import { readFileSync, globSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 收集 ts/ 下所有 .ts 文件（相对项目根、统一用 / 分隔） */
function collectSourceFiles() {
  return globSync('ts/**/*.ts', { cwd: projectRoot })
    .filter((f) => statSync(join(projectRoot, f)).isFile())
    .map((f) => f.split(sep).join('/'))
}

/** 把 import 说明符解析为相对项目根的 .ts 路径（解析不到 ts/ 内文件时返回 null） */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const absolute = resolve(dirname(join(projectRoot, fromFile)), specifier)
  let target = relative(projectRoot, absolute).split(sep).join('/')
  if (target.endsWith('.js')) target = `${target.slice(0, -3)}.ts`
  else if (!target.endsWith('.ts')) target = `${target}.ts`
  return target
}

/** 判断 named imports/exports 的元素是否全部带 type 前缀（混合导入仍是运行时边） */
function allElementsTypeOnly(elements) {
  return (
    elements !== undefined &&
    elements.length > 0 &&
    elements.every((element) => element.isTypeOnly === true)
  )
}

/**
 * 解析单个文件。
 * @returns {{
 *   runtime: Map<string, Set<string>>,   // 目标模块 → 从它导入的本地绑定名（空 Set = 副作用导入/再导出）
 *   typeOnly: Set<string>,
 *   topLevelReads: Set<string>,          // 顶层被读取的标识符名
 * }}
 */
function analyzeFile(relativePath) {
  const source = ts.createSourceFile(
    relativePath,
    readFileSync(join(projectRoot, relativePath), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  const runtime = new Map()
  const typeOnly = new Set()

  const record = (target, isTypeEdge, bindings) => {
    if (target === null) return
    if (isTypeEdge) {
      typeOnly.add(target)
      return
    }
    const existing = runtime.get(target) ?? new Set()
    for (const name of bindings) existing.add(name)
    runtime.set(target, existing)
  }

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const target = resolveSpecifier(relativePath, statement.moduleSpecifier.text)
      const clause = statement.importClause
      const bindings = []
      let isTypeEdge = clause?.isTypeOnly === true
      if (clause) {
        if (clause.name) bindings.push(clause.name.text)
        const named = clause.namedBindings
        if (named && ts.isNamespaceImport(named)) bindings.push(named.name.text)
        if (named && ts.isNamedImports(named)) {
          for (const element of named.elements) bindings.push(element.name.text)
          if (allElementsTypeOnly(named.elements)) isTypeEdge = true
        }
      }
      record(target, isTypeEdge, bindings)
      continue
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const target = resolveSpecifier(relativePath, statement.moduleSpecifier.text)
      const clause = statement.exportClause
      const bindings = []
      let isTypeEdge = statement.isTypeOnly
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) bindings.push(element.name.text)
        if (allElementsTypeOnly(clause.elements)) isTypeEdge = true
      }
      record(target, isTypeEdge, bindings)
      continue
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const expression = statement.moduleReference.expression
      if (ts.isStringLiteral(expression)) {
        record(resolveSpecifier(relativePath, expression.text), statement.isTypeOnly, [
          statement.name.text,
        ])
      }
    }
  }

  return { runtime, typeOnly, topLevelReads: collectTopLevelReads(source) }
}

/**
 * 判断某标识符是否构成「对导入绑定的读取」。
 *
 * 需要排除三类**同名但非读取**的标识符，否则会大面积假阳性：
 *   - 类型位置（`: Foo` / `as Foo` / `Record<string, Foo>`）：编译后不存在，且与运行时无关
 *   - 属性名 / 方法名（`showToast: (ctx) => {...}` 里的 `showToast` 只是键名）
 *   - 声明名与解构绑定名（`const { a } = x` 里的 `a` 是绑定，不是读取）
 * 反例（**是**读取，必须保留）：对象字面量简写 `{ showToast }`、类 heritage `extends Foo`。
 */
function isBindingRead(node) {
  const parent = node.parent
  if (parent === undefined) return false

  // 类型节点范围：编译后整段消失
  const kind = parent.kind
  if (kind >= ts.SyntaxKind.FirstTypeNode && kind <= ts.SyntaxKind.LastTypeNode) return false

  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  ) {
    return false
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isQualifiedName(parent)) return false
  if (ts.isBindingElement(parent)) return false
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false
  if (ts.isParameter(parent)) return false
  if (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent)
  ) {
    return false
  }
  if (
    ts.isLabeledStatement(parent) ||
    ts.isBreakStatement(parent) ||
    ts.isContinueStatement(parent)
  ) {
    return false
  }
  return true
}

/**
 * 收集「模块顶层执行时读取」的标识符名。
 *
 * 剪枝规则：不进入任何函数体（函数体是延后执行，读 live binding 安全），
 * 但**保留**类的 heritage（`extends`）与属性初始化器 —— 它们在类定义时就求值。
 */
function collectTopLevelReads(source) {
  const reads = new Set()

  const walk = (node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isClassStaticBlockDeclaration(node)
    ) {
      return
    }
    if (ts.isIdentifier(node) && isBindingRead(node)) reads.add(node.text)
    ts.forEachChild(node, walk)
  }

  for (const statement of source.statements) {
    // 导入/再导出语句本身不是「读取」；类型声明编译后不存在，也不参与判环
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      continue
    }
    // `declare const x: T` 是环境声明，不产生运行时求值
    if (statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
    // 函数/类声明本身不执行内部逻辑 —— 只走 heritage 与属性初始化器
    if (ts.isFunctionDeclaration(statement)) continue
    if (ts.isClassDeclaration(statement)) {
      walk(statement.heritageClauses ?? [])
      for (const member of statement.members) {
        if (ts.isPropertyDeclaration(member) && member.initializer) walk(member.initializer)
      }
      continue
    }
    walk(statement)
  }

  return reads
}

/** 构建邻接表（只保留指向 ts/ 内已存在文件的边） */
function buildGraph(files) {
  const known = new Set(files)
  const runtime = new Map()
  const unsafeEdges = new Set()

  for (const file of files) {
    const { runtime: edges, topLevelReads } = analyzeFile(file)
    const kept = new Map()
    for (const [target, bindings] of edges) {
      if (!known.has(target)) continue
      kept.set(target, bindings)
      // 顶层读取了对方导出的绑定 → TDZ 风险（对方模块 body 可能尚未执行）
      if ([...bindings].some((name) => topLevelReads.has(name))) {
        unsafeEdges.add(`${file} -> ${target}`)
      }
    }
    runtime.set(file, kept)
  }
  return { runtime, unsafeEdges }
}

/** 找出所有环（DFS + 栈回溯），返回归一化去重后的环 */
function findCycles(graph) {
  const cycles = []
  const seen = new Set()
  const stack = []
  const onStack = new Set()
  const visited = new Set()

  const walk = (node) => {
    visited.add(node)
    stack.push(node)
    onStack.add(node)

    for (const next of graph.get(node).keys()) {
      if (onStack.has(next)) {
        const cycle = stack.slice(stack.indexOf(next))
        const minIndex = cycle.indexOf([...cycle].sort()[0])
        const normalized = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)]
        const key = normalized.join(' -> ')
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push(normalized)
        }
        continue
      }
      if (!visited.has(next)) walk(next)
    }

    stack.pop()
    onStack.delete(node)
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) walk(node)
  }
  return cycles
}

/** 分层：tools/ sync/ core/ 为底层，ui/ panel/ services/ 为上层，entry 负责组装 */
function layerOf(path) {
  if (path.startsWith('ts/ui/') || path.startsWith('ts/panel/')) return 'upper'
  if (path.startsWith('ts/services/')) return 'upper'
  if (path.startsWith('ts/entry/')) return 'entry'
  if (path === 'ts/index.ts' || path === 'ts/ribbon.ts') return 'entry'
  return 'lower'
}

/** 找出底层 → 上层的反向依赖 */
function findLayerViolations(graph) {
  const violations = []
  for (const [from, targets] of graph) {
    if (layerOf(from) !== 'lower') continue
    for (const to of targets.keys()) {
      if (layerOf(to) === 'upper') violations.push({ from, to })
    }
  }
  return violations
}

/** 判断一个环上是否含有「顶层读取」的边（有则是致命环） */
function isFatalCycle(cycle, unsafeEdges) {
  for (let index = 0; index < cycle.length; index += 1) {
    const from = cycle[index]
    const to = cycle[(index + 1) % cycle.length]
    if (unsafeEdges.has(`${from} -> ${to}`)) return true
  }
  return false
}

function main() {
  const files = collectSourceFiles()
  const { runtime, unsafeEdges } = buildGraph(files)
  const cycles = findCycles(runtime)
  const violations = findLayerViolations(runtime)
  const fatalCycles = cycles.filter((cycle) => isFatalCycle(cycle, unsafeEdges))

  const runtimeEdges = [...runtime.values()].reduce((sum, m) => sum + m.size, 0)
  console.log(
    `扫描 ${files.length} 个 ts/ 模块：运行时边 ${runtimeEdges} 条，顶层跨模块读取（TDZ 风险边）${unsafeEdges.size} 条`,
  )

  if (violations.length > 0) {
    console.log(`\n✖ 分层反向依赖 ${violations.length} 处（底层 runtime-import 上层）：`)
    for (const { from, to } of violations) console.log(`  ${from}  →  ${to}`)
    console.log('  修法：底层依赖 core/ui-bridge.ts 的接口 + getXxxApi()，由 UI 层注册实现。')
  } else {
    console.log('\n✔ 无分层反向依赖（tools/sync/core 未 runtime-import ui/panel/services）')
  }

  if (fatalCycles.length > 0) {
    console.log(
      `\n✖ 致命循环依赖 ${fatalCycles.length} 个（环 + 顶层读取，会在初始化期拿到 undefined）：`,
    )
    for (const cycle of fatalCycles) console.log(`  ${[...cycle, cycle[0]].join(' → ')}`)
  } else {
    console.log('✔ 无致命循环依赖（不存在「环 + 顶层读取」的组合）')
  }

  const benignCycles = cycles.length - fatalCycles.length
  if (benignCycles > 0) {
    console.log(
      `\n· 良性循环依赖 ${benignCycles} 个（环上的绑定只在函数体内使用，ESM live binding 下安全，仅提示）：`,
    )
    for (const cycle of cycles) {
      if (!isFatalCycle(cycle, unsafeEdges)) console.log(`  ${[...cycle, cycle[0]].join(' → ')}`)
    }
  }

  if (violations.length > 0 || fatalCycles.length > 0) {
    if (process.argv.includes('--edges')) {
      console.log('\n— 顶层跨模块读取（TDZ 风险边，供修复定位）—')
      for (const edge of [...unsafeEdges].sort()) console.log(`  ${edge}`)
    }
    process.exit(1)
  }
}

main()
