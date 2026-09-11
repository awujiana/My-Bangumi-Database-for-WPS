/**
 * @fileoverview GitHub 同步的单单元格写入值解析（纯函数）
 * @module sync/githubCellValue
 * @description 从 `github-sync.ts` 抽出的纯逻辑：给定「目标列名 + 远程条目 + 字段筛选」
 *              计算应写入的值与写入标记。封装「新增行取值」与「更新行取值（含名称/标签合并策略）」
 *              两套规则，零 WPS / DOM 依赖，可在 Node 测试环境直接运行。
 *
 * @remarks 别名列映射依赖 `github-sync-diff.js`（零依赖纯模块），无循环风险。
 */

import { EXTENDED_FIELD_MAP, getExcelAliases, tagsToString } from './github-sync-diff.js'
import type { GithubRemoteEntry } from './github-sync-diff.js'
import { DATE_COLUMNS, appendValueWithSeparator, formatDateToLocal } from './github-time-format.js'

/**
 * 解析新增行的单个单元格写入值（扩展字段支持别名列映射）
 *
 * 独立辅助函数：避免批量写入循环内的嵌套 switch/loop break
 */
export function resolveNewRowCellValue(
  wc: { name: string },
  entry: { remote: GithubRemoteEntry },
): string | number | null {
  switch (wc.name) {
    case 'Bangumi_URL': {
      return `https://bgm.tv/subject/${entry.remote.sid}`
    }
    case '名称': {
      return entry.remote.name ?? null
    }
    case '标签/分级': {
      return tagsToString(entry.remote.meta_tags) || null
    }
    case '集数': {
      return entry.remote['话数'] ?? null
    }
    default: {
      // 扩展字段：遍历 EXTENDED_FIELD_MAP 匹配（支持别名列映射）
      for (const [jsonlField] of EXTENDED_FIELD_MAP) {
        const aliases = getExcelAliases(jsonlField)
        if (aliases.includes(wc.name)) {
          const v = entry.remote[jsonlField as keyof GithubRemoteEntry]
          if (typeof v === 'string') {
            return DATE_COLUMNS.has(wc.name) ? (formatDateToLocal(v) ?? v) : v
          }
          if (typeof v === 'number') {
            return String(v)
          }
          return null
        }
      }
      return null
    }
  }
}

/**
 * 解析更新行的单个单元格新值与写入标记（支持别名列映射与合并策略）
 *
 * 独立辅助函数：避免批量更新循环内的嵌套 switch/loop break
 */
export function resolveUpdateCellValue(
  wc: { name: string },
  remote: GithubRemoteEntry,
  fields: string[],
  isWriteAll: boolean,
  shouldForceOverwrite: boolean,
  oldCellValue: string,
): { value: string | number | null; shouldWrite: boolean } {
  switch (wc.name) {
    case 'Bangumi_URL': {
      if (isWriteAll || fields.includes('Bangumi_URL')) {
        return { value: `https://bgm.tv/subject/${remote.sid}`, shouldWrite: true }
      }
      return { value: null, shouldWrite: false }
    }
    case '别名': {
      // 名称追加到「别名」列（合并策略）
      // forceOverwrite 或 writeAll 时直接写入名称列（不合并）
      if (!shouldForceOverwrite && !isWriteAll && fields.includes('名称')) {
        const remoteName = remote.name ?? ''
        if (remoteName) {
          const value = appendValueWithSeparator(oldCellValue, remoteName)
          if (value !== oldCellValue) {
            return { value, shouldWrite: true }
          }
        }
      }
      // forceOverwrite 或 writeAll 时不处理别名（由名称列处理）
      return { value: null, shouldWrite: false }
    }
    case '名称': {
      // 名称列仅在 forceOverwrite 或 writeAll 时写入（新增或强制覆盖）
      if (shouldForceOverwrite || isWriteAll || fields.includes('名称')) {
        return { value: remote.name ?? '', shouldWrite: true }
      }
      return { value: null, shouldWrite: false }
    }
    case '标签/分级': {
      if (isWriteAll || fields.includes('标签/分级')) {
        const remoteTags = tagsToString(remote.meta_tags)
        if (remoteTags) {
          if (shouldForceOverwrite || isWriteAll) {
            // 强制覆盖或新增：直接写入
            return { value: remoteTags, shouldWrite: true }
          }
          // 普通更新：合并本地和远程标签
          const value = appendValueWithSeparator(oldCellValue, remoteTags)
          if (value !== oldCellValue) {
            return { value, shouldWrite: true }
          }
        }
      }
      return { value: null, shouldWrite: false }
    }
    case '集数': {
      if (isWriteAll || fields.includes('集数')) {
        return { value: remote['话数'] ?? '', shouldWrite: true }
      }
      return { value: null, shouldWrite: false }
    }
    default: {
      // 扩展字段：根据列名查找对应的 JSONL 字段（支持别名列映射，如「制作公司」/「动画制作公司」）
      for (const [jsonlField] of EXTENDED_FIELD_MAP) {
        const aliases = getExcelAliases(jsonlField)
        if (aliases.includes(wc.name)) {
          if (isWriteAll || aliases.some((a) => fields.includes(a))) {
            const v = remote[jsonlField as keyof GithubRemoteEntry]
            if (typeof v === 'string') {
              return {
                value: DATE_COLUMNS.has(wc.name) ? (formatDateToLocal(v) ?? v) : v,
                shouldWrite: true,
              }
            }
            if (typeof v === 'number') {
              return { value: String(v), shouldWrite: true }
            }
          }
          return { value: null, shouldWrite: false }
        }
      }
      return { value: null, shouldWrite: false }
    }
  }
}
