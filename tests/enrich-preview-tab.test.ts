/**
 * @fileoverview enrich-preview-tab 单测：「数据预览」页签的可见性与空态文案
 *
 * 切页签曾经是"两处各管一半"：切到匹配页后新番表页签仍残留匹配统计卡片、
 * 匹配页仍残留「查看详细数据表格」。收敛后由 `applyPreviewTabVisibility` 单点决定，
 * 这里把 source / match 两种页签下的每个元素显示状态逐条锁死。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 只隔离富化引擎：preview-tab 只用到 isBangumiSheetEmpty 一个函数，
// 真实模块会连带加载整条 WPS 依赖链。
vi.mock('../ts/sync/enrich-engine.js', () => ({
  isBangumiSheetEmpty: vi.fn(() => false),
}))

import { isBangumiSheetEmpty } from '../ts/sync/enrich-engine.js'
import { state } from '../ts/panel/enrich-page-context.js'
import {
  setPreviewTab,
  applyPreviewTabVisibility,
  setPreviewElementVisible,
  refreshMatchHintText,
  resetMatchResults,
} from '../ts/panel/enrich-preview-tab.js'
import type { MatchResult } from '../ts/sync/enrich-engine.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'

const IDS = [
  'sourcePreviewTable',
  'sourceDetailAction',
  'sourcePreviewHint',
  'matchEmptyHint',
  'matchPreviewAction',
  'matchStats',
  'matchPreviewTable',
] as const

function mountDom(): void {
  document.body.replaceChildren()
  for (const id of IDS) {
    const element = document.createElement('div')
    element.id = id
    element.textContent = '占位'
    document.body.appendChild(element)
  }
  const table = document.createElement('table')
  table.id = 'matchTable'
  table.innerHTML = '<tbody><tr><td>旧结果</td></tr></tbody>'
  document.body.appendChild(table)

  for (const tab of ['source', 'match']) {
    const element = document.createElement('button')
    element.className = 'preview-tab'
    element.dataset.tab = tab
    document.body.appendChild(element)
  }
}

function displayOf(id: string): string {
  return document.getElementById(id)?.style.display ?? ''
}

/** 造一条最小 MatchResult（只用 matchType） */
function makeMatch(matchType: string): MatchResult {
  return { matchType } as unknown as MatchResult
}

beforeEach(() => {
  vi.clearAllMocks()
  mountDom()
  state.activePreviewTab = 'source'
  state.matches = []
  state.hasSourcePreview = false
  state.bangumiSheet = null
  // 默认：目标表非空
  ;(isBangumiSheetEmpty as ReturnType<typeof vi.fn>).mockReturnValue(false)
})

describe('setPreviewElementVisible', () => {
  it('isVisible=false 一律隐藏；true 时清空 display', () => {
    setPreviewElementVisible('matchStats', false)
    expect(displayOf('matchStats')).toBe('none')
    setPreviewElementVisible('matchStats', true)
    expect(displayOf('matchStats')).toBe('')
  })

  it('hasTextOnly=true 且文本为空时即便 isVisible 也隐藏（避免空白占位）', () => {
    const hint = document.getElementById('matchEmptyHint')
    if (hint) hint.textContent = ''
    setPreviewElementVisible('matchEmptyHint', true, true)
    expect(displayOf('matchEmptyHint')).toBe('none')

    if (hint) hint.textContent = '有文案'
    setPreviewElementVisible('matchEmptyHint', true, true)
    expect(displayOf('matchEmptyHint')).toBe('')
  })

  it('元素不存在时静默返回，不抛错', () => {
    expect(() => setPreviewElementVisible('notExist', true)).not.toThrow()
  })
})

