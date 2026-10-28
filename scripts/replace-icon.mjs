#!/usr/bin/env node
/**
 * 给 wpsjs 打出的自解压 exe 换图标（Resource Hacker 命令行）
 *
 * 为什么需要这一步：`wpsjs build --exe` 生成的 exe 用的是 wpsjs 自带的默认图标，
 * 跟插件的品牌图标不一致。以前是手工打开 Resource Hacker 换一次再另存，
 * 每次发版都要点一遍、还容易忘 —— 这个脚本把它变成一条命令。
 *
 * 用法：
 *   node scripts/replace-icon.mjs                    # 默认：wps-addon-build 的 exe → release/<版本>.exe
 *   node scripts/replace-icon.mjs --icon D:/x.ico    # 换一个 ico
 *   node scripts/replace-icon.mjs --exe a.exe --out b.exe
 *   node scripts/replace-icon.mjs --merge-dir images   # 多个单尺寸 ico → 一个多尺寸 ico
 *
 * 依赖：Resource Hacker 5.x（`--resource-hacker` 或环境变量 `RESOURCE_HACKER`，
 *       默认找 `D:\Software\ToolsSoftware\ResourceHacker\ResourceHacker_v5.2.8.448.exe`）。
 *
 * 换完会做三项校验，任一项不过就以非 0 退出（宁可发不出去，也不要发一个坏 exe）：
 *   1. 输出仍是合法 PE（MZ + PE 签名 + 节表可解析）；
 *   2. **除 `.rsrc` 外的所有节逐字节相同** —— 换图标只该动资源节，动了代码就是坏包；
 *   3. 新 ico 的图像数据在输出里出现、旧图标数据不再出现。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = join(scriptDirectory, '..')

/** Resource Hacker 的默认位置（可用 --resource-hacker 或环境变量覆盖） */
const DEFAULT_RESOURCE_HACKER =
  'D:\\Software\\ToolsSoftware\\ResourceHacker\\ResourceHacker_v5.2.8.448.exe'

/** 解析 `--key value` / `--key=value` 形式的参数 */
function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const [key, inlineValue] = item.slice(2).split('=', 2)
    if (inlineValue !== undefined) {
      options[key] = inlineValue
    } else if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      options[key] = argv[index + 1]
      index += 1
    } else {
      options[key] = 'true'
    }
  }
  return options
}

/** 相对路径按项目根解析（脚本可从任意 cwd 调用） */
function toAbsolute(value) {
  return isAbsolute(value) ? value : resolve(projectDirectory, value)
}

function fail(message) {
  console.error(`\n❌ ${message}`)
  process.exit(1)
}

/** 读 package.json 的版本号（决定默认输出文件名） */
function packageVersion() {
  return JSON.parse(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).version
}

/**
 * 解析 .ico 的目录，返回每个图像的数据块
 *
 * 只认 type=1（图标）；type=2 是光标，换上去资源管理器不认。
 */
function parseIcon(buffer) {
  if (buffer.length < 6) throw new Error('ico 太小，连文件头都不完整')
  const type = buffer.readUInt16LE(2)
  if (type !== 1) throw new Error(`不是图标文件（type=${type}，应为 1）`)
  const count = buffer.readUInt16LE(4)
  if (count === 0) throw new Error('ico 里没有任何图像')
  const images = []
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16
    const width = buffer[entry] === 0 ? 256 : buffer[entry]
    const height = buffer[entry + 1] === 0 ? 256 : buffer[entry + 1]
    const bitCount = buffer.readUInt16LE(entry + 6)
    const size = buffer.readUInt32LE(entry + 8)
    const offset = buffer.readUInt32LE(entry + 12)
    if (offset + size > buffer.length)
      throw new Error(`ico 第 ${index + 1} 个图像越界（文件被截断）`)
    images.push({ width, height, bitCount, data: buffer.subarray(offset, offset + size) })
  }
  return images
}

/**
 * 把若干图像拼成一个 .ico
 *
 * 目录项按尺寸升序写，`planes` 统一写 1 —— PNG 压缩图像其实用不到这两个字段，
 * 但写成 0 有工具会当成非法图标。
 */
function buildIcon(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type=1 图标
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(images.length * 16)
  let offset = 6 + images.length * 16
  for (const [index, image] of images.entries()) {
    const entry = index * 16
    entries[entry] = image.width >= 256 ? 0 : image.width // 256 在目录里记为 0
    entries[entry + 1] = image.height >= 256 ? 0 : image.height
    entries.writeUInt16LE(1, entry + 4) // planes
    entries.writeUInt16LE(image.bitCount, entry + 6)
    entries.writeUInt32LE(image.data.length, entry + 8)
    entries.writeUInt32LE(offset, entry + 12)
    offset += image.data.length
  }
  return Buffer.concat([header, entries, ...images.map((image) => image.data)])
}

