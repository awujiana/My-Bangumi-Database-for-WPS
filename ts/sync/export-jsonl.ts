/**
 * @fileoverview JSONL 导出模块
 * @module sync/exportJsonl
 * @description 将 Excel 工作表中的数据导出为 JSONL（JSON Lines）格式文件。
 *              JSONL 格式：每行一个独立的 JSON 对象，无外层数组括号，无逗号分隔。
 *              兼容 GitHub 仓库同步的 JSONL 数据格式。
 */

import { LOG_LEVELS } from '../core/constants.js'
import {
  getDataSheet,
  findHeaderRow,
  getColumnMap,
  getLastRow,
  getCellValue,
  colNumberToLetter,
  trim,
} from '../tools/util/index.js'
import { bgmLog } from '../tools/utility.js'
import type { WpsWorksheet } from '../tools/wps.js'

import { extractSubjectId } from './pure-utilities.js'

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

  const lines: string[] = []
  const startRow = headerRow + 1

  for (let row = startRow; row <= lastRow; row += 1) {
    const url = trim(getCellValue(ws, row, urlCol))
    if (url) {
      const sid = extractSubjectId(url)
      if (sid) {
        const getField = (key: string): string => {
          const col = colMap.get(key)
          if (!col) return ''
          return trim(getCellValue(ws, row, col))
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

        // 扩展字段
        const EXTENDED_FIELD_MAP: readonly (readonly [string, string])[] = [
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
          ['关联的动漫ID', '关联的动漫ID'],
        ] as const

        for (const [jsonlField, excelField] of EXTENDED_FIELD_MAP) {
          const value = getField(excelField)
          if (value) {
            entry[jsonlField] = value
          }
        }

        lines.push(JSON.stringify(entry))
      }
    }
  }

  bgmLog(LOG_LEVELS.INFO, `[exportJsonl] 构建完成：${String(lines.length)} 条记录`)
  return lines.join('\n')
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

    const blob = new Blob([content], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')
    const filename = `bgm_sync_export_${timestamp}.jsonl`

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