describe('applyPreviewTabVisibility', () => {
  it('source 页签：显示源表格/源详情/源提示，隐藏匹配区', () => {
    state.activePreviewTab = 'source'
    state.hasSourcePreview = true
    applyPreviewTabVisibility()

    expect(displayOf('sourcePreviewTable')).toBe('')
    expect(displayOf('sourceDetailAction')).toBe('')
    expect(displayOf('sourcePreviewHint')).toBe('')
    expect(displayOf('matchPreviewAction')).toBe('none')
    expect(displayOf('matchStats')).toBe('none')
    expect(displayOf('matchPreviewTable')).toBe('none')
  })

  it('source 页签但未渲染过源预览：「查看详细数据表格」不出现', () => {
    state.activePreviewTab = 'source'
    state.hasSourcePreview = false
    applyPreviewTabVisibility()
    expect(displayOf('sourceDetailAction')).toBe('none')
    expect(displayOf('sourcePreviewTable')).toBe('')
  })

  it('match 页签且有匹配结果：显示统计与表格，隐藏源预览区', () => {
    state.activePreviewTab = 'match'
    state.matches = [makeMatch('exact')]
    applyPreviewTabVisibility()

    expect(displayOf('matchPreviewAction')).toBe('')
    expect(displayOf('matchStats')).toBe('')
    expect(displayOf('matchPreviewTable')).toBe('')
    expect(displayOf('sourcePreviewTable')).toBe('none')
    expect(displayOf('sourceDetailAction')).toBe('none')
  })

  it('match 页签但无匹配结果：不展示空统计/空表格', () => {
    state.activePreviewTab = 'match'
    state.matches = []
    applyPreviewTabVisibility()
    expect(displayOf('matchStats')).toBe('none')
    expect(displayOf('matchPreviewTable')).toBe('none')
    // 「预览匹配」按钮仍应可见（否则用户无从触发）
    expect(displayOf('matchPreviewAction')).toBe('')
  })
})

describe('refreshMatchHintText', () => {
  it('未选择目标表：提示先选目标表', () => {
    state.bangumiSheet = null
    refreshMatchHintText()
    expect(document.getElementById('matchEmptyHint')?.textContent).toContain('请先选择目标')
  })

  it('已选目标表但未预览：引导点击「预览匹配」', () => {
    state.bangumiSheet = {} as unknown as WpsWorksheet
    state.matches = []
    refreshMatchHintText()
    expect(document.getElementById('matchEmptyHint')?.textContent).toContain('尚未预览匹配')
  })

  it('目标表为空且有未匹配项：提示富化时将新增行数', () => {
    state.bangumiSheet = {} as unknown as WpsWorksheet
    ;(isBangumiSheetEmpty as ReturnType<typeof vi.fn>).mockReturnValue(true)
    state.matches = [makeMatch('unmatched'), makeMatch('unmatched'), makeMatch('exact')]
    refreshMatchHintText()
    expect(document.getElementById('matchEmptyHint')?.textContent).toBe(
      '目标表暂无数据，富化时将新增 2 行',
    )
  })

  it('其余情况清空文案（配合 hasTextOnly 自动隐藏）', () => {
    state.bangumiSheet = {} as unknown as WpsWorksheet
    state.matches = [makeMatch('exact')]
    refreshMatchHintText()
    expect(document.getElementById('matchEmptyHint')?.textContent).toBe('')
  })
})

describe('setPreviewTab', () => {
  it('同步页签 active 样式 + 刷新各区块可见性', () => {
    setPreviewTab('match')
    expect(state.activePreviewTab).toBe('match')

    const tabs = [...document.querySelectorAll<HTMLElement>('.preview-tab')]
    expect(tabs.find((t) => t.dataset.tab === 'match')?.classList.contains('active')).toBe(true)
    expect(tabs.find((t) => t.dataset.tab === 'source')?.classList.contains('active')).toBe(false)

    // match 页签下源预览表格应被隐藏
    expect(displayOf('sourcePreviewTable')).toBe('none')
  })
})

describe('resetMatchResults', () => {
  it('清空 state.matches 与匹配表格 tbody，并刷新提示/可见性', () => {
    state.activePreviewTab = 'match'
    state.matches = [makeMatch('exact')]
    resetMatchResults()

    expect(state.matches).toEqual([])
    expect(document.querySelector('#matchTable tbody')?.children).toHaveLength(0)
    // 无匹配结果 → 不展示空表格
    expect(displayOf('matchPreviewTable')).toBe('none')
  })
})
