#!/usr/bin/env node
/**
 * @fileoverview 生成语言包清单 `locales/index.js`
 *
 * ## 为什么要有清单
 *
 * 「设置页下载语言包」需要先知道：发布端有哪些语言、每个包多大、哈希是多少、
 * 覆盖率多少。这些信息只能由**构建侧**算出来——运行时算不了「发布端那份文件
 * 长什么样」。
 *
 * ## 为什么是 `.js` 不是 `.json`
 *
 * 和语言包同一个理由：安装态页面跑在 `file://` 下，`fetch` 读本地文件会被 CEF
 * 拦掉（真机实测 `Failed to fetch`），只有 ESM 的 `import()` 能读。清单也要在
 * 运行时读，所以只能是 ESM。内容仍是纯数据。
 *
 * ## 为什么哈希要对 LF 归一
 *
 * 工作区是 `core.autocrlf=true`（检出成 CRLF，提交成 LF），而发布出去的是 LF。
 * 直接哈希工作区字节，在 CRLF 检出上会算出一个**永远对不上发布端**的值。
 * 所以先 `\r\n → \n` 再哈希，`bytes` 也按归一后的长度算——那才是用户下载到的字节。
 *
 * ## 用法
 *
 *   node scripts/gen-locale-index.mjs            # 写盘
 *   node scripts/gen-locale-index.mjs --check    # 只比对，不一致退出 1（门禁用）
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_LOCALE = 'zh-CN'
const SCHEMA_VERSION = 1
const INDEX_PATH = 'locales/index.js'

/** 读文件（缺失时抛出带路径的可读错误） */
function readText(relativePath) {
  const absolutePath = join(projectRoot, relativePath)
  try {
    return readFileSync(absolutePath, 'utf8')
  } catch {
    throw new Error(`无法读取 ${relativePath}（预期路径：${absolutePath}）`)
  }
}

/**
 * 解析语言包模块源码（`export default {…};`）→ 对象
 *
 * 与 `check-i18n-consistency.mjs` 用同一套剥离规则：剥掉外壳后必须能按 JSON 解析，
 * 解析不了就是脏包。
 */
function parseLocaleModule(text, relativePath) {
  const stripped = text.replace(/^[\s\S]*?export\s+default\s+/u, '').replace(/;\s*$/u, '')
  try {
    return JSON.parse(stripped)
  } catch {
    throw new Error(`${relativePath} 不是合法的语言包（export default 后面必须是 JSON 对象）`)
  }
}

/** 从 `ts/i18n/translate.ts` 读出 LOCALE_CODES（顺序即设置页按钮顺序） */
function readLocaleCodes(source) {
  const block = /export const LOCALE_CODES = \[([^\]]+)\] as const/u.exec(source)
  if (block === null || block[1] === undefined) {
    throw new Error('ts/i18n/translate.ts 中未找到 LOCALE_CODES 的定义（解析规则可能已失效）')
  }
  return [...block[1].matchAll(/'([^']+)'/gu)].map((matched) => matched[1] ?? '')
}

/** 行尾归一（CRLF → LF）——发布出去的就是 LF，哈希必须按它算 */
function normalizeLineEndings(text) {
  return text.replaceAll('\r\n', '\n')
}

/** 覆盖率口径必须与 `ts/i18n/translate.ts` 的 `computeCoverage` 完全一致 */
function computeCoverage(sourceMessages, targetMessages) {
  const total = Object.keys(sourceMessages).length
  if (total === 0) return 100
  let translated = 0
  for (const key of Object.keys(sourceMessages)) {
    const value = targetMessages[key]
    if (value !== undefined && value.trim() !== '') translated += 1
  }
  return Math.floor((translated / total) * 100)
}

/** 扫描全部语言包，算出清单 */
function buildIndex() {
  const codes = readLocaleCodes(readText('ts/i18n/translate.ts'))
  if (codes.length === 0) throw new Error('LOCALE_CODES 解析为空')
  if (!codes.includes(SOURCE_LOCALE)) {
    throw new Error(`LOCALE_CODES 里没有源语言 ${SOURCE_LOCALE}`)
  }

  const parsed = new Map()
  for (const code of codes) {
    const relativePath = join('locales', code, 'locale.js')
    const raw = normalizeLineEndings(readText(relativePath))
    const data = parseLocaleModule(raw, relativePath)
    parsed.set(code, {
      data,
      raw,
      sha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(raw, 'utf8'),
    })
  }

  const sourceMessages = parsed.get(SOURCE_LOCALE).data.messages ?? {}
  const keyCount = Object.keys(sourceMessages).length

  const locales = codes.map((code) => {
    const { data, sha256, bytes } = parsed.get(code)
    const messages = data.messages ?? {}
    return {
      code,
      name: typeof data.name === 'string' ? data.name : code,
      nativeName: typeof data.nativeName === 'string' ? data.nativeName : code,
      version: typeof data.version === 'string' ? data.version : '0.0.0',
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      keyCount: Object.keys(messages).length,
      coverage: computeCoverage(sourceMessages, messages),
      sha256,
      bytes,
    }
  })

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceLocale: SOURCE_LOCALE,
    keyCount,
    locales,
  }
}

