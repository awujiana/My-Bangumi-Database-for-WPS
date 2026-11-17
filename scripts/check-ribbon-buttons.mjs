#!/usr/bin/env node
/**
 * @fileoverview 校验 ribbon.xml 声明的按钮与 ts/ribbon.ts 的处理表 / 图标表一致
 *
 * 背景（见 文档/TS_AUDIT_2026_09_10.md 的 P2-9「平行清单」）：
 *   按钮 ID 在 `ribbon.xml` 与 `ts/ribbon.ts` 两处维护。两侧不同步时的表现是
 *   **静默失效**：按钮点下去没有任何反应，只在日志里留一条 `[BGM] 未知按钮: xxx`。
 *   这类「同一信息多处维护、改错一处不报错」的形态在本仓库反复出现，故用门禁兜住。
 *
 * 校验内容：
 *   1. `ribbon.xml` 每个 `<button>` 的 id 都在 `ts/ribbon.ts` 的分发表里
 *      （`SYNC_ACTIONS` ∪ `ASYNC_ACTIONS`）——否则点击无反应；
 *   2. 每个 id 都在 `ICON_PATHS` 里，且图标文件真实存在——否则功能区显示占位图；
 *   3. `ICON_PATHS` 没有多余键（指向已删除按钮的孤儿图标）；
 *   4. `ribbon.xml` 引用的 `onAction` / `getImage` 回调函数在 `ts/ribbon.ts` 中确有导出
 *      ——属性名写错同样会静默失效；
 *   5. 分发表与图标表都非空 —— 否则说明本脚本的解析失效，必须报错而不是「0 问题」空转。
 *
 * 退出码：0 一致；1 不一致（并打印修复指引）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 读取文件内容（缺失/不可读时抛出带路径的可读错误） */
function readText(relativePath) {
  const absolutePath = join(projectRoot, relativePath)
  try {
    return readFileSync(absolutePath, 'utf8')
  } catch {
    throw new Error(`无法读取 ${relativePath}（预期路径：${absolutePath}）`)
  }
}

/**
 * 解析 `ribbon.xml` 中所有 `<button>` 标签的属性
 * @returns {{ id: string, onAction: string, getImage: string }[]}
 */
function readXmlButtons(xml) {
  const buttons = []
  for (const matched of xml.matchAll(/<button\b[^>]*>/gu)) {
    const tag = matched[0]
    const id = /\bid="([^"]+)"/u.exec(tag)?.[1] ?? ''
    if (id === '') continue
    buttons.push({
      id,
      onAction: /\bonAction="([^"]+)"/u.exec(tag)?.[1] ?? '',
      getImage: /\bgetImage="([^"]+)"/u.exec(tag)?.[1] ?? '',
    })
  }
  return buttons
}

/**
 * 从 `ts/ribbon.ts` 中提取某个对象常量的源码块
 * @param {string} source - ts/ribbon.ts 源码
 * @param {string} constantName - 常量名，如 `ICON_PATHS`
 * @returns {string} 花括号内的源码
 */
function readRecordBody(source, constantName) {
  // 形如：const ICON_PATHS: Record<string, string> = { key: 'value', ... }
  // 必须用 String.raw 构造：普通模板字面量会把 \b / \s 当作转义序列吃掉。
  // 按「第一个 {」切分而非按「=」切分 —— 类型标注里可能含 `=>`（如 SYNC_ACTIONS
  // 的 `Record<string, () => unknown>`），用 [^=]* 会撞上箭头函数的等号。
  const pattern = String.raw`const ${constantName}\b[^{]*\{([^}]*)\}`
  const block = new RegExp(pattern, 'u').exec(source)
  if (block === null || block[1] === undefined) {
    throw new Error(`ts/ribbon.ts 中未找到常量 ${constantName} 的定义（解析规则可能已失效）`)
  }
  return block[1]
}

/**
 * 从 `ts/ribbon.ts` 中提取某个对象常量的键
 * @returns {string[]}
 */
function readRecordKeys(source, constantName) {
  return [...readRecordBody(source, constantName).matchAll(/^\s*(\w+)\s*:/gmu)]
    .map((matched) => matched[1] ?? '')
    .filter((key) => key !== '')
}

/**
 * 从 `ts/ribbon.ts` 中提取某对象常量的「键 → 字符串值」映射
 * @returns {Record<string, string>}
 */
function readRecordValueMap(source, constantName) {
  const map = {}
  for (const matched of readRecordBody(source, constantName).matchAll(
    /^\s*(\w+)\s*:\s*'([^']*)'/gmu,
  )) {
    if (matched[1] !== undefined && matched[2] !== undefined) map[matched[1]] = matched[2]
  }
  return map
}

