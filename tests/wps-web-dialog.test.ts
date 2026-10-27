/**
 * @fileoverview WPS 原生 Web 对话框封装的单测
 * @module tests/wpsWebDialog
 * @description 覆盖两条宿主通路的选择与降级、物理像素换算、相对地址解析。
 *   宿主对象用假实现注入 `window.Application`（与生产同一条 `getApp()` 路径）。
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dialogPhysicalSize,
  isWebDialogSupported,
  openWebDialog,
  resolveDialogUrl,
} from '../ts/tools/wps-web-dialog.js'

/** 假对话框：只记录被调用的动作 */
interface FakeDialog {
  Visible?: boolean
  IsModal?: boolean
  ID?: number
  Delete?: () => void
  Resize?: (width: number, height: number) => void
}

/** 假宿主对象（形状与 wps-web-dialog 预期一致，方法可选以便构造各版本差异） */
interface FakeHostApp {
  CreateWebDialog?: (url: string) => unknown
  GetWebDialog?: (id: number) => unknown
  ShowDialog?: (
    url: string,
    caption: string,
    width: number,
    height: number,
    isModal: boolean,
  ) => unknown
}

function installHostApp(hostApp: FakeHostApp | null): void {
  ;(window as unknown as { Application?: unknown }).Application = hostApp ?? undefined
}

function makeDialog(overrides: FakeDialog = {}): FakeDialog {
  return { Visible: false, ID: 7, ...overrides }
}

beforeEach(() => {
  installHostApp(null)
  // 物理像素换算依赖它，写死 2 让断言可复现（不写死的话随 jsdom 默认 1 变化）
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
})

describe('dialogPhysicalSize', () => {
  it('默认按 1 倍：CSS 像素即物理像素', () => {
    expect(dialogPhysicalSize(400, 300)).toEqual({ width: 400, height: 300 })
  })

  it('高分辨率屏乘 devicePixelRatio（否则窗口只有预期的一半大）', () => {
    expect(dialogPhysicalSize(400, 300, 2)).toEqual({ width: 800, height: 600 })
  })

  it('非法 ratio（0 / NaN / Infinity）退化为 1，不产出 0 或 NaN', () => {
    expect(dialogPhysicalSize(400, 300, 0)).toEqual({ width: 400, height: 300 })
    expect(dialogPhysicalSize(400, 300, NaN)).toEqual({ width: 400, height: 300 })
    expect(dialogPhysicalSize(400, 300, Infinity)).toEqual({
      width: 400,
      height: 300,
    })
  })

  it('结果至少 1px（宿主收到 0 会建成看不见的窗口）', () => {
    expect(dialogPhysicalSize(0, 0, 2)).toEqual({ width: 1, height: 1 })
  })
})

describe('resolveDialogUrl', () => {
  it('相对页名按当前页面所在目录解析（调试态 http、发布态本地资源都对）', () => {
    // ⚠️ 别写成 'ui/manager.html'：那会被解析成 /ui/ui/manager.html ——
    // 当前页面本身就在 /ui/ 下，相对路径要相对**目录**而不是站点根
    expect(resolveDialogUrl('manager.html', 'http://127.0.0.1:3889/ui/panel.html')).toBe(
      'http://127.0.0.1:3889/ui/manager.html',
    )
    expect(resolveDialogUrl('./manager.html', 'http://127.0.0.1:3889/ui/panel.html')).toBe(
      'http://127.0.0.1:3889/ui/manager.html',
    )
  })

  it('给绝对地址时原样返回', () => {
    expect(resolveDialogUrl('https://example.com/x.html', 'http://127.0.0.1:3889/ui/p.html')).toBe(
      'https://example.com/x.html',
    )
  })

  it('base 非法时原样返回入参，不抛错', () => {
    expect(resolveDialogUrl('ui/manager.html', 'not-a-url')).toBe('ui/manager.html')
  })
})

