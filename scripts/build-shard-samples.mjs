#!/usr/bin/env node
/**
 * @fileoverview 从本地分片数据生成「分片清单浮窗」的示例数据（一次性脚本）
 *
 * 用法（在 BGM 仓库根目录）：
 *   node scripts/build-shard-samples.mjs [manifestPath] [outputPath]
 *
 * 默认从工作区姊妹仓库读分片（manifest + 6 个 .jsonlines.gz），挑一条
 * **2026 年播出、字段最全**的记录，按 manifest 的字段清单输出每片的
 * 「字段 → 类型 → 示例值 → 本地列」，生成 ts/ui/handlers/shard-samples.ts
 * （自动生成文件，勿手改）。
 *
 * 为什么生成 TS 而不是运行时 fetch JSON：加载项的静态资源路径在 wpsjs
 * debug / 构建产物里不一致，fetch 容易 404；生成 TS 由构建打进去，零路径
 * 风险，浮窗打开也不会有一次网络往返。
 *
 * 「本地列」映射与 ts/sync/github-sync-diff.ts 的 CORE_FIELD_COLUMNS /
 * EXTENDED_FIELD_MAP / UNMAPPED_REMOTE_FIELDS 对齐；tests/shard-samples.test.ts
 * 守护这份表与 TS 常量的一致性（防漂移）。
 */

import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

/** 字段 → 本地 Excel 列（有列才会写入；null = 随分片下载但不写任何列） */
const LOCAL_COLUMN_BY_FIELD = new Map([
  // CORE_FIELD_COLUMNS
  ['name', '名称'],
  ['meta_tags', '标签/分级'],
  ['话数', '集数'],
  // EXTENDED_FIELD_MAP
  ['date', '开播日期'],
  ['播放结束', '完播日'],
  ['动画制作公司', '制作公司'],
  ['片长', '时长'],
  ['制片国家', '制片国家'],
  ['语言', '语言'],
  ['类型', '类型'],
  ['导演', '导演'],
  ['音乐', '音乐'],
  ['人物设定', '人物设定'],
  ['机械设定', '机械设定'],
  ['原作', '原作'],
  ['脚本', '脚本'],
  ['分镜', '分镜'],
  ['演出', '演出'],
  ['原案', '原案'],
  ['系列构成', '系列构成'],
  ['在线播放平台', '在线播放平台'],
  ['关联条目ID', '关联条目ID'],
  ['关联的动漫ID', '关联的动漫ID'],
  ['别名', '别名'],
  ['score', '评分'],
  ['rank', '排名'],
  // sid：不写列，但是 Bangumi_URL 的构造原料与跨片连接键
  ['sid', null],
])

/** 无本地列的字段的一句说明（与 UNMAPPED_REMOTE_FIELDS 对齐） */
const UNMAPPED_NOTE_BY_FIELD = new Map([
  ['sid', '跨片连接键，并用于构造 Bangumi_URL 列（不单独成列）'],
  ['summary', '简介原文，表里没有简介列时不写入'],
  ['infobox', 'infobox 原文（未解析），仅作留档'],
  ['tags', '用户标签（名称:计数）'],
  ['score_details', '评分分布'],
  ['favorite', '收藏统计'],
  ['platform', '平台'],
  ['series', '是否系列作'],
  ['nsfw', 'NSFW 标记'],
  ['name_original', '原始名称（与「名称」语义重叠，刻意不映射）'],
  ['updatedAt', '远端更新时间（仅作数据新鲜度判据）'],
])

/** 示例值最大长度（summary / infobox 动辄上千字，截断保浮窗可读） */
const SAMPLE_MAX_CHARS = 150

/**
 * 读取一个分片：第一行是表头（字段名数组），其余是数据行（与表头等长的数组）
 *
 * 行序与 manifest 声明一致，因此**按下标 join** 即可，不需要建 sid 索引。
 */
async function readShardRows(filePath) {
  const header = []
  const rows = []
  const stream = createReadStream(filePath).pipe(createGunzip())
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  let isFirstLine = true
  for await (const line of rl) {
    if (line.trim() === '') continue
    const parsed = JSON.parse(line)
    if (isFirstLine) {
      header.push(...parsed)
      isFirstLine = false
    } else {
      rows.push(parsed)
    }
  }
  return { header, rows }
}

/** 数组行 → 对象（表头 zip 数据行） */
function toRecord(header, row) {
  const record = {}
  for (const [index, key] of header.entries()) {
    record[key] = row[index] ?? null
  }
  return record
}

/** 与 github-sync-diff.ts 的 hasRemoteValue 同口径：空串 / 空数组 / 0 算「无值」 */
function hasValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return value !== 0
  return true
}

/** 样本值的展示形态（截断 + JSON 序列化） */
function formatSample(value) {
  if (value === null || value === undefined) return ''
  let text
  if (typeof value === 'string') text = value
  else if (Array.isArray(value)) text = value.join(' | ')
  else if (typeof value === 'object') text = JSON.stringify(value)
  else text = String(value)
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length > SAMPLE_MAX_CHARS) text = `${text.slice(0, SAMPLE_MAX_CHARS)}…`
  return text
}

/** 值的中文类型名 */
function typeOf(value) {
  if (value === null || value === undefined) return '空值'
  if (Array.isArray(value)) return '数组'
  return typeof value === 'object' ? '对象' : typeof value
}

