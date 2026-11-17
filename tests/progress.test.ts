/**
 * @fileoverview 通用进度组件（ts/ui/components/progress.ts）单元测试
 * @description
 * 覆盖三种渲染模式、进度更新边界、日志上限、完成态与销毁生命周期。
 *
 * ⚠️ 关键回归点：真实加载项环境会先加载 libs/purify.js（DOMPurify UMD），
 * `sanitizeHtml` 走严格白名单路径；若组件模板依赖的属性不在 ALLOWED_ATTR 中，
 * 属性会被剥离导致 `collectElements` 抛错。jsdom 默认没有 DOMPurify，
 * 会走 fallback（保留 data-*），因此必须在用例中**显式注入真实 DOMPurify**，
 * 否则这类问题在单测里永远暴露不出来。
 */

// @vitest-environment jsdom

import DOMPurify from 'dompurify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  appendProgressLog,
  completeProgress,
  createProgress,
  formatDuration,
  getActiveProgress,
  hideProgress,
  showProgress,
  updateProgress,
} from '../ts/ui/components/progress.js'

/** DOMPurify 挂到 globalThis 后的形状（与 ts/tools/sanitize.ts 的检测口径一致） */
interface PurifyGlobal {
  DOMPurify?: typeof DOMPurify
}

/**
 * 复现加载项运行时的清洗路径：所有任务窗格都会先加载 libs/purify.js（DOMPurify 3.4.12 UMD），
 * 使 sanitizeHtml 走严格白名单而非降级路径。node_modules 中的 dompurify 与之同版本。
 */
function installRealDomPurify(): void {
  const host = globalThis as PurifyGlobal
  host.DOMPurify = DOMPurify
}

/** 当前全局是否已注入 DOMPurify */
function hasRealDomPurify(): boolean {
  const host = globalThis as PurifyGlobal
  return typeof host.DOMPurify?.sanitize === 'function'
}

/** 创建并挂载一个 inline 宿主容器 */
function makeHost(id = 'progress-host'): HTMLElement {
  const host = document.createElement('div')
  host.id = id
  document.body.appendChild(host)
  return host
}

/**
 * 查询测试自建 fixture 中的元素
 * @remarks 用显式断言函数而非 `as`/`!`：`as` 会掩盖类型退化（Element 缺 style/dataset），
 * 缺失时抛出的中文错误也比「Cannot read properties of null」更易定位。
 */
function pickElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`测试 fixture 缺少元素: ${selector}`)
  return element
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  hideProgress()
  vi.restoreAllMocks()
})

describe('formatDuration', () => {
  it('0 与负数归零', () => {
    expect(formatDuration(0)).toBe('0.00秒')
    expect(formatDuration(-1000)).toBe('0.00秒')
  })

  it('小于 1 秒保留两位小数', () => {
    expect(formatDuration(1)).toBe('0.00秒')
    expect(formatDuration(500)).toBe('0.50秒')
  })

  it('999ms 截断显示 0.99秒（不再四舍五入成与 1000ms 冲突的「1.00秒」）', () => {
    expect(formatDuration(999)).toBe('0.99秒')
    expect(formatDuration(995)).toBe('0.99秒')
    expect(formatDuration(999.9)).toBe('0.99秒')
  })

  it('1 秒至 59 秒取整秒', () => {
    expect(formatDuration(1000)).toBe('1秒')
    expect(formatDuration(59_000)).toBe('59秒')
    expect(formatDuration(59_999)).toBe('59秒')
  })

  it('整分钟不显示秒', () => {
    expect(formatDuration(60_000)).toBe('1分')
    expect(formatDuration(120_000)).toBe('2分')
  })

  it('非整分钟补零到两位', () => {
    expect(formatDuration(61_000)).toBe('1分01秒')
    expect(formatDuration(125_000)).toBe('2分05秒')
  })

  it('超长耗时（2 小时）仍以分钟累计', () => {
    expect(formatDuration(7_200_000)).toBe('120分')
  })
})