/** 在 ts/ribbon.ts 中查找导出的函数名集合 */
function readExportedFunctions(source) {
  return new Set(
    [...source.matchAll(/export function\s+(\w+)/gu)].map((matched) => matched[1] ?? ''),
  )
}

function main() {
  const xml = readText('ribbon.xml')
  const ribbonSource = readText('ts/ribbon.ts')

  const buttons = readXmlButtons(xml)
  const syncKeys = readRecordKeys(ribbonSource, 'SYNC_ACTIONS')
  const asyncKeys = readRecordKeys(ribbonSource, 'ASYNC_ACTIONS')
  const iconPaths = readRecordValueMap(ribbonSource, 'ICON_PATHS')
  const iconKeys = Object.keys(iconPaths)
  const exportedFunctions = readExportedFunctions(ribbonSource)

  // 解析结果自检：任何一张表为空都说明解析失效，必须报错而非静默通过
  const problems = []
  if (buttons.length === 0) problems.push('ribbon.xml 未解析出任何 <button>，本脚本解析规则可能已失效')
  if (syncKeys.length === 0) problems.push('ts/ribbon.ts 未解析出 SYNC_ACTIONS 的键')
  if (asyncKeys.length === 0) problems.push('ts/ribbon.ts 未解析出 ASYNC_ACTIONS 的键')
  if (iconKeys.length === 0) problems.push('ts/ribbon.ts 未解析出 ICON_PATHS 的键')

  const handledKeys = new Set([...syncKeys, ...asyncKeys])
  const xmlIds = new Set()
  const duplicateIds = []

  for (const button of buttons) {
    if (xmlIds.has(button.id)) duplicateIds.push(button.id)
    xmlIds.add(button.id)

    if (!handledKeys.has(button.id)) {
      problems.push(
        `按钮 ${button.id} 在 ribbon.xml 中声明，但 ts/ribbon.ts 的 SYNC_ACTIONS/ASYNC_ACTIONS 都没有它 —— 点击将静默无反应`,
      )
    }
    if (!iconKeys.includes(button.id)) {
      problems.push(
        `按钮 ${button.id} 在 ICON_PATHS 中没有条目 —— 功能区将显示占位图 newFromTemp.svg`,
      )
    }
    if (button.onAction !== '' && !exportedFunctions.has(button.onAction)) {
      problems.push(`按钮 ${button.id} 的 onAction="${button.onAction}" 在 ts/ribbon.ts 中没有对应导出函数`)
    }
    if (button.getImage !== '' && !exportedFunctions.has(button.getImage)) {
      problems.push(`按钮 ${button.id} 的 getImage="${button.getImage}" 在 ts/ribbon.ts 中没有对应导出函数`)
    }
  }

  for (const duplicateId of duplicateIds) {
    problems.push(`ribbon.xml 中按钮 id 重复：${duplicateId}`)
  }

  // ICON_PATHS 反向检查：不得残留已删除按钮的孤儿图标键
  for (const iconKey of iconKeys) {
    if (!xmlIds.has(iconKey)) {
      problems.push(`ICON_PATHS 中的 ${iconKey} 在 ribbon.xml 中没有对应按钮（孤儿图标条目）`)
    }
  }

  // 图标文件必须真实存在
  for (const [iconKey, iconPath] of Object.entries(iconPaths)) {
    if (!existsSync(join(projectRoot, iconPath))) {
      problems.push(`按钮 ${iconKey} 的图标文件不存在：${iconPath}`)
    }
  }

  if (problems.length > 0) {
    console.error('✖ Ribbon 按钮一致性校验失败：')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error(
      '\n修复方式：按钮 ID 需在**同一处**保持同步 ——\n' +
        '  1) ribbon.xml 的 <button id="..."> 增加/删除按钮\n' +
        '  2) ts/ribbon.ts 的 SYNC_ACTIONS（同步）或 ASYNC_ACTIONS（异步）补对应条目\n' +
        '  3) 同文件 ICON_PATHS 补图标路径，并确认 images/ 下文件存在\n' +
        '原因：两侧不同步时按钮点击静默无反应，只在日志里留一条 WARN，真机上难以察觉。',
    )
    process.exit(1)
  }

  console.log(
    `✔ Ribbon 按钮一致：ribbon.xml ${String(buttons.length)} 个按钮 == ` +
      `分发表 ${String(syncKeys.length)} 同步 + ${String(asyncKeys.length)} 异步，` +
      `图标 ${String(iconKeys.length)} 个`,
  )
}

main()
