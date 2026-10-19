/**
 * @fileoverview 富化详情弹窗的纯渲染逻辑
 * @module panel/enrichDetailRender
 * @description 从 enrich-page.ts 抽出的纯函数簇：匹配方式/字段操作枚举→中文标记映射，
 * 以及「分组 → 条目 → 字段」三级 HTML 渲染。全部无 DOM 副作用，便于单测。
 */

import type {
  EnrichedField,
  EnrichResultItem,
  MatchResult,
} from '../sync/enrich-types.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { escapeHtml } from '../tools/string-utilities.js'

/** 详情弹窗中的一个文件分组（含该文件全部富化条目） */
export interface EnrichDetailGroup {
  fileName: string
  items: EnrichResultItem[]
}

/** 把匹配方式枚举映射为用户可读的中文标记 */
export function matchTypeLabel(matchType: MatchResult['matchType']): {
  text: string
  badge: string
} {
  switch (matchType) {
    case 'exact': {
      return { text: '精确命中', badge: 'exact' }
    }
    case 'alias': {
      return { text: '别名匹配', badge: 'alias' }
    }
    case 'error': {
      return { text: '错误', badge: 'error' }
    }
    default: {
      return { text: '新增/未匹配', badge: 'unmatched' }
    }
  }
}

/** 把富化操作枚举映射为中文标记 */
export function fieldActionLabel(action: EnrichedField['action']): { text: string; cls: string } {
  switch (action) {
    case 'fill': {
      return { text: '填充', cls: 'fill' }
    }
    case 'append': {
      return { text: '追加', cls: 'append' }
    }
    default: {
      return { text: '跳过', cls: 'skip' }
    }
  }
}

export function renderEnrichDetailHtml(groups: EnrichDetailGroup[]): string {
  if (groups.length === 0) {
    return '暂无富化数据，请先执行富化'
  }

  const totalMatched = groups.reduce(
    (sum, group) => sum + group.items.filter((r) => r.kind === 'matched').length,
    0,
  )
  const totalUnmatched = groups.reduce(
    (sum, group) => sum + group.items.filter((r) => r.kind === 'unmatched').length,
    0,
  )
  const totalErrors = groups.reduce(
    (sum, group) => sum + group.items.filter((r) => r.kind === 'error').length,
    0,
  )
  const totalFields = groups.reduce(
    (sum, group) =>
      sum +
      group.items.reduce(
        (s, item) => s + item.enrichedFields.filter((f) => f.action !== 'skip').length,
        0,
      ),
    0,
  )

  const summaryHtml = `
    <div class="enrich-detail-summary">
      <div class="enrich-detail-stat matched">
        <div class="enrich-detail-stat-num">${String(totalMatched)}</div>
        <div class="enrich-detail-stat-label">已匹配</div>
      </div>
      <div class="enrich-detail-stat unmatched">
        <div class="enrich-detail-stat-num">${String(totalUnmatched)}</div>
        <div class="enrich-detail-stat-label">未匹配</div>
      </div>
      <div class="enrich-detail-stat error">
        <div class="enrich-detail-stat-num">${String(totalErrors)}</div>
        <div class="enrich-detail-stat-label">错误</div>
      </div>
      <div class="enrich-detail-stat field">
        <div class="enrich-detail-stat-num">${String(totalFields)}</div>
        <div class="enrich-detail-stat-label">字段更新</div>
      </div>
    </div>
  `

  const entriesHtml = groups.map((group) => renderEnrichDetailGroup(group)).join('')

  return sanitizeHtml(`${summaryHtml}${entriesHtml}`)
}

function renderEnrichDetailGroup(group: EnrichDetailGroup): string {
  if (group.items.length === 0) {
    return `<div class="enrich-detail-group empty">${escapeHtml(group.fileName)}：无条目</div>`
  }

  const entries = group.items.map((item) => renderEnrichDetailEntry(item)).join('')
  return `
    <div class="enrich-detail-group">
      <div class="enrich-detail-group-title">📄 ${escapeHtml(group.fileName)}</div>
      <div class="enrich-detail-entries">${entries}</div>
    </div>
  `
}

function renderEnrichDetailEntry(item: EnrichResultItem): string {
  const name = escapeHtml(item.name)
  const headBadge = item.matchType ? matchTypeLabel(item.matchType) : null

  if (item.kind === 'error') {
    const badge = headBadge ?? matchTypeLabel('error')
    const errorMessage = escapeHtml(item.errorMessage ?? '未知错误')
    return `
      <div class="enrich-detail-entry">
        <div class="enrich-detail-entry-head">
          <span class="enrich-detail-entry-name">${name}</span>
          <span class="enrich-detail-entry-badge ${badge.badge}">${badge.text}</span>
        </div>
        <div class="enrich-detail-entry-error">${errorMessage}</div>
      </div>
    `
  }

  if (item.kind === 'unmatched') {
    const badge = headBadge ?? matchTypeLabel('unmatched')
    return `
      <div class="enrich-detail-entry">
        <div class="enrich-detail-entry-head">
          <span class="enrich-detail-entry-name">${name}</span>
          <span class="enrich-detail-entry-badge ${badge.badge}">${badge.text}</span>
        </div>
      </div>
    `
  }

  const badge = headBadge ?? matchTypeLabel('exact')
  const hasFields = item.enrichedFields.length > 0
  const fieldsHtml = hasFields
    ? `
      <table class="enrich-detail-fields">
        <thead>
          <tr>
            <th>字段</th>
            <th>原值</th>
            <th></th>
            <th>新值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${item.enrichedFields.map((field) => renderEnrichDetailField(field)).join('')}
        </tbody>
      </table>
    `
    : `<div class="enrich-detail-entry-error enrich-detail-empty">该条目无字段变更</div>`

  return `
    <div class="enrich-detail-entry">
      <div class="enrich-detail-entry-head">
        <span class="enrich-detail-entry-name">${name}</span>
        <span class="enrich-detail-entry-badge ${badge.badge}">${badge.text}</span>
      </div>
      ${fieldsHtml}
    </div>
  `
}

function renderEnrichDetailField(field: EnrichedField): string {
  const fieldName = escapeHtml(field.fieldName)
  const oldValue = escapeHtml(field.oldValue ?? '（空）')
  const updatedValue = escapeHtml(field.updatedValue || '（空）')
  const action = fieldActionLabel(field.action)
  return `
    <tr>
      <td class="field-name">${fieldName}</td>
      <td class="field-old">${oldValue}</td>
      <td class="field-arrow">→</td>
      <td class="field-new">${updatedValue}</td>
      <td class="field-action ${action.cls}">${action.text}</td>
    </tr>
  `
}