async function main() {
  // 数据仓库在工作区根（awujiana/Bangumi-Archive-Anime-Excel），相对本仓库要上三级
  const manifestPath = process.argv[2] ?? path.resolve(REPO_ROOT, '../../../Bangumi-Archive-Anime-Excel/data/anime.manifest.json')
  const outputPath = process.argv[3] ?? path.resolve(REPO_ROOT, 'ts/ui/handlers/shard-samples.ts')

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  console.log(`[build-shard-samples] manifest: ${manifestPath}（updatedAt=${manifest.updatedAt}, recordCount=${manifest.recordCount}）`)

  // 1) 读全部分片（数组行 → 对象）
  const shardRecords = new Map()
  let rowCount = -1
  for (const shard of manifest.shards) {
    const shardPath = path.join(path.dirname(manifestPath), shard.file)
    const { header, rows } = await readShardRows(shardPath)
    if (rowCount === -1) rowCount = rows.length
    else if (rows.length !== rowCount) {
      throw new Error(`分片行数不一致：${shard.name} ${rows.length} ≠ ${rowCount}（行序 join 的前提被破坏）`)
    }
    shardRecords.set(shard.name, { header, rows })
    console.log(`[build-shard-samples] ${shard.name}: ${rows.length} 行, 字段 ${header.length} 个`)
  }

  // 2) 按行号 join 成完整记录（manifest 声明各片行序一致）
  const baseRows = shardRecords.get('base').rows
  const baseHeader = shardRecords.get('base').header
  const joined = []
  for (let index = 0; index < baseRows.length; index += 1) {
    const record = {}
    for (const [name, shard] of shardRecords) {
      const row = shard.rows[index]
      if (!row) continue
      const part = toRecord(shard.header, row)
      // sid 各片都有，直接覆盖无冲突；其余字段两两不重叠
      Object.assign(record, part)
    }
    joined.push(record)
  }

  // 3) 2026 年播出 + 字段最全（非空字段数最多）
  const baseDateIndex = baseHeader.indexOf('date')
  const year2026 = joined.filter((record) => {
    const date = record.date
    return typeof date === 'string' && date.startsWith('2026-')
  })
  console.log(`[build-shard-samples] 2026 年播出记录: ${year2026.length} 条`)
  if (year2026.length === 0) throw new Error('没有 2026 年播出的记录（date 字段格式变了？）')

  let best = null
  let bestScore = -1
  for (const record of year2026) {
    let score = 0
    for (const value of Object.values(record)) {
      if (hasValue(value)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = record
    }
  }
  console.log(`[build-shard-samples] 最全面的一条: sid=${best.sid} name=${best.name}（${bestScore} 个非空字段）`)

  // 4) 按 manifest 字段清单输出每片的字段明细
  const shards = manifest.shards.map((shard) => ({
    name: shard.name,
    fields: shard.fields.map((field) => {
      const localColumn = LOCAL_COLUMN_BY_FIELD.has(field)
        ? LOCAL_COLUMN_BY_FIELD.get(field)
        : null
      return {
        name: field,
        type: typeOf(best[field]),
        sample: formatSample(best[field]),
        localColumn: localColumn ?? null,
        ...(localColumn === null && UNMAPPED_NOTE_BY_FIELD.has(field)
          ? { note: UNMAPPED_NOTE_BY_FIELD.get(field) }
          : {}),
      }
    }),
  }))

  const payload = {
    source: 'auto-generated by scripts/build-shard-samples.mjs',
    dataUpdatedAt: manifest.updatedAt,
    sampleSid: String(best.sid),
    sampleName: String(best.name ?? ''),
    shards,
  }

  // 5) 生成 TS 模块（构建打进去，浮窗零网络往返）
  const ts = `/**
 * 分片清单浮窗的示例数据（**自动生成，勿手改**）
 *
 * 由 scripts/build-shard-samples.mjs 从本地分片数据生成：
 * 挑一条 ${manifest.updatedAt} 数据里 2026 年播出、字段最全的记录
 * （sid=${payload.sampleSid} ${payload.sampleName}），按 manifest 字段清单输出
 * 每片的「字段 → 类型 → 示例值 → 本地列」。
 *
 * 重新生成：node scripts/build-shard-samples.mjs
 * 一致性守护：tests/shard-samples.test.ts（localColumn 与
 * github-sync-diff 的映射表对齐，防漂移）。
 */

/** 单个字段的示例行 */
export interface ShardSampleField {
  /** 远程字段名（JSONL 键） */
  name: string
  /** 值类型（string / number / boolean / array / object / 空值） */
  type: string
  /** 示例值（长文本截断到 150 字符） */
  sample: string
  /** 对应的本地 Excel 列名；null = 随分片下载但不写任何列 */
  localColumn: string | null
  /** 无本地列时的一句说明 */
  note?: string
}

/** 单个分片的示例 */
export interface ShardSample {
  name: string
  fields: ShardSampleField[]
}

/** 示例数据总包（数据日期 + 样本条目 + 各片明细） */
export interface ShardSampleBundle {
  dataUpdatedAt: string
  sampleSid: string
  sampleName: string
  shards: ShardSample[]
}

export const SHARD_SAMPLES: ShardSampleBundle = ${JSON.stringify(
    {
      dataUpdatedAt: payload.dataUpdatedAt,
      sampleSid: payload.sampleSid,
      sampleName: payload.sampleName,
      shards: payload.shards,
    },
    null,
    2,
  )}
`

  await writeFile(outputPath, ts, 'utf8')
  console.log(`[build-shard-samples] 已生成 ${outputPath}`)
}

main().catch((error) => {
  console.error(`[build-shard-samples] 失败: ${error.message}`)
  process.exitCode = 1
})