/** 序列化成语言包同款外壳（`export default` + 纯 JSON，2 空格缩进） */
function serialize(index) {
  return [
    '/**',
    ' * 语言包清单（**生成物，别手改**）。',
    ' *',
    ' * 由 `npm run i18n:index`（`scripts/gen-locale-index.mjs`）从 `locales/*/locale.js` 算出，',
    ' * `check:i18n` 会校验它是否与实际文件一致——手改会在门禁里红。',
    ' *',
    ' * 为什么是 `.js` 不是 `.json`：安装态页面跑在 `file://` 下，`fetch` 读本地文件',
    ' * 会被 CEF 拦掉，只有 ESM 的 `import()` 能读。内容仍是纯数据，不含任何逻辑。',
    ' *',
    ' * `sha256` / `bytes` 按 **LF 归一后**的内容计算：工作区是 CRLF 检出，',
    ' * 发布出去的是 LF，只有归一后的值才和用户下载到的字节对得上。',
    ' */',
    `export default ${JSON.stringify(index, undefined, 2)};`,
    '',
  ].join('\n')
}

/** 读现有清单（不存在返回空串） */
function readExisting() {
  try {
    return readFileSync(join(projectRoot, INDEX_PATH), 'utf8')
  } catch {
    return ''
  }
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const index = buildIndex()
  const next = serialize(index)
  const current = readExisting()

  if (checkOnly) {
    if (current === next) {
      console.log(
        `✔ 语言包清单一致：${String(index.locales.length)} 个语言 / ` +
          `简体 ${String(index.keyCount)} 个 key / ` +
          index.locales.map((item) => `${item.code} ${String(item.coverage)}%`).join(' / '),
      )
      return
    }
    console.error('✖ locales/index.js 与语言包实际内容不一致：')
    if (current === '') {
      console.error(`  - ${INDEX_PATH} 不存在`)
    } else {
      const currentIndex = (() => {
        try {
          return JSON.parse(
            current.replace(/^[\s\S]*?export\s+default\s+/u, '').replace(/;\s*$/u, ''),
          )
        } catch {
          return null
        }
      })()
      if (currentIndex === null) {
        console.error(`  - ${INDEX_PATH} 不是合法的清单（export default 后面必须是 JSON 对象）`)
      } else {
        const byCode = new Map((currentIndex.locales ?? []).map((item) => [item.code, item]))
        for (const item of index.locales) {
          const old = byCode.get(item.code)
          if (old === undefined) {
            console.error(`  - 缺少语言「${item.code}」`)
            continue
          }
          for (const field of ['sha256', 'bytes', 'keyCount', 'coverage', 'version', 'updatedAt']) {
            if (old[field] !== item[field]) {
              console.error(
                `  - ${item.code}.${field}：清单 ${String(old[field])} ≠ 实际 ${String(item[field])}`,
              )
            }
          }
        }
        for (const code of byCode.keys()) {
          if (!index.locales.some((item) => item.code === code)) {
            console.error(`  - 清单里有实际不存在的语言「${code}」`)
          }
        }
        if (currentIndex.keyCount !== index.keyCount) {
          console.error(
            `  - keyCount：清单 ${String(currentIndex.keyCount)} ≠ 实际 ${String(index.keyCount)}`,
          )
        }
      }
    }
    console.error('\n修复：`npm run i18n:index`（改过 locales/*/locale.js 之后必须重跑）')
    process.exit(1)
  }

  if (current === next) {
    console.log(`✔ 语言包清单已是最新（${INDEX_PATH}）`)
    return
  }
  writeFileSync(join(projectRoot, INDEX_PATH), next, 'utf8')
  console.log(
    `✔ 已写入 ${INDEX_PATH}：${String(index.locales.length)} 个语言 / ` +
      `简体 ${String(index.keyCount)} 个 key`,
  )
}

main()
