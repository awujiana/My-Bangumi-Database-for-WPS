// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/template-file.ts` 单测（同步面板「模板文件」区块）
 *
 * 这个模块此前**没有任何测试**，而它是「帮助与格式」区块的全部接线：拉一次
 * Release 信息 → 写说明行 → 三个按钮（下载 / 复制链接 / 打开 Release 页）。
 * 三条值得钉住的行为：
 *
 *  1. **首屏文案要跟语言走**：HTML 里写死的是中文「正在获取最新版本…」，拉取是
 *     异步的，网络慢时这段会停留好几秒 —— 英文界面就一直露中文。它又不能挂
 *     `data-i18n`（紧接着会被版本信息覆盖，切语言时 `applyI18n()` 会把版本信息
 *     冲回「正在获取…」），所以必须在请求前按当前语言写一次。
 *  2. **只查一次**：接口未鉴权限流 60 次/小时/IP，反复开关面板不该反复问。
 *  3. **查不到也要给下一步动作**：回落文案必须让用户知道「去 Release 页挑最新的」，
 *     而不是一句「失败」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  showToast: vi.fn(),
  fetchLatestTemplate: vi.fn(),
  copyTextToClipboard: vi.fn(),
}))

vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  bgmLog: mocks.bgmLog,
  showToast: mocks.showToast,
}))

// 只换掉网络那一层，`formatTemplateMeta` / `TEMPLATE_FALLBACK` 用真实实现 ——
// 本文件要验的正是「UI 有没有把 tOr 文案交给它」
vi.mock('../ts/tools/template-release.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/tools/template-release.js')>()
  return { ...actual, fetchLatestTemplate: mocks.fetchLatestTemplate }
})

vi.mock('../ts/ui/handlers/clipboard.js', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
}))

// tOr 直接回显 key：断言「用了哪个 key」比断言中文原文更能防回归
vi.mock('../ts/i18n/locale-store.js', () => ({
  tOr: (key: string) => `[${key}]`,
}))

import type { TemplateReleaseInfo } from '../ts/tools/template-release.js'
import { TEMPLATE_FALLBACK } from '../ts/tools/template-release.js'
import {
  copyTemplateLink,
  downloadTemplateFile,
  loadTemplateFileInfo,
  openTemplateReleasePage,
  resetTemplateFileForTest,
} from '../ts/ui/handlers/template-file.js'

/** 造一条「已解析」的 Release 信息 */
function resolvedInfo(overrides: Partial<TemplateReleaseInfo> = {}): TemplateReleaseInfo {
  return {
    tag: '2026.10.27',
    assetName: 'ani-bangumi-type2-2026-10-27-template.xlsx',
    size: 8_122_242,
    downloadUrl: 'https://example.test/download/template.xlsx',
    pageUrl: 'https://example.test/releases/latest',
    resolved: true,
    ...overrides,
  }
}

/** 挂一个 `#templateFileMeta` 元素并返回它 */
function mountMeta(): HTMLElement {
  const element = document.createElement('div')
  element.id = 'templateFileMeta'
  document.body.append(element)
  return element
}

