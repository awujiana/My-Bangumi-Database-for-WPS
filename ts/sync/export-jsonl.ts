/**
 * @fileoverview JSONL 导出模块
 * @module sync/exportJsonl
 * @description 将 Excel 工作表中的数据导出为 JSONL（JSON Lines）格式文件。
 *              采用「表头 + 值数组」两段式：第 1 行是字段名数组，其后每行是与
 *              表头等长的值数组（仍是 JSON Lines，每行一个合法 JSON）。
 *              与 GitHub 仓库同步的数据格式一致，可直接作为本地同步数据源。
 */

import { LOG_LEVELS } from '../core/constants.js'
import {
  getDataSheet,
  findHeaderRow,
  getColumnMap,
  getLastRow,
  getCellValue,
  readRangeValues,
  colNumberToLetter,
  trim,
  bgmLog,
} from '../tools/util/index.js'
import type { WpsWorksheet } from '../tools/wps.js'

import { EXTENDED_FIELD_MAP } from './github-sync-diff.js'
import { extractSubjectId } from './pure-utilities.js'

/**
 * 导出字段顺序
 *
 * 必须与数据仓库分片的字段并集一致（不含 type）
 * （上游由 Archive/scripts/step09_build_jsonl.py 的 SHARD_DEFS 派生），
 * 这样导出的文件可以直接当作「本地文件同步」的数据源使用。
 */
export const EXPORT_FIELDS = [
  'sid',
  'name',
  'updatedAt',
  'date',
  'meta_tags',
  'nsfw',
  '播放结束',
  '动画制作公司',
  '话数',
  '片长',
  '制片国家',
  '语言',
  '类型',
  '导演',
  '音乐',
  '人物设定',
  '机械设定',
  '原作',
  '脚本',
  '分镜',
  '演出',
  '原案',
  '系列构成',
  '在线播放平台',
  '关联条目ID',
  '关联的动漫ID',
  // 全量保真字段：Excel 表没有对应列，导出时统一补默认值，
  // 仅用于保证表头与远程分片的字段并集完全一致。
  // 注意：不含 type —— 数据仓库已按文件名 anime 表达 type=2，任何文件都不再输出它。
  'name_original',
  'platform',
  'series',
  'score',
  'rank',
  'score_details',
  'favorite',
  'tags',
  'summary',
  'infobox',
  '别名',
] as const

/**
 * 各字段的默认值（缺省时使用，保证每行长度与表头严格一致）
 *
 * 数组与布尔/数值字段必须补对应类型，否则解析端会拿到错误类型。
 */
const FIELD_DEFAULTS: Readonly<Record<string, unknown>> = {
  meta_tags: [],
  score_details: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  favorite: [0, 0, 0, 0, 0],
  nsfw: false,
  series: false,
  platform: 0,
  score: 0,
  rank: 0,
}

/**
 * 取字段值；缺省时按字段类型补默认值，保证每行长度与表头严格一致
 *
 * 数据仓库中的记录所有字段都必然存在（文本为空串、meta_tags 为空数组、nsfw 为 false），
 * 导出时补齐同样的默认值，两种来源的数据结构才完全一致。
 */
function fieldOrDefault(entry: Record<string, unknown>, field: string): unknown {
  const value = entry[field]
  if (value !== undefined) return value
  return FIELD_DEFAULTS[field] ?? ''
}

/**
 * 读取单元格的显示文本（优先使用 Text 属性保留本地格式，回退到 getCellValue）
 *
 * 对于日期列，Excel/WPS 的 Value2 返回的是日期序列号（如 45382），
 * 而 Text 属性返回的是单元格显示的格式化文本（如 "2024-01-01" 或 "2024/1/1"）。
 * 优先使用 Text 属性可以保留用户设置的本地日期格式。
 *
 * @param ws 工作表
 * @param row 行号
 * @param col 列号
 * @returns 单元格显示文本，空值返回空字符串
 */
function getCellText(ws: WpsWorksheet, row: number, col: number): string {
  try {
    const address = colNumberToLetter(col) + String(row)
    const cell = ws.Range(address)
    // 尝试读取 Text 属性（保留本地格式）
    const raw = (cell as unknown as { Text?: unknown }).Text
    if (raw != null && typeof raw === 'string' && raw.trim()) {
      return trim(raw)
    }
  } catch {
    // 忽略，回退到 getCellValue
  }
  return trim(getCellValue(ws, row, col))
}

/**
 * 将 Excel 工作表中的数据导出为 JSONL 字符串
 *
 * 读取数据工作表中的所有行，按 {@link GithubRemoteEntry} 格式组织，
 * 包含 sid、name、updatedAt、date、meta_tags、话数 等字段。
 *
 * 输出第 1 行为表头（{@link EXPORT_FIELDS}），其后每行为等长的值数组。
 *
 * 日期字段（开播日期、完播日）优先使用单元格的本地格式（Text 属性），
 * 保留用户设置的日期格式，无格式时回退到默认的 Value2 值。
 *
 * @returns JSONL 字符串，若无数据则返回空字符串
 */