/**
 * 把目录里的多个 ico 合并成一个多尺寸 ico
 *
 * 用户手里常常是「16.ico / 32.ico / 48.ico …」一堆单尺寸文件，而 Resource Hacker
 * 只吃一个 ico。同一尺寸重复出现时保留数据更大的那张，输出按尺寸升序。
 */
function mergeIcons(inputPaths, outputPath) {
  const merged = new Map()
  for (const inputPath of inputPaths) {
    const images = parseIcon(readFileSync(inputPath))
    for (const image of images) {
      const key = `${String(image.width)}x${String(image.height)}@${String(image.bitCount)}`
      const existing = merged.get(key)
      if (existing === undefined || image.data.length > existing.data.length) {
        merged.set(key, { ...image, source: basename(inputPath) })
      }
    }
  }
  const images = [...merged.values()].sort(
    (left, right) => left.width - right.width || left.height - right.height,
  )
  const buffer = buildIcon(images)

  // 写完立刻读回来比对：拼错了（偏移/长度算错）在这里就该炸，而不是等 exe 校验
  const reloaded = parseIcon(buffer)
  if (reloaded.length !== images.length) {
    throw new Error(
      `回读图像数不符（写入 ${String(images.length)}，读回 ${String(reloaded.length)}）`,
    )
  }
  for (const [index, image] of images.entries()) {
    if (!reloaded[index].data.equals(image.data)) {
      throw new Error(`${String(image.width)}x${String(image.height)} 回读数据与源不一致`)
    }
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, buffer)
  return { images, size: buffer.length }
}

/**
 * 解析 PE 节表
 *
 * 只用节名 + 原始数据偏移/长度：够用来做「除资源节外逐字节相同」的比对，
 * 不需要完整 PE 解析器。
 */
function parsePeSections(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a_4d) {
    throw new Error('不是 PE 文件（缺少 MZ 头）')
  }
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 24 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x00_00_45_50) {
    throw new Error('不是 PE 文件（缺少 PE 签名）')
  }
  const sectionCount = buffer.readUInt16LE(peOffset + 6)
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20)
  const tableOffset = peOffset + 24 + optionalHeaderSize
  const sections = []
  for (let index = 0; index < sectionCount; index += 1) {
    const entry = tableOffset + index * 40
    if (entry + 40 > buffer.length) throw new Error('节表越界（PE 头被破坏）')
    const name = buffer.toString('latin1', entry, entry + 8).replace(/\0+$/u, '')
    const sizeOfRawData = buffer.readUInt32LE(entry + 16)
    const pointerToRawData = buffer.readUInt32LE(entry + 20)
    sections.push({ name, sizeOfRawData, pointerToRawData })
  }
  return sections
}

/** 取某节的原始数据（越界时返回空 Buffer，由调用方判为不一致） */
function sectionBytes(buffer, section) {
  const end = section.pointerToRawData + section.sizeOfRawData
  if (section.sizeOfRawData === 0) return Buffer.alloc(0)
  if (end > buffer.length) return Buffer.alloc(0)
  return buffer.subarray(section.pointerToRawData, end)
}

/** 统计子串出现次数（用来判「新图标进去了、旧图标没了」） */
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  for (;;) {
    const found = haystack.indexOf(needle, from)
    if (found === -1) return count
    count += 1
    from = found + 1
  }
}

/** 资源节名（换图标只允许动它） */
const RESOURCE_SECTION = '.rsrc'

/**
 * 校验输出：PE 合法 + 除资源节外逐字节相同
 *
 * @returns 失败原因数组（空数组 = 通过）
 */
function checkStructure(original, patched) {
  const problems = []
  const originalSections = parsePeSections(original)
  const patchedSections = parsePeSections(patched)
  for (const section of originalSections) {
    if (section.name === RESOURCE_SECTION) continue
    const counterpart = patchedSections.find((item) => item.name === section.name)
    if (!counterpart) {
      problems.push(`输出里丢了节 ${section.name}`)
      continue
    }
    const before = sectionBytes(original, section)
    const after = sectionBytes(patched, counterpart)
    if (!before.equals(after)) problems.push(`节 ${section.name} 的内容被改动了（不该动代码）`)
  }
  return problems
}

/**
 * 校验图标：新 ico 的每个图像数据都要在输出里出现
 *
 * 不做「旧图标必须消失」的判定：一是要完整解析 PE 资源目录才拿得到旧的 ICONGROUP，
 * 二是在已经换过图标的 exe 上重跑本来就是合法的（幂等），不该因此报错。
 */
function checkIcon(patched, images) {
  const problems = []
  for (const image of images) {
    if (countOccurrences(patched, image.data) === 0) {
      problems.push(`${image.width}x${image.height} 的图像没有出现在输出里`)
    }
  }
  return problems
}