beforeEach(() => {
  resetTemplateFileForTest()
  mocks.fetchLatestTemplate.mockReset()
  mocks.showToast.mockReset()
  mocks.copyTextToClipboard.mockReset()
  mocks.bgmLog.mockReset()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('loadTemplateFileInfo · 首屏文案', () => {
  it('请求前先按当前语言写「正在获取最新版本…」', async () => {
    const meta = mountMeta()
    meta.textContent = '正在获取最新版本…'
    let textDuringFetch = ''
    mocks.fetchLatestTemplate.mockImplementation(() => {
      // 模拟「网络很慢」：这一刻用户看到的就是这行字
      textDuringFetch = meta.textContent
      return Promise.resolve(resolvedInfo())
    })

    await loadTemplateFileInfo()

    expect(textDuringFetch).toBe('[handlers.template.loading]')
    // 拉到之后由版本信息接管
    expect(meta.textContent).toContain('2026.10.27')
  })

  it('没有这个区块的页面（设置页等）不发请求', async () => {
    await loadTemplateFileInfo()
    expect(mocks.fetchLatestTemplate).not.toHaveBeenCalled()
  })

  it('只查一次：第二次调用直接返回', async () => {
    mountMeta()
    mocks.fetchLatestTemplate.mockResolvedValue(resolvedInfo())

    await loadTemplateFileInfo()
    await loadTemplateFileInfo()

    expect(mocks.fetchLatestTemplate).toHaveBeenCalledTimes(1)
  })
})

describe('loadTemplateFileInfo · 兜底', () => {
  it('拉取抛错时不冒泡，说明行回落成「去 Release 页挑最新的」', async () => {
    const meta = mountMeta()
    mocks.fetchLatestTemplate.mockRejectedValue(new Error('限流'))

    await expect(loadTemplateFileInfo()).resolves.toBeUndefined()

    expect(meta.textContent).toBe('[handlers.template.unresolved]')
  })

  it('接口返回未解析（resolved=false）时同样用 tOr 文案，不是工具层默认中文', async () => {
    const meta = mountMeta()
    mocks.fetchLatestTemplate.mockResolvedValue(TEMPLATE_FALLBACK)

    await loadTemplateFileInfo()

    // 工具层默认值也含「Release」，所以只断言「走的是 tOr 那条」
    expect(meta.textContent).toBe('[handlers.template.unresolved]')
  })

  it('解析成功时写「tag · 文件名 · 大小」', async () => {
    const meta = mountMeta()
    mocks.fetchLatestTemplate.mockResolvedValue(resolvedInfo())

    await loadTemplateFileInfo()

    expect(meta.textContent).toContain('2026.10.27')
    expect(meta.textContent).toContain('ani-bangumi-type2-2026-10-27-template.xlsx')
    expect(meta.textContent).toContain('·')
  })
})

describe('三个按钮', () => {
  it('下载：交给宿主导航（造 a 标签点击后移除）并提示可复制链接', async () => {
    mountMeta()
    mocks.fetchLatestTemplate.mockResolvedValue(resolvedInfo())
    await loadTemplateFileInfo()

    const clicked: string[] = []
    const originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this.href)
    }
    try {
      downloadTemplateFile()
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
    }

    expect(clicked).toEqual(['https://example.test/download/template.xlsx'])
    // 临时 a 标签必须清掉，否则每点一次就往 body 里堆一个
    expect(document.querySelectorAll('a')).toHaveLength(0)
    expect(mocks.showToast).toHaveBeenCalledWith('[handlers.template.opened]', 'info')
  })

  it('复制链接：成功 / 失败各给对应提示', async () => {
    mountMeta()
    mocks.fetchLatestTemplate.mockResolvedValue(resolvedInfo())
    await loadTemplateFileInfo()

    mocks.copyTextToClipboard.mockReturnValueOnce(true)
    copyTemplateLink()
    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(
      'https://example.test/download/template.xlsx',
    )
    expect(mocks.showToast).toHaveBeenCalledWith('[handlers.template.copied]', 'success')

    mocks.copyTextToClipboard.mockReturnValueOnce(false)
    copyTemplateLink()
    expect(mocks.showToast).toHaveBeenLastCalledWith('[common.copyFailedManual]', 'error')
  })

  it('打开 Release 页：新窗口导航到 pageUrl', async () => {
    mountMeta()
    mocks.fetchLatestTemplate.mockResolvedValue(resolvedInfo())
    await loadTemplateFileInfo()

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    openTemplateReleasePage()
    // 先把调用记录下来再 restore：`mockRestore()` 会连调用记录一起清掉
    const { calls } = openSpy.mock
    openSpy.mockRestore()

    expect(calls).toEqual([['https://example.test/releases/latest', '_blank']])
  })
})