describe('createProgress 挂载与模式', () => {
  it('inline 模式缺少 hostId 返回 null', () => {
    expect(createProgress({ mode: 'inline', title: '清理' })).toBeNull()
  })

  it('inline 模式 hostId 对应的容器不存在时返回 null', () => {
    expect(createProgress({ mode: 'inline', title: '清理', hostId: 'nope' })).toBeNull()
  })

  it('inline 模式挂载进宿主容器并带上模式修饰类', () => {
    const controller = createProgress({
      mode: 'inline',
      title: '正在清理',
      showHeader: true,
      hostId: makeHost().id,
    })
    expect(controller).not.toBeNull()
    const content = document.querySelector('.bgm-progress')
    expect(content?.classList.contains('bgm-progress--inline')).toBe(true)
    expect(content?.parentElement?.id).toBe('progress-host')
    expect(document.querySelector('.bgm-progress__title')?.textContent).toBe('正在清理')
  })

  it('inline 模式默认不显示标题栏，showHeader 可覆盖', () => {
    const host = makeHost()
    const first = createProgress({ mode: 'inline', title: 'A', hostId: host.id })
    const head = pickElement('.bgm-progress__head')
    expect(head.style.display).toBe('none')
    first?.hide()

    createProgress({ mode: 'inline', title: 'B', hostId: host.id, showHeader: true })
    expect(pickElement('.bgm-progress__head').style.display).toBe('')
  })

  it('未启用暂停/停止时按钮与页脚隐藏', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    expect(pickElement('[data-el="pauseBtn"]').style.display).toBe('none')
    expect(pickElement('[data-el="stopBtn"]').style.display).toBe('none')
    expect(pickElement('.bgm-progress__footer').style.display).toBe('none')
    expect(controller?.isActive()).toBe(true)
  })

  it('modal 模式挂到 body 并包一层 dialog 外壳', () => {
    const controller = createProgress({ mode: 'modal', title: '正在同步', enableStop: true })
    const mount = pickElement('.bgm-modal')
    expect(mount).not.toBeNull()
    expect(mount.style.display).toBe('flex')
    expect(mount.getAttribute('aria-modal')).toBe('true')
    expect(mount.querySelector('.bgm-modal-content')).not.toBeNull()
    expect(mount.querySelector('.bgm-progress')).not.toBeNull()
    controller?.hide()
    expect(document.body.querySelector('.bgm-modal')).toBeNull()
  })

  it('detach 模式挂到独立浮层且不受 modal 具名容器约束', () => {
    const controller = createProgress({ mode: 'detach', title: '后台任务' })
    const dock = document.body.querySelector('.bgm-progress__dock')
    expect(dock).not.toBeNull()
    expect(dock?.querySelector('.bgm-progress')).not.toBeNull()
    controller?.hide()
    expect(document.body.querySelector('.bgm-progress__dock')).toBeNull()
  })

  it('configHtml 传入后展示在配置区', () => {
    createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      configHtml: '<b>同步模式</b>',
    })
    const config = pickElement('[data-el="config"]')
    expect(config.style.display).toBe('')
    expect(config.textContent).toContain('同步模式')
  })
})

describe('update 进度更新边界', () => {
  it('常规进度同步到宽度、百分比与 aria', () => {
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
    })
    controller?.update(5, 10, '处理中')
    const bar = pickElement('[data-el="bar"]')
    expect(bar.style.width).toBe('50%')
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(document.querySelector('[data-el="label"]')?.textContent).toBe('进度: 5/10')
    expect(document.querySelector('[data-el="current"]')?.textContent).toBe('处理中')
  })

  it('total 为 0 时百分比归零且不产生 NaN', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.update(0, 0)
    const bar = pickElement('[data-el="bar"]')
    expect(bar.style.width).toBe('0%')
    expect(bar.textContent).toBe('0%')
  })

  it('current 超过 total 时百分比钳制到 100%（视觉与 ARIA 均不溢出）', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.update(15, 10)
    const bar = pickElement('[data-el="bar"]')
    expect(bar.style.width).toBe('100%')
    expect(bar.textContent).toBe('100%')
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
  })

  it('current 为负或 total 非法时百分比钳制到 0%', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.update(-5, 10)
    const bar = pickElement('[data-el="bar"]')
    expect(bar.style.width).toBe('0%')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')

    controller?.update(3, Infinity)
    expect(bar.style.width).toBe('0%')
  })

  it('message 省略时保留上一次的当前步骤文案', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.update(1, 10, '第一步')
    controller?.update(2, 10)
    expect(document.querySelector('[data-el="current"]')?.textContent).toBe('第一步')
  })

  it('eta 传空串时隐藏 ETA 区', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.update(1, 10, 'x', '剩余 1 秒')
    const eta = pickElement('[data-el="eta"]')
    expect(eta.style.display).toBe('')
    controller?.update(2, 10, 'x', '')
    expect(eta.style.display).toBe('none')
  })

  it('全局 ETA 在 total 为 0 时隐藏', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.update(1, 0)
    expect(pickElement('[data-el="globalEta"]').style.display).toBe('none')
  })
})