export function buildJsonlFromSheet(): string {
  const ws = getDataSheet()
  if (!ws) {
    bgmLog(LOG_LEVELS.WARN, '[exportJsonl] 未找到数据工作表')
    return ''
  }

  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)

  const urlCol = colMap.get('Bangumi_URL')
  if (urlCol === undefined) {
    bgmLog(LOG_LEVELS.WARN, '[exportJsonl] 未找到 Bangumi_URL 列，无法导出')
    return ''
  }

  const rows: unknown[][] = []
  const startRow = headerRow + 1

  // 性能：一次矩形读覆盖「全部行 × 全部取数列」——原先每行的扩展字段就是 22 次
  // 逐格读（5000 行 ≈ 11 万次 IPC）。日期列走 getCellText（读 Text 属性以保留
  // 用户日期格式），无法并入本批，仍是每行 2 次。
  const batchKeys = new Set(['名称', '标签/分级', '集数'])
  for (const [, excelField] of EXTENDED_FIELD_MAP) batchKeys.add(excelField)
  let batchMaxCol = urlCol
  for (const key of batchKeys) {
    const col = colMap.get(key)
    if (col !== undefined && col > batchMaxCol) batchMaxCol = col
  }
  const block = readRangeValues(ws, startRow, lastRow, 1, batchMaxCol)
  const canBatch = block.length === lastRow - startRow + 1
  // 矩形读不可用时回退逐格读（行为与改造前一致）
  const cellText = (row: number, col: number): string =>
    canBatch ? (block[row - startRow]?.[col - 1] ?? '') : getCellValue(ws, row, col)

  for (let row = startRow; row <= lastRow; row += 1) {
    const url = trim(cellText(row, urlCol))
    if (url) {
      const sid = extractSubjectId(url)
      if (sid) {
        const getField = (key: string): string => {
          const col = colMap.get(key)
          if (!col) return ''
          return trim(cellText(row, col))
        }

        // 日期列优先使用本地格式（Text 属性），保留用户设置的日期格式
        const getDateField = (key: string): string => {
          const col = colMap.get(key)
          if (!col) return ''
          return getCellText(ws, row, col)
        }

        const name = getField('名称')
        const tags = getField('标签/分级')
        const episode = getField('集数')
        const date = getDateField('开播日期')
        const endDate = getDateField('完播日')

        // 构建 JSON 对象
        const entry: Record<string, unknown> = {
          sid,
          name: name || undefined,
          updatedAt: new Date().toISOString().slice(0, 10),
        }

        // 可选字段：有值才写入，保持 JSONL 简洁
        if (date) entry.date = date
        if (endDate) entry['播放结束'] = endDate
        if (episode) entry['话数'] = episode
        if (tags) {
          entry.meta_tags = tags
            .split('|')
            .map((t) => t.trim())
            .filter(Boolean)
        }

        // 扩展字段：映射表此前在循环体内逐行重建（每行 new 一个 22 元数组）且与 github-sync-diff.ts 的同名表重复，改为复用那一份唯一事实来源；顺带修掉缺陷：本地「别名 / 评分 / 排名」列此前不在表里，导出被静默丢弃，而 EXPORT_FIELDS 明明包含这三个字段。

        for (const [jsonlField, excelField] of EXTENDED_FIELD_MAP) {
          const value = getField(excelField)
          if (value) {
            entry[jsonlField] = value
          }
        }

        rows.push(EXPORT_FIELDS.map((field) => fieldOrDefault(entry, field)))
      }
    }
  }

  bgmLog(LOG_LEVELS.INFO, `[exportJsonl] 构建完成：${String(rows.length)} 条记录`)

  // 无数据时返回空字符串（保持与历史行为一致，调用方据此判断是否有内容）
  if (rows.length === 0) {
    return ''
  }

  // 「表头 + 值数组」两段式：第 1 行字段名只出现一次，其后每行为等长值数组
  const headerLine = JSON.stringify([...EXPORT_FIELDS])
  return [headerLine, ...rows.map((row) => JSON.stringify(row))].join('\n')
}

/**
 * 导出工作表中的数据为 JSONL 文件（通过浏览器下载）
 *
 * 使用 Blob + URL.createObjectURL 创建临时下载链接，兼容 WPS 内嵌浏览器。
 * 若浏览器不支持下载，则提示用户手动复制。
 *
 * @returns 是否成功导出
 */
export function exportSheetToJsonlFile(): boolean {
  try {
    const content = buildJsonlFromSheet()
    if (!content) {
      bgmLog(LOG_LEVELS.WARN, '[exportJsonl] 没有数据可导出')
      return false
    }

    const blob = new Blob([content], { type: 'application/jsonlines' })
    const url = URL.createObjectURL(blob)

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')
    const filename = `bgm_sync_export_${timestamp}.jsonlines`

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // 释放 Blob URL
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 10_000)

    bgmLog(
      LOG_LEVELS.INFO,
      `[exportJsonl] 已导出文件: ${filename} (${String(content.length)} 字节)`,
    )
    return true
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[exportJsonl] 导出失败: ${(error as Error).message}`)
    return false
  }
}
