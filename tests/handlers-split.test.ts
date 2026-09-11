// @vitest-environment jsdom
/**
 * handlers 拆分模块单元测试（panel-context / log-panel）
 *
 * 覆盖：
 *  - isPanelContext：无 window 早退、panel.html 判定、其他页面判定
 *  - renderLogEntries：缺失容器早退、空日志占位、按级别传入 getRecentLogs、
 *    条目渲染（class 与文本）、重复渲染先清空、渲染后滚动到底部
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getRecentLogs } from '../ts/tools/logger.js'
import type { LogEntry } from '../ts/tools/logger.js'
import { renderLogEntries } from '../ts/ui/handlers/log-panel.js'
import { isPanelContext } from '../ts/ui/handlers/panel-context.js'

vi.mock('../ts/tools/logger.js', () => ({
  getRecentLogs: vi.fn(() => []),
}))

function stubLogs(entries: LogEntry[]): void {
  vi.mocked(getRecentLogs).mockReturnValue(entries)
}

/** 创建日志弹窗容器并挂到文档上 */
function mountLogBody(): HTMLDivElement {
  const body = document.createElement('div')
  body.id = 'logModalBody'
  document.body.append(body)
  return body
}

describe('ui/handlers/panel-context', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('无 window 时返回 false', () => {
    // jsdom 环境自带 window，需临时移除才能覆盖早退分支
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'window')
    try {
      expect(isPanelContext()).toBe(false)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    }
  })

  it('路径含 panel.html 时返回 true', () => {
    vi.stubGlobal('window', { location: { pathname: '/ui/panel.html' } })
    expect(isPanelContext()).toBe(true)
  })

  it('路径不含 panel.html 时返回 false', () => {
    vi.stubGlobal('window', { location: { pathname: '/ui/settings.html' } })
    expect(isPanelContext()).toBe(false)
  })
})

describe('ui/handlers/log-panel · renderLogEntries', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('容器不存在时早退且不读取日志', () => {
    renderLogEntries()
    expect(getRecentLogs).not.toHaveBeenCalled()
  })

  it('无日志时显示占位文案', () => {
    const body = mountLogBody()
    stubLogs([])

    renderLogEntries()

    expect(body.textContent).toBe('暂无日志')
    expect(body.children).toHaveLength(0)
  })

  it('无筛选下拉框时向 getRecentLogs 传 undefined 级别', () => {
    mountLogBody()
    stubLogs([])

    renderLogEntries()

    expect(getRecentLogs).toHaveBeenCalledWith(undefined, 100)
  })

  it('下拉框有值时按该级别筛选', () => {
    mountLogBody()
    const select = document.createElement('select')
    select.id = 'logLevelFilter'
    const option = document.createElement('option')
    option.value = 'ERROR'
    select.append(option)
    select.value = 'ERROR'
    document.body.append(select)
    stubLogs([])

    renderLogEntries()

    expect(getRecentLogs).toHaveBeenCalledWith('ERROR', 100)
  })

  it('渲染条目：级别小写类名 + 时间/级别/消息文本', () => {
    const body = mountLogBody()
    stubLogs([{ level: 'WARN', message: '磁盘空间不足', timestamp: 0 }])

    renderLogEntries()

    const entries = body.querySelectorAll('.log-entry')
    expect(entries).toHaveLength(1)
    const first = entries[0]
    expect(first?.className).toContain('log-warn')
    expect(first?.textContent).toContain('[WARN]')
    expect(first?.textContent).toContain('磁盘空间不足')
  })

  it('重复渲染前先清空旧条目', () => {
    const body = mountLogBody()
    stubLogs([{ level: 'INFO', message: '第一条', timestamp: 0 }])
    renderLogEntries()
    stubLogs([{ level: 'INFO', message: '第二条', timestamp: 0 }])

    renderLogEntries()

    expect(body.children).toHaveLength(1)
    expect(body.textContent).toContain('第二条')
    expect(body.textContent).not.toContain('第一条')
  })

  it('渲染后滚动到底部', () => {
    const body = mountLogBody()
    stubLogs([{ level: 'INFO', message: 'x', timestamp: 0 }])
    Object.defineProperty(body, 'scrollHeight', { value: 480, configurable: true })

    renderLogEntries()

    expect(body.scrollTop).toBe(480)
  })
})
