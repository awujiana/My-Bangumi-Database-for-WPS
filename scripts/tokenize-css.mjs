#!/usr/bin/env node
/* ============================================================================
 * tokenize-css.mjs —— 把 CSS 中可映射到设计 token 的硬编码 hex 替换为 var(--token)
 * ----------------------------------------------------------------------------
 * 策略（见审计 P2-12）：
 *   1. 解析项目中所有 :root / [data-theme] 块，构建「规范化 hex 值 → token 名」映射。
 *      这样 styles.css 自身 :root 里的 legacy Catppuccin 变量（--green/--yellow/--red 等）
 *      和 tokens.css 的共享 token 都能被识别。
 *   2. 对目标文件逐处扫描 hex 字面量：
 *      - 跳过 var() 内部（含 fallback）、url()/data: URI、rgba()/hsla()；
 *      - 跳过纯黑/纯白（#000/#000000/#fff/#ffffff）等歧义色——上下文不明，
 *        映射到 --bg-app/--primary-strong 可能反而在浅色下出错；
 *      - 命中映射 → 替换为 var(--token)（深色下零渲染变化，浅色下跟随主题）。
 *   3. 输出报告：已替换（按 token 计数）、歧义跳过、未命中（保留，附频率）。
 *
 * 默认 dry-run（只报告不写盘）。加 --write 才落盘。
 * 用法：node scripts/tokenize-css.mjs [--write] [file1.css file2.css ...]
 * ==========================================================================*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const targets = args.filter((a) => !a.startsWith('--'))

// ---- 1. 构建值→token 映射 ----
// 安全原则：映射源 ONLY 取 tokens.css 的规范、可主题化 token；
// 同时收集「styles.css 自身 :root 重定义过的同名 token」作为排除集 ——
// 若 styles.css 用同名不同值重定义了某个 token（如 legacy Catppuccin --red），
// 替换字面量为 var(--red) 会解析到 styles.css 自己的值，造成深色渲染变化（回归）。
const tokenRe = /(--[A-Za-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g

const TOKENS_FILE = 'css/tokens.css'
const valueToTokens = new Map() // normalized hex -> Set(tokenName)
if (existsSync(resolve(ROOT, TOKENS_FILE))) {
  const src = readFileSync(resolve(ROOT, TOKENS_FILE), 'utf8')
  // 只取 :root（默认/深色）块的值；[data-theme=light] 等覆盖块的值不计入，
  // 否则会把「固定展示其它主题」的字面量（如浅色预览色板 #f5f6f8）误映射成
  // var(--bg-app)，导致深色下显示错误。
  const rootBlocks = src.match(/:root\s*\{([^}]*)\}/g) || []
  for (const block of rootBlocks) {
    let m
    tokenRe.lastIndex = 0
    while ((m = tokenRe.exec(block))) {
      const name = m[1]
      const norm = normalizeHex(m[2])
      if (!norm) continue
      if (!valueToTokens.has(norm)) valueToTokens.set(norm, new Set())
      valueToTokens.get(norm).add(name)
    }
  }
}

// 排除集：styles.css :root 中声明过的同名 token（无论值是否相同，一律不自动映射）
const stylesRedefined = new Set()
if (existsSync(resolve(ROOT, 'css/styles.css'))) {
  const src = readFileSync(resolve(ROOT, 'css/styles.css'), 'utf8')
  const rootBlock = src.match(/:root\s*\{([^}]*)\}/)
  if (rootBlock) {
    let m
    tokenRe.lastIndex = 0
    const inner = rootBlock[1]
    const re = /(--[A-Za-z0-9-]+)\s*:/g
    while ((m = re.exec(inner))) stylesRedefined.add(m[1])
  }
}

// 歧义色：跳过（纯黑/纯白，上下文不明）
const AMBIGUOUS = new Set(['#000000', '#ffffff', '#000', '#fff'])

function normalizeHex(hex) {
  let h = hex.toLowerCase().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 6) return '#' + h
  if (h.length === 8) return '#' + h // 8 位保留原样（tokens 无 8 位实色，不会命中）
  return null // 4/5/7 位等异常长度，丢弃
}

// ---- 2. 逐文件替换 ----
const files = targets.length ? targets : ['css/styles.css']
const summary = []

for (const rel of files) {
  const abs = resolve(ROOT, rel)
  if (!existsSync(abs)) {
    console.error(`跳过（不存在）: ${rel}`)
    continue
  }
  const src = readFileSync(abs, 'utf8')
  const replaced = new Map() // token -> count
  const ambiguousSkipped = new Map() // hex -> count
  const unmatched = new Map() // hex -> count

  // 匹配 hex，但排除：在 var(...)、url(...)、data: 内，或作为自定义属性声明的 RHS
  const hexRe = /(var\(\s*[^)]*?\))|(url\([^)]*\))|(#([0-9a-fA-F]{3,8})\b)/g
  let out = ''
  let last = 0
  let m
  hexRe.lastIndex = 0
  while ((m = hexRe.exec(src))) {
    out += src.slice(last, m.index)
    if (m[1] || m[2]) {
      // var() 或 url() 原样保留
      out += m[0]
    } else {
      const raw = m[3]
      // 跳过「自定义属性声明 RHS」：--name: #hex（token 定义本就该硬编码，不应改写）
      const lineStart = src.lastIndexOf('\n', m.index - 1) + 1
      const linePrefix = src.slice(lineStart, m.index)
      if (/--[A-Za-z0-9-]+\s*:\s*$/.test(linePrefix.trimEnd())) {
        unmatched.set(raw, (unmatched.get(raw) || 0) + 1)
        out += raw
        last = hexRe.lastIndex
        continue
      }
      const norm = normalizeHex(raw)
      if (!norm) {
        out += raw
      } else if (AMBIGUOUS.has(norm)) {
        ambiguousSkipped.set(norm, (ambiguousSkipped.get(norm) || 0) + 1)
        out += raw
      } else if (valueToTokens.has(norm)) {
        // 取一个不在 stylesRedefined 排除集内的 token（优先字母序首个，稳定）
        const candidates = [...valueToTokens.get(norm)].filter((t) => !stylesRedefined.has(t))
        if (candidates.length === 0) {
          unmatched.set(norm, (unmatched.get(norm) || 0) + 1)
          out += raw
        } else {
          const chosen = candidates.sort((a, b) => a.localeCompare(b))[0]
          replaced.set(chosen, (replaced.get(chosen) || 0) + 1)
          out += `var(${chosen})`
        }
      } else {
        unmatched.set(norm, (unmatched.get(norm) || 0) + 1)
        out += raw
      }
    }
    last = hexRe.lastIndex
  }
  out += src.slice(last)

  const repTotal = [...replaced.values()].reduce((a, b) => a + b, 0)
  const uniqUnmatched = unmatched.size

  summary.push({ rel, repTotal, replaced, ambiguousSkipped, unmatched, uniqUnmatched, changed: out !== src })

  if (WRITE && out !== src) writeFileSync(abs, out)
}

// ---- 3. 报告 ----
console.log('='.repeat(72))
console.log(`tokenize-css  ${WRITE ? '[WRITE 模式]' : '[DRY-RUN 模式]'}`)
console.log(`已知 token 值映射数: ${valueToTokens.size}`)
console.log('='.repeat(72))
for (const s of summary) {
  console.log(`\n## ${s.rel}`)
  console.log(`  替换总数: ${s.repTotal}  |  新命中 token 种类: ${s.replaced.size}  |  文件变更: ${s.changed}`)
  if (s.replaced.size) {
    console.log('  已替换（token → 次数）:')
    for (const [t, c] of [...s.replaced.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`    ${t.padEnd(22)} ${c}`)
  }
  if (s.ambiguousSkipped.size) {
    console.log('  歧义跳过（纯黑/纯白，保留）:')
    for (const [h, c] of s.ambiguousSkipped) console.log(`    ${h} ×${c}`)
  }
  if (s.unmatched.size) {
    console.log(`  未命中（保留，共 ${s.uniqUnmatched} 种）: ` + [...s.unmatched.keys()].join(' '))
  }
}