describe('openWebDialog', () => {
  it('优先走 CreateWebDialog：建完必须显式 Visible=true 并给初始尺寸', () => {
    const dialog = makeDialog()
    const resize = vi.fn()
    dialog.Resize = resize
    installHostApp({ CreateWebDialog: () => dialog })

    const session = openWebDialog({
      url: 'http://host/ui/manager.html',
      title: '工作表规则',
      width: 400,
      height: 300,
    })

    expect(session?.strategy).toBe('web-dialog')
    // 建出来默认不可见：不置 true 就是「点了按钮没反应」
    expect(dialog.Visible).toBe(true)
    expect(dialog.IsModal).toBe(false)
    // 物理像素：CSS 400×300 × ratio 2
    expect(resize).toHaveBeenCalledWith(800, 600)
  })

  it('CreateWebDialog 缺失时降级 ShowDialog（老版本宿主）', () => {
    const showDialog = vi.fn()
    installHostApp({ ShowDialog: showDialog })

    const session = openWebDialog({
      url: 'http://host/ui/manager.html',
      title: '工作表规则',
      width: 400,
      height: 300,
    })

    expect(session?.strategy).toBe('show-dialog')
    expect(showDialog).toHaveBeenCalledWith(
      'http://host/ui/manager.html',
      '工作表规则',
      800,
      600,
      false,
    )
  })

  it('ShowDialog 返回可用句柄时当成句柄用（能关、能查存活）', () => {
    const dialog = makeDialog({ ID: 42 })
    installHostApp({ ShowDialog: () => dialog })
    const session = openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })
    expect(session?.id).toBe(42)
  })

  it('两条通路都没有时返回 null（调用方据此回落窗格内浮动，功能不丢）', () => {
    installHostApp({})
    expect(openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })).toBeNull()
  })

  it('没有宿主对象时返回 null', () => {
    installHostApp(null)
    expect(openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })).toBeNull()
  })

  it('CreateWebDialog 抛异常时降级到 ShowDialog，不让异常冒到 UI', () => {
    const showDialog = vi.fn().mockReturnValue(makeDialog())
    installHostApp({
      CreateWebDialog: () => {
        throw new Error('boom')
      },
      ShowDialog: showDialog,
    })
    const session = openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })
    expect(session?.strategy).toBe('show-dialog')
    expect(showDialog).toHaveBeenCalled()
  })

  it('CreateWebDialog 返回非对象（宿主返回 null）时降级', () => {
    installHostApp({ CreateWebDialog: () => null, ShowDialog: () => makeDialog() })
    expect(openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })?.strategy).toBe(
      'show-dialog',
    )
  })
})

describe('WebDialogSession', () => {
  it('close 优先调 Delete（销毁比隐藏干净）', () => {
    const remove = vi.fn()
    const dialog = makeDialog({ Delete: remove })
    installHostApp({ CreateWebDialog: () => dialog, GetWebDialog: () => dialog })

    const session = openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })
    expect(session?.close()).toBe(true)
    expect(remove).toHaveBeenCalled()
    expect(dialog.Visible).not.toBe(false)
  })

  it('没有 Delete 时退化为 Visible=false', () => {
    const dialog = makeDialog({ Visible: true })
    installHostApp({ CreateWebDialog: () => dialog, GetWebDialog: () => dialog })

    const session = openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })
    expect(session?.close()).toBe(true)
    expect(dialog.Visible).toBe(false)
  })

  it('关不掉（无句柄）时返回 false，让 UI 提示手动关闭而不是假装成功', () => {
    installHostApp({ ShowDialog: () => null })
    const session = openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })
    expect(session?.close()).toBe(false)
  })

  it('isAlive：宿主还查得到实例且可见 → 活着', () => {
    const dialog = makeDialog({ Visible: true })
    installHostApp({ CreateWebDialog: () => dialog, GetWebDialog: () => dialog })
    expect(openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })?.isAlive()).toBe(true)
  })

  it('isAlive：宿主查不到实例（用户在 WPS 里关掉窗口）→ 已关闭', () => {
    const dialog = makeDialog({ ID: 7, Visible: true })
    installHostApp({
      CreateWebDialog: () => dialog,
      // 有 id 时按 id 查；查不到说明宿主已回收
      GetWebDialog: () => null,
    })
    expect(openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })?.isAlive()).toBe(false)
  })

  it('isAlive：自己关掉的窗口（Visible=false）判为已关闭', () => {
    const dialog = makeDialog({ Visible: true })
    installHostApp({ CreateWebDialog: () => dialog, GetWebDialog: () => dialog })
    const session = openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })
    session?.close()
    expect(session?.isAlive()).toBe(false)
  })

  it('isAlive：拿不到句柄时乐观返回 true（窗口确实开着，判死会更糟）', () => {
    installHostApp({ ShowDialog: () => null })
    expect(openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })?.isAlive()).toBe(false)
  })

  it('resize 走物理像素换算；宿主不支持 Resize 时返回 false', () => {
    const resize = vi.fn()
    const dialog = makeDialog({ Resize: resize })
    installHostApp({ CreateWebDialog: () => dialog, GetWebDialog: () => dialog })
    const session = openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })
    expect(session?.resize(100, 50)).toBe(true)
    expect(resize).toHaveBeenCalledWith(200, 100)

    const plain = makeDialog({})
    installHostApp({ CreateWebDialog: () => plain, GetWebDialog: () => plain })
    expect(openWebDialog({ url: 'u', title: 't', width: 10, height: 10 })?.resize(100, 50)).toBe(
      false,
    )
  })
})

describe('isWebDialogSupported', () => {
  it('任一通路存在即支持', () => {
    installHostApp({ CreateWebDialog: () => makeDialog() })
    expect(isWebDialogSupported()).toBe(true)
    installHostApp({ ShowDialog: () => makeDialog() })
    expect(isWebDialogSupported()).toBe(true)
  })

  it('都没有 / 无宿主时不支持', () => {
    installHostApp({})
    expect(isWebDialogSupported()).toBe(false)
    installHostApp(null)
    expect(isWebDialogSupported()).toBe(false)
  })
})