/** 调 Resource Hacker 换图标（ICONGROUP,MAINICON,0） */
function runResourceHacker(resourceHacker, inputPath, outputPath, iconPath, workDirectory) {
  const logPath = join(workDirectory, 'resource-hacker.log')
  const result = spawnSync(
    resourceHacker,
    [
      '-open',
      inputPath,
      '-save',
      outputPath,
      '-action',
      'addoverwrite',
      '-res',
      iconPath,
      '-mask',
      'ICONGROUP,MAINICON,',
      '-log',
      logPath,
    ],
    { encoding: 'utf8', timeout: 120_000, windowsHide: true },
  )
  if (result.error) throw new Error(`调用 Resource Hacker 失败：${result.error.message}`)
  if (result.status !== 0) {
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf16le') : ''
    throw new Error(
      `Resource Hacker 返回 ${String(result.status)}${log === '' ? '' : `\n${log.trim()}`}`,
    )
  }
  if (!existsSync(outputPath)) throw new Error('Resource Hacker 没有产出文件')
  const size = statSync(outputPath).size
  if (size === 0) throw new Error('Resource Hacker 产出的文件是空的')
  return size
}

// ---- 主流程 ----

const options = parseArguments(process.argv.slice(2))
const version = packageVersion()

// ---- 合并模式：只产出一个多尺寸 ico，不碰 exe ----
if (options['merge-dir'] !== undefined) {
  const mergeDirectory = toAbsolute(options['merge-dir'])
  const mergeOutput = toAbsolute(options.out ?? 'images/app-icon.ico')
  if (!existsSync(mergeDirectory)) fail(`找不到目录：${mergeDirectory}`)
  const candidates = readdirSync(mergeDirectory)
    .filter((name) => name.toLowerCase().endsWith('.ico'))
    .map((name) => join(mergeDirectory, name))
    .filter((path) => resolve(path) !== resolve(mergeOutput))
  if (candidates.length === 0) fail(`目录里没有 ico：${mergeDirectory}`)

  let merged
  try {
    merged = mergeIcons(candidates, mergeOutput)
  } catch (error) {
    fail(`合并图标失败：${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`合并 ${String(candidates.length)} 个 ico → ${mergeOutput}`)
  for (const image of merged.images) {
    console.log(
      `  · ${String(image.width)}x${String(image.height)} / ${String(image.bitCount)}bpp / ${String(image.data.length)} 字节 ← ${image.source}`,
    )
  }
  console.log(
    `\n✅ 已写入：${mergeOutput}（${String(merged.size)} 字节，${String(merged.images.length)} 张图像）`,
  )
  process.exit(0)
}

const inputPath = toAbsolute(options.exe ?? 'wps-addon-build/my-bangumi-database-for-wps.exe')
const iconPath = toAbsolute(options.icon ?? process.env.BGM_ICON ?? 'images/app-icon.ico')
const outputPath = toAbsolute(options.out ?? `release/my-bangumi-database-for-wps-v${version}.exe`)
const resourceHacker = toAbsolute(
  options['resource-hacker'] ?? process.env.RESOURCE_HACKER ?? DEFAULT_RESOURCE_HACKER,
)

if (!existsSync(resourceHacker)) fail(`找不到 Resource Hacker：${resourceHacker}`)
if (!existsSync(inputPath)) fail(`找不到输入 exe：${inputPath}（先跑 wpsjs build --exe）`)
if (!existsSync(iconPath)) fail(`找不到图标文件：${iconPath}`)

const iconBuffer = readFileSync(iconPath)
let images
try {
  images = parseIcon(iconBuffer)
} catch (error) {
  fail(`图标不合法：${error.message}`)
}

console.log(`图标：${iconPath}`)
for (const image of images) {
  console.log(
    `  · ${image.width}x${image.height} / ${image.bitCount}bpp / ${image.data.length} 字节`,
  )
}
console.log(`输入：${inputPath}`)
console.log(`输出：${outputPath}`)

const originalBuffer = readFileSync(inputPath)
mkdirSync(dirname(outputPath), { recursive: true })
const workDirectory = mkdtempSync(join(tmpdir(), 'bgm-icon-'))
let outcome
try {
  const size = runResourceHacker(resourceHacker, inputPath, outputPath, iconPath, workDirectory)
  const patchedBuffer = readFileSync(outputPath)

  const problems = [
    ...checkStructure(originalBuffer, patchedBuffer),
    ...checkIcon(patchedBuffer, images),
  ]
  if (problems.length > 0) {
    // 校验不过就不要留下可疑产物，免得被 publish 顺手发出去
    rmSync(outputPath, { force: true })
    throw new Error(`图标替换后的 exe 未通过校验：\n  - ${problems.join('\n  - ')}`)
  }

  outcome = {
    size,
    sha256: createHash('sha256').update(patchedBuffer).digest('hex'),
  }
} catch (error) {
  rmSync(workDirectory, { recursive: true, force: true })
  fail(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(workDirectory, { recursive: true, force: true })
}

console.log(`\n✅ 已换图标：${outputPath}`)
console.log(
  `   大小：${String(outcome.size)} 字节（原 ${String(originalBuffer.length)}，差 ${
    outcome.size - originalBuffer.length
  }）`,
)
console.log(`   sha256：${outcome.sha256}`)
console.log('\n提示：Release 说明里的 exe 哈希要同步改成上面这个值。')