describe('日志面板', () => {
  it('未启用日志时静默忽略', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.log('不该出现')
    expect(document.querySelector('[data-el="log"]')?.textContent).toBe('')
    expect(pickElement('[data-el="logWrap"]').style.display).toBe('none')
  })

  it('启用日志后逐行追加', () => {
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      enableLogs: true,
    })
    controller?.log('第一行')
    controller?.log('第二行')
    const log = pickElement('[data-el="log"]')
    expect(log.textContent).toBe('第一行\n第二行\n')
  })

  it('日志超过 500 行后丢弃最旧行，长度保持在上限', () => {
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      enableLogs: true,
    })
    for (let index = 0; index < 520; index += 1) controller?.log(`line-${String(index)}`)
    const log = pickElement('[data-el="log"]')
    expect(log.childNodes.length).toBe(500)
    expect(log.textContent).not.toContain('line-0\n')
    expect(log.textContent).toContain('line-519')
  })

  it('多行日志合帧滚动：一帧只读一次 scrollHeight（不逐行强制布局）', async () => {
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      enableLogs: true,
    })
    const log = pickElement('[data-el="log"]')
    // jsdom 不做布局（scrollHeight 恒 0），用计数 getter 观测读取次数
    let reads = 0
    Object.defineProperty(log, 'scrollHeight', {
      get: () => {
        reads += 1
        return 0
      },
      configurable: true,
    })

    controller?.log('一')
    controller?.log('二')
    controller?.log('三')
    // 同一任务内三行日志：scrollHeight 一次都没读（写 style 不强制布局）
    expect(reads).toBe(0)

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    // 帧末只读一次，一次布局服务全部行
    expect(reads).toBe(1)
  })
})

describe('暂停状态', () => {
  it('setPaused 切换按钮文案与语义类，但不触发回调', () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      enablePause: true,
      onPause,
      onResume,
    })
    const button = pickElement('[data-el="pauseBtn"]')
    expect(button.textContent).toBe('⏸️ 暂停')

    controller?.setPaused(true)
    expect(button.textContent).toBe('▶️ 继续')
    expect(button.classList.contains('bgm-dialog-btn-success')).toBe(true)
    expect(onPause).not.toHaveBeenCalled()

    controller?.setPaused(false)
    expect(button.textContent).toBe('⏸️ 暂停')
    expect(onResume).not.toHaveBeenCalled()
  })

  it('点击暂停按钮按当前状态派发 onPause / onResume', () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      enablePause: true,
      onPause,
      onResume,
    })
    const button = pickElement('[data-el="pauseBtn"]')
    button.click()
    expect(onPause).toHaveBeenCalledTimes(1)
    controller?.setPaused(true)
    button.click()
    expect(onResume).toHaveBeenCalledTimes(1)
  })
})

