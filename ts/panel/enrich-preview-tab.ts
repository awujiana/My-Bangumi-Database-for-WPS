/**
 * @fileoverview 富化页「数据预览」页签的可见性与提示文案
 * @module panel/enrich-preview-tab
 * @description
 *   页签切换（source=新番表数据 / match=匹配结果）会牵动一批预览区元素的显示
 *   与空态文案。这些函数被「初始化 / 表头识别 / 目标工作表选择 / 匹配预览 /
 *   富化执行」等多处调用，原先散落在 `enrich-page.ts` 的两个区块里。抽成叶子
 *   后，各流程模块可以单向依赖它而不必反向依赖 `enrich-page.ts`。
 *
 *   收口原则：**显示与否一律由 `applyPreviewTabVisibility` 决定**，其余函数只写
 *   内容或只切页签，避免"两处各管一半"导致切页签后残留上一个页签的提示。
 */

import { isBangumiSheetEmpty } from '../sync/enrich-engine.js'
import { state, safeGetElement } from './enrich-page-context.js'

/** 设置预览区元素的显示/隐藏；hasTextOnly=true 时文本为空则强制隐藏 */
export function setPreviewElementVisible(
  id: string,
  isVisible: boolean,
  hasTextOnly = false,
): void {
  const element = safeGetElement(id)
  if (!element) return
  const hasText = element.textContent.trim().length > 0
  element.style.display = isVisible && (!hasTextOnly || hasText) ? '' : 'none'
}

/**
 * 按当前页签统一设置「数据预览」各区块可见性。
 *
 * 目的：修复切换页签后残留上一个页签的提示/按钮（如新番表页签仍显示匹配统计卡片，
 * 或匹配结果页签仍显示「查看详细数据表格」），以及未预览时展示空白/仅表头表格的问题。
 */
export function applyPreviewTabVisibility(): void {
  const isMatchTab = state.activePreviewTab === 'match'
  const hasMatches = state.matches.length > 0

  setPreviewElementVisible('sourcePreviewTable', !isMatchTab)
  setPreviewElementVisible('sourceDetailAction', !isMatchTab && state.hasSourcePreview)

  // 提示类元素：仅在有文案时才显示，避免空白占位
  setPreviewElementVisible('sourcePreviewHint', !isMatchTab, true)
  setPreviewElementVisible('matchEmptyHint', isMatchTab, true)

  // 「预览匹配」按钮仅在「匹配结果」页签显示
  setPreviewElementVisible('matchPreviewAction', isMatchTab)

  // 统计卡片与匹配表格：仅匹配结果页签且已有匹配结果时显示（未预览前不展示空表格）
  setPreviewElementVisible('matchStats', isMatchTab && hasMatches)
  setPreviewElementVisible('matchPreviewTable', isMatchTab && hasMatches)
}

/** 切换「数据预览」页签（统一入口：同步 active 样式 + 各区块可见性） */
export function setPreviewTab(tab: 'source' | 'match'): void {
  state.activePreviewTab = tab

  const tabs = document.querySelectorAll<HTMLElement>('.preview-tab')
  tabs.forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab)
  })

  // 切到匹配结果页时刷新空态提示文案（可能尚未预览 / 目标表未选）
  refreshMatchHintText()
  applyPreviewTabVisibility()
}

/**
 * 刷新匹配结果页签的提示文案（只写文案，显示与否由 applyPreviewTabVisibility 决定）。
 *
 * 三种状态：
 *   1. 尚未预览：给出「点击预览匹配」的引导，避免页签空白；
 *   2. 目标表为空且有未匹配条目：提示富化时将新增行数；
 *   3. 其余：清空文案（自动隐藏）。
 */
export function refreshMatchHintText(): void {
  const hintElement = safeGetElement('matchEmptyHint')
  if (!hintElement) return

  if (state.matches.length === 0) {
    hintElement.textContent = state.bangumiSheet
      ? '尚未预览匹配，点击「预览匹配」查看新番表与目标表的匹配结果'
      : '请先选择目标 Bangumi 工作表，再点击「预览匹配」'
    return
  }

  const pendingCount = state.matches.filter((m) => m.matchType === 'unmatched').length
  hintElement.textContent =
    state.bangumiSheet && isBangumiSheetEmpty(state.bangumiSheet) && pendingCount > 0
      ? `目标表暂无数据，富化时将新增 ${String(pendingCount)} 行`
      : ''
}

/** 清空匹配结果（切换源表/重新识别表头时调用，避免展示过期结果） */
export function resetMatchResults(): void {
  state.matches = []
  const tbody = safeGetElement('matchTable')?.querySelector('tbody')
  if (tbody) tbody.replaceChildren()
  refreshMatchHintText()
  applyPreviewTabVisibility()
}