describe('完成态', () => {
  it('切换到完成态：隐藏进度区、显示结果区与完成按钮', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.complete({ summary: '删除 3 行' })
    expect(pickElement('[data-el="section"]').style.display).toBe('none')
    expect(pickElement('[data-el="result"]').style.display).toBe('')
    expect(document.querySelector('[data-el="summary"]')?.textContent).toBe('删除 3 行')
    expect(pickElement('[data-el="doneBtns"]').style.display).toBe('flex')
    expect(document.querySelector('.bgm-progress__title')?.textContent).toBe('执行完成')
  })

  it('ok=false 时标题与图标标识停止', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.complete({ summary: '已中断', ok: false })
    expect(document.querySelector('.bgm-progress__title')?.textContent).toBe('已停止')
    expect(document.querySelector('.bgm-progress__icon')?.textContent).toBe('⏹️')
  })

  it('无详情时隐藏详情按钮，有文本详情时显示', () => {
    const host = makeHost()
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: host.id })
    controller?.complete({ summary: 's' })
    expect(pickElement('[data-el="toggleDetails"]').style.display).toBe('none')
    controller?.hide()

    const second = createProgress({ mode: 'inline', title: 'A', hostId: host.id })
    second?.complete({ summary: 's', details: ['行1', '行2'] })
    expect(pickElement('[data-el="toggleDetails"]').style.display).toBe('')
    expect(document.querySelector('[data-el="details"]')?.textContent).toBe('行1\n行2')
  })

  it('detailsHtml 使用表格样式且优先于纯文本 details', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.complete({
      summary: 's',
      details: ['应被忽略'],
      detailsHtml: '<table><tbody><tr><td>1</td></tr></tbody></table>',
    })
    const details = pickElement('[data-el="details"]')
    expect(details.classList.contains('bgm-progress__details--table')).toBe(true)
    expect(details.querySelector('table')).not.toBeNull()
    expect(details.textContent).not.toContain('应被忽略')
  })

  it('详情按钮可展开/收起并同步 aria', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.complete({ summary: 's', details: ['x'] })
    const toggle = pickElement('[data-el="toggleDetails"]')
    const details = pickElement('[data-el="details"]')
    toggle.click()
    expect(details.style.display).toBe('')
    expect(toggle.textContent).toBe('收起详情')
    expect(toggle.getAttribute('aria-label')).toBe('收起详情')
    toggle.click()
    expect(details.style.display).toBe('none')
    expect(toggle.textContent).toBe('显示详情')
  })

  it('onNext 存在时显示「下一步」并先关闭再执行回调', () => {
    const onNext = vi.fn()
    const onClose = vi.fn()
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      onClose,
    })
    const host = document.getElementById('progress-host')!
    controller?.complete({ summary: 's', onNext })
    const next = pickElement('[data-el="nextBtn"]')
    expect(next.style.display).toBe('')
    next.click()
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(host.children.length).toBe(0)
  })

  it('未传 onNext 时按钮隐藏且不再残留上一次的回调', () => {
    const host = makeHost()
    const first = createProgress({ mode: 'inline', title: 'A', hostId: host.id })
    first?.complete({ summary: 's', onNext: vi.fn() })
    expect(pickElement('[data-el="nextBtn"]').style.display).toBe('')
    first?.hide()

    const second = createProgress({ mode: 'inline', title: 'A', hostId: host.id })
    second?.complete({ summary: 's' })
    expect(pickElement('[data-el="nextBtn"]').style.display).toBe('none')
  })

  it('完成态按 ESC 关闭', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.complete({ summary: 's' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('.bgm-progress')).toBeNull()
  })

  it('detach 完成态不抢焦点（非阻塞浮卡，用户可能正在别处输入）', () => {
    const controller = createProgress({ mode: 'detach', title: '批量富化进度' })
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    controller?.complete({ summary: '5/5 成功' })

    // 焦点必须留在用户原来的元素上；卡片保留完成态等人关闭
    expect(document.activeElement).toBe(outside)
    expect(document.body.querySelector('.bgm-progress__dock')).not.toBeNull()
    expect(pickElement('[data-el="closeBtn"]')).not.toBeNull()
  })

  it('modal 完成态把焦点移到「关闭」（模态需要收拢焦点）', () => {
    const controller = createProgress({ mode: 'modal', title: '正在同步' })
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()

    controller?.complete({ summary: 's' })

    expect(document.activeElement).toBe(pickElement('[data-el="closeBtn"]'))
  })

  it('结果 HTML 中的脚本与事件属性被清洗', () => {
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    controller?.complete({
      summary: 's',
      resultHtml: '<div onclick="alert(1)">安全</div><script>alert(2)</script>',
    })
    const body = pickElement('[data-el="resultBody"]')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('[onclick]')).toBeNull()
    expect(body.textContent).toContain('安全')
  })
})

describe('销毁与全局入口', () => {
  it('hide 清空宿主容器、触发 onClose 并复位 isActive', () => {
    const onClose = vi.fn()
    const host = makeHost()
    const controller = createProgress({ mode: 'inline', title: 'A', hostId: host.id, onClose })
    controller?.hide()
    expect(host.children.length).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(controller?.isActive()).toBe(false)
  })

  it('重复 hide 不会二次触发 onClose', () => {
    const onClose = vi.fn()
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      onClose,
    })
    controller?.hide()
    controller?.hide()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('销毁后 update/log/complete 均静默忽略（不抛错）', () => {
    const controller = createProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      enableLogs: true,
    })
    controller?.hide()
    expect(() => {
      controller?.update(1, 1)
      controller?.log('x')
      controller?.complete({ summary: 'x' })
      controller?.setPaused(true)
    }).not.toThrow()
  })

  it('showProgress 会先销毁上一个活跃实例', () => {
    const host = makeHost()
    showProgress({ mode: 'inline', title: '第一个', hostId: host.id })
    const second = showProgress({ mode: 'inline', title: '第二个', hostId: host.id })
    expect(document.querySelectorAll('.bgm-progress').length).toBe(1)
    expect(document.querySelector('.bgm-progress__title')?.textContent).toBe('第二个')
    expect(getActiveProgress()).toBe(second)
  })

  it('全局入口在无活跃实例时静默忽略', () => {
    hideProgress()
    expect(() => {
      updateProgress(1, 2, 'x')
      expect(getActiveProgress()).toBeNull()
    }).not.toThrow()
  })

  it('hideProgress 清空活跃实例引用', () => {
    showProgress({ mode: 'inline', title: 'A', hostId: makeHost().id })
    expect(getActiveProgress()).not.toBeNull()
    hideProgress()
    expect(getActiveProgress()).toBeNull()
  })

  it('可见时点击停止按钮触发 onStop', () => {
    const onStop = vi.fn()
    showProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      showHeader: true,
      enableStop: true,
      onStop,
    })

    pickElement('[data-el="stopBtn"]').click()

    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('appendProgressLog 把日志转发到当前活跃实例', () => {
    showProgress({
      mode: 'inline',
      title: 'A',
      hostId: makeHost().id,
      showHeader: true,
      enableLogs: true,
    })

    appendProgressLog('来自模块级 API 的一行')

    expect(pickElement('[data-el="log"]').textContent).toContain('来自模块级 API 的一行')
  })

  it('completeProgress 把当前活跃实例切到完成态', () => {
    showProgress({ mode: 'inline', title: 'A', hostId: makeHost().id, showHeader: true })

    completeProgress({ summary: '共处理 3 条', ok: true })

    expect(pickElement('[data-el="summary"]').textContent).toBe('共处理 3 条')
    expect(pickElement('[data-el="doneBtns"]').style.display).toBe('flex')
    expect(pickElement('[data-el="runningBtns"]').style.display).toBe('none')
  })

  it('没有活跃实例时模块级转发全部静默忽略', () => {
    expect(getActiveProgress()).toBeNull()
    expect(() => {
      appendProgressLog('无处可去')
      completeProgress({ summary: '无处可去' })
    }).not.toThrow()
  })
})

describe('真实 DOMPurify 环境（加载项运行时路径）', () => {
  it('libs/purify.js 注入后 sanitize 走严格白名单', () => {
    installRealDomPurify()
    expect(hasRealDomPurify()).toBe(true)
  })

  it('组件模板的 data-el 引用在严格白名单下必须保留，否则 createProgress 抛错', () => {
    installRealDomPurify()
    const host = makeHost('host-real-purify')
    const controller = createProgress({
      mode: 'inline',
      title: '严格模式',
      hostId: host.id,
      enableLogs: true,
      enablePause: true,
      enableStop: true,
    })
    expect(controller).not.toBeNull()
    expect(document.querySelector('[data-el="bar"]')).not.toBeNull()
    // 阶段时间线的 <ol> 是新加进模板的标签：白名单一旦收紧会把它剥掉，
    // collectElements 随即抛「缺少必需元素」。这里显式钉住，避免运行时才发现。
    expect(document.querySelector('[data-el="phases"]')).not.toBeNull()
    controller?.update(3, 6, 'ok')
    expect(document.querySelector('[data-el="bar"]')?.getAttribute('aria-valuenow')).toBe('50')
  })
})


/** 起一个带阶段时间线的 inline 进度组件 */
function createWithPhases(phases?: readonly string[]) {
  return createProgress({
    mode: 'inline',
    title: '正在同步',
    showHeader: false,
    hostId: makeHost().id,
    // 条件展开：与 ui/dialog.ts 的 \`...(config && { configHtml })\` 同一写法
    ...(phases && { phases }),
  })
}

/** 取第 index 个阶段项 */
function phaseItem(index: number): HTMLElement {
  const item = document.querySelectorAll<HTMLElement>('.bgm-progress__phase')[index]
  if (item === undefined) throw new Error(`缺少阶段项: ${String(index)}`)
  return item
}

describe('阶段时间线（phases）', () => {
  it('未传 phases → 不渲染时间线（既有调用方行为不变）', () => {
    const controller = createWithPhases()

    expect(document.querySelectorAll('.bgm-progress__phase')).toHaveLength(0)
    expect(pickElement('[data-el=phases]').style.display).toBe('none')
    // 未启用时推进阶段也不该抛错，调用方不必分支判断
    expect(() => {
      controller?.setPhase(1)
    }).not.toThrow()
  })

  it('传入 phases → 渲染各阶段，并直接从第 0 阶段开始', () => {
    createWithPhases(['下载', '比对', '写入'])

    const items = document.querySelectorAll('.bgm-progress__phase')
    expect(items).toHaveLength(3)
    expect(phaseItem(0).className).toContain('bgm-progress__phase--active')
    expect(phaseItem(0).getAttribute('aria-current')).toBe('step')
    expect(phaseItem(1).className).toContain('bgm-progress__phase--pending')
    expect(phaseItem(1).getAttribute('aria-current')).toBe('false')
    expect(phaseItem(0).textContent).toContain('下载')
  })

  it('setPhase 推进：之前的阶段转为 done 并带上耗时', () => {
    vi.useFakeTimers()
    try {
      const controller = createWithPhases(['下载', '比对', '写入'])
      vi.advanceTimersByTime(1500)

      controller?.setPhase(1)

      expect(phaseItem(0).className).toContain('bgm-progress__phase--done')
      expect(phaseItem(1).className).toContain('bgm-progress__phase--active')
      expect(phaseItem(2).className).toContain('bgm-progress__phase--pending')
      // 已完成阶段显示耗时文本
      expect(phaseItem(0).textContent).toContain(formatDuration(1500))
    } finally {
      vi.useRealTimers()
    }
  })

  it('setPhase 越界或重复 → 静默忽略，不推进也不报错', () => {
    const controller = createWithPhases(['下载', '比对'])

    controller?.setPhase(-1)
    controller?.setPhase(2)
    controller?.setPhase(1.5)

    expect(phaseItem(0).className).toContain('bgm-progress__phase--active')
    controller?.setPhase(0)
    expect(phaseItem(0).className).toContain('bgm-progress__phase--active')
  })

  it('complete（正常完成）→ 全部阶段标为 done 并显示最后一个阶段耗时', () => {
    vi.useFakeTimers()
    try {
      const controller = createWithPhases(['下载', '比对', '写入'])
      vi.advanceTimersByTime(1000)
      controller?.setPhase(2)
      vi.advanceTimersByTime(2000)

      controller?.complete({ summary: '完成' })

      expect(phaseItem(0).className).toContain('bgm-progress__phase--done')
      expect(phaseItem(1).className).toContain('bgm-progress__phase--done')
      expect(phaseItem(2).className).toContain('bgm-progress__phase--done')
      expect(phaseItem(2).textContent).toContain(formatDuration(2000))
    } finally {
      vi.useRealTimers()
    }
  })

  it('complete（被停止）→ 保留未完成阶段为 pending，用户能看出卡在哪一步', () => {
    const controller = createWithPhases(['下载', '比对', '写入'])

    controller?.setPhase(1)
    controller?.complete({ summary: '已停止', ok: false })

    expect(phaseItem(0).className).toContain('bgm-progress__phase--done')
    expect(phaseItem(1).className).toContain('bgm-progress__phase--active')
    expect(phaseItem(2).className).toContain('bgm-progress__phase--pending')
  })
})
