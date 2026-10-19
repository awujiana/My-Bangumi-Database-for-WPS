// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SyncProgressStats } from '../ts/core/types.js'
import type { GithubSyncDetailItem } from '../ts/sync/github-sync-diff.js'

/** 进度组件 complete() 的入参形状（只声明被测路径用到的字段） */
interface ProgressCompleteOptions {
  summary: string
  ok: boolean
  resultHtml?: string
  detailsHtml?: string
  details?: string[]
  onNext?: () => void
}

const progressMock = vi.hoisted(() => ({
  update: vi.fn<(current: number, total: number, message?: string, eta?: string) => void>(),
  log: vi.fn<(line: string) => void>(),
  complete: vi.fn<(options: ProgressCompleteOptions) => void>(),
  hide: vi.fn(),
  lastOptions: null as Record<string, unknown> | null,
}))

vi.mock('../ts/ui/components/progress.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/ui/components/progress.js')>()
  return {
    ...actual,
    createProgress: (options: Record<string, unknown>) => {
      progressMock.lastOptions = options
      return progressMock
    },
  }
})

vi.mock('../ts/core/ui-bridge.js', () => ({
  registerNotifyApi: vi.fn(),
  registerSyncProgressApi: vi.fn(),
}))

/** 加载一份「尚未执行 DOM 初始化」的模块实例（宏任务 setTimeout(ensureDialogs) 未跑） */
async function loadDialogFresh(): Promise<typeof import('../ts/ui/dialog.js')> {
  vi.resetModules()
  return import('../ts/ui/dialog.js')
}

/** 加载并等待 DOM 初始化完成（createDialogs + bindAllEvents 已跑） */
async function loadDialogReady(): Promise<typeof import('../ts/ui/dialog.js')> {
  const dialogModule = await loadDialogFresh()
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  return dialogModule
}

/** 按 id 取弹窗根节点 */
function getModal(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`弹窗未创建: ${id}`)
  return element
}

/** 构造同步统计数据；默认形状落在「黄色」完成度区间（81%） */
function makeStats(overrides: Partial<SyncProgressStats> = {}): SyncProgressStats {
  return {
    added: 10,
    updated: 5,
    deleted: 2,
    unchanged: 3,
    failed: 1,
    skipped: 4,
    remoteTotal: 30,
    elapsedMs: 60_000,
    avgSpeed: 2.5,
    strategyLabel: '增量同步',
    ...overrides,
  }
}

/** 构造一条同步明细 */
function makeDetail(
  overrides: Partial<GithubSyncDetailItem> = {},
): GithubSyncDetailItem {
  return { kind: 'add', sid: '123', name: '葬送的芙莉莲', ...overrides }
}

/** 取 mock 进度组件最近一次创建参数里的某个回调 */
function getProgressCallback(name: string): (() => void) | undefined {
  const value = progressMock.lastOptions?.[name]
  return typeof value === 'function' ? (value as () => void) : undefined
}

describe('ui/dialog UI 层', () => {
  beforeEach(async () => {
    // 先排空上一用例遗留的 ensureDialogs 宏任务，再清 DOM，
    // 否则遗留任务会先建好容器，使新模块实例的 createDialogs 提前 return、缓存为空
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    document.body.replaceChildren()
    vi.clearAllMocks()
    progressMock.lastOptions = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('DOM 初始化', () => {
    it('创建容器与 6 类对话框，并声明可访问性属性', async () => {
      await loadDialogReady()

      expect(document.getElementById('bgmDialogContainer')).not.toBeNull()
      for (const id of [
        'bgmAlertDialog',
        'bgmConfirmDialog',
        'bgmErrorDialog',
        'bgmWarningDialog',
        'bgmSuccessDialog',
        'bgmInputDialog',
      ]) {
        const modal = getModal(id)
        expect(modal.getAttribute('role')).toBe('dialog')
        expect(modal.getAttribute('aria-modal')).toBe('true')
        expect(modal.style.display).toBe('none')
      }
      expect(document.getElementById('bgmInputField')).not.toBeNull()
      expect(document.getElementById('bgmToast')).not.toBeNull()
    })

    it('按钮带 data-event 且输入框类型正确', async () => {
      await loadDialogReady()

      const okButton = document.getElementById('bgmConfirmOk')
      const cancelButton = document.getElementById('bgmConfirmCancel')
      expect(okButton?.dataset.event).toBe('ok')
      expect(cancelButton?.dataset.event).toBe('cancel')
      const input = document.getElementById('bgmInputField') as HTMLInputElement | null
      expect(input?.type).toBe('text')
    })

    it('重复初始化不会重复创建容器', async () => {
      await loadDialogReady()
      await loadDialogReady()

      expect(document.querySelectorAll('div#bgmDialogContainer')).toHaveLength(1)
    })

    it('readyState 为 loading 时挂 DOMContentLoaded 监听，事件触发后才建容器', async () => {
      // 让模块在「文档尚未就绪」的路径下求值：走 addEventListener 分支而非 setTimeout 分支。
      // jsdom 的 readyState 是原型上的 getter，这里用自有属性临时遮蔽，finally 里删除以还原。
      Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
      try {
        await loadDialogFresh()

        // 仅注册了监听、并未建容器：此时 _showDialog 仍走原生兜底
        expect(document.getElementById('bgmDialogContainer')).toBeNull()

        document.dispatchEvent(new Event('DOMContentLoaded'))

        expect(document.getElementById('bgmDialogContainer')).not.toBeNull()
        expect(document.getElementById('bgmAlertDialog')).not.toBeNull()
      } finally {
        delete (document as unknown as Record<string, unknown>).readyState
      }
    })
  })

  describe('showAlert / showError / showWarning / showSuccess', () => {
    it('展示提示并回填标题与内容', async () => {
      const { showAlert } = await loadDialogReady()

      showAlert('操作已完成', '自定义标题')

      expect(getModal('bgmAlertDialog').style.display).toBe('flex')
      expect(document.getElementById('bgmAlertTitle')?.textContent).toBe('自定义标题')
      expect(document.getElementById('bgmAlertMessage')?.textContent).toBe('操作已完成')
    })

    it('未传标题时用默认标题', async () => {
      const { showAlert, showError, showWarning, showSuccess } = await loadDialogReady()

      showAlert('a')
      showError('e')
      showWarning('w')
      showSuccess('s')

      expect(document.getElementById('bgmAlertTitle')?.textContent).toBe('提示')
      expect(document.getElementById('bgmErrorTitle')?.textContent).toBe('错误')
      expect(document.getElementById('bgmWarningTitle')?.textContent).toBe('警告')
      expect(document.getElementById('bgmSuccessTitle')?.textContent).toBe('成功')
    })

    it('点击确定触发 onOk 并关闭', async () => {
      const { showAlert } = await loadDialogReady()
      const onOk = vi.fn()

      showAlert('内容', '标题', onOk)
      document.getElementById('bgmAlertOk')?.click()

      expect(onOk).toHaveBeenCalledTimes(1)
      expect(getModal('bgmAlertDialog').style.display).toBe('none')
    })

    it('无 onOk 时点击确定不报错', async () => {
      const { showAlert } = await loadDialogReady()

      showAlert('内容')
      expect(() => document.getElementById('bgmAlertOk')?.click()).not.toThrow()
    })

    it('回调抛错时兜底记录并清空回调', async () => {
      const { showAlert } = await loadDialogReady()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      showAlert('内容', '标题', () => {
        throw new Error('回调炸了')
      })
      document.getElementById('bgmAlertOk')?.click()

      expect(spy).toHaveBeenCalledWith('[dialog] 回调执行失败:', expect.any(Error))
      spy.mockRestore()
    })
  })

  describe('showConfirm', () => {
    it('点击确定回调 true', async () => {
      const { showConfirm } = await loadDialogReady()
      const callback = vi.fn()

      showConfirm('确认删除？', callback)
      document.getElementById('bgmConfirmOk')?.click()

      expect(callback).toHaveBeenCalledWith(true)
    })

    it('点击取消回调 false', async () => {
      const { showConfirm } = await loadDialogReady()
      const callback = vi.fn()

      showConfirm('确认删除？', callback)
      document.getElementById('bgmConfirmCancel')?.click()

      expect(callback).toHaveBeenCalledWith(false)
    })

    it('未传标题时用默认「确认」', async () => {
      const { showConfirm } = await loadDialogReady()

      showConfirm('内容', vi.fn(), '自定义确认')

      expect(document.getElementById('bgmConfirmTitle')?.textContent).toBe('自定义确认')
    })
  })

  describe('confirmAsync', () => {
    it('点击确定 → resolve(true)', async () => {
      const { confirmAsync } = await loadDialogReady()

      const pending = confirmAsync('确认删除？')
      document.getElementById('bgmConfirmOk')?.click()

      await expect(pending).resolves.toBe(true)
    })

    it('点击取消 → resolve(false)', async () => {
      const { confirmAsync } = await loadDialogReady()

      const pending = confirmAsync('确认删除？')
      document.getElementById('bgmConfirmCancel')?.click()

      await expect(pending).resolves.toBe(false)
    })

    it('沿用 showConfirm 的默认标题与自定义标题', async () => {
      const { confirmAsync } = await loadDialogReady()

      const pending = confirmAsync('内容', '自定义确认')
      expect(document.getElementById('bgmConfirmTitle')?.textContent).toBe('自定义确认')

      document.getElementById('bgmConfirmOk')?.click()
      await expect(pending).resolves.toBe(true)
    })
  })

  describe('showInput', () => {
    it('回填默认值并在确定时回传输入内容', async () => {
      const { showInput } = await loadDialogReady()
      const onOk = vi.fn()

      showInput('输入标题', '请输入名称', '默认值', onOk)
      const input = document.getElementById('bgmInputField') as HTMLInputElement

      expect(input.value).toBe('默认值')
      input.value = '  新值  '
      document.getElementById('bgmInputOk')?.click()

      expect(onOk).toHaveBeenCalledWith('新值')
    })

    it('取消时触发 onCancel', async () => {
      const { showInput } = await loadDialogReady()
      const onCancel = vi.fn()

      showInput('标题', '提示', undefined, vi.fn(), onCancel)
      document.getElementById('bgmInputCancel')?.click()

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('未传默认值时输入框为空', async () => {
      const { showInput } = await loadDialogReady()

      showInput('标题', '提示', undefined, vi.fn())
      const input = document.getElementById('bgmInputField') as HTMLInputElement

      expect(input.value).toBe('')
    })

    it('回车等同点击确定', async () => {
      const { showInput } = await loadDialogReady()
      const onOk = vi.fn()

      showInput('标题', '提示', undefined, onOk)
      const input = document.getElementById('bgmInputField') as HTMLInputElement
      input.value = '回车提交'
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }))

      expect(onOk).toHaveBeenCalledWith('回车提交')
    })
  })

  describe('容器点击派生的防御分支', () => {
    it('点击非按钮区域不关闭弹窗', async () => {
      const { showAlert } = await loadDialogReady()

      showAlert('内容')
      getModal('bgmAlertDialog').querySelector('.bgm-dialog-body')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )

      expect(getModal('bgmAlertDialog').style.display).toBe('flex')
    })

    it('按钮缺少 data-event 时不处理', async () => {
      const { showAlert } = await loadDialogReady()

      showAlert('内容')
      const okButton = document.getElementById('bgmAlertOk')
      if (okButton) delete okButton.dataset.event
      okButton?.click()

      expect(getModal('bgmAlertDialog').style.display).toBe('flex')
    })

    it('按钮不在弹窗内时不处理', async () => {
      const { showAlert } = await loadDialogReady()

      showAlert('内容')
      const orphan = document.createElement('button')
      orphan.dataset.event = 'ok'
      document.getElementById('bgmDialogContainer')?.appendChild(orphan)
      orphan.click()

      expect(getModal('bgmAlertDialog').style.display).toBe('flex')
    })
  })

  describe('原生兜底（DOM 未初始化）', () => {
    it('alert 走 window.alert 并触发 onOk', async () => {
      const { showAlert } = await loadDialogFresh()
      const spy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      const onOk = vi.fn()

      showAlert('原生提示', '标题', onOk)

      expect(spy).toHaveBeenCalledWith('原生提示')
      expect(onOk).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    })

    it('confirm 走 window.confirm：确认走 onOk、取消走 onCancel', async () => {
      const { showConfirm } = await loadDialogFresh()
      const callback = vi.fn()

      const yes = vi.spyOn(window, 'confirm').mockReturnValue(true)
      showConfirm('确认？', callback)
      expect(callback).toHaveBeenLastCalledWith(true)

      const no = vi.spyOn(window, 'confirm').mockReturnValue(false)
      showConfirm('确认？', callback)
      expect(callback).toHaveBeenLastCalledWith(false)

      yes.mockRestore()
      no.mockRestore()
    })

    it('input 走 window.prompt：有值走 onOk、null 走 onCancel', async () => {
      const { showInput } = await loadDialogFresh()
      const onOk = vi.fn()
      const onCancel = vi.fn()

      const filled = vi.spyOn(window, 'prompt').mockReturnValue('输入值')
      showInput('标题', '提示', '默认', onOk, onCancel)
      expect(onOk).toHaveBeenCalledWith('输入值')

      const cancelled = vi.spyOn(window, 'prompt').mockReturnValue(null)
      showInput('标题', '提示', '默认', onOk, onCancel)
      expect(onCancel).toHaveBeenCalledTimes(1)

      filled.mockRestore()
      cancelled.mockRestore()
    })

    it('toast 在 DOM 未初始化时静默跳过', async () => {
      const { showToast } = await loadDialogFresh()

      expect(() => showToast('消息')).not.toThrow()
    })
  })

  describe('showToast', () => {
    it('显示带类型的提示并在 3 秒后复原', async () => {
      const { showToast } = await loadDialogReady()
      vi.useFakeTimers()

      showToast('保存成功', 'success')
      const toast = document.getElementById('bgmToast')

      expect(toast?.textContent).toBe('保存成功')
      expect(toast?.className).toContain('bgm-toast-show')
      expect(toast?.className).toContain('bgm-toast-success')

      vi.advanceTimersByTime(3000)
      expect(toast?.className).toBe('bgm-toast')
    })

    it('未传类型时只加基础样式', async () => {
      const { showToast } = await loadDialogReady()

      showToast('普通消息')
      const toast = document.getElementById('bgmToast')

      expect(toast?.className).toBe('bgm-toast bgm-toast-show')
    })

    it('连续弹出时重置上一个计时器', async () => {
      const { showToast } = await loadDialogReady()
      vi.useFakeTimers()

      showToast('第一条')
      vi.advanceTimersByTime(2000)
      showToast('第二条')
      vi.advanceTimersByTime(2000)

      const toast = document.getElementById('bgmToast')
      expect(toast?.textContent).toBe('第二条')
      expect(toast?.className).toContain('bgm-toast-show')
    })
  })

  describe('showSyncResult 同步结果弹窗', () => {
    it('有详情时展开按钮可见且内容按行拼接', async () => {
      const { showSyncResult } = await loadDialogReady()

      showSyncResult('同步完成', ['第 1 条', '第 2 条'])
      const modal = getModal('bgmSyncResultDialog')
      const details = document.getElementById('bgmSyncDetails')
      const toggle = document.getElementById('bgmSyncToggleDetails')

      expect(modal.style.display).toBe('flex')
      expect(document.getElementById('bgmSyncSummary')?.textContent).toBe('同步完成')
      expect(details?.textContent).toBe('第 1 条\n第 2 条')
      expect(toggle?.style.display).toBe('')
      expect(details?.style.display).toBe('none')
    })

    it('无详情时隐藏展开按钮并显示占位', async () => {
      const { showSyncResult } = await loadDialogReady()

      showSyncResult('同步完成', [])

      expect(document.getElementById('bgmSyncDetails')?.textContent).toBe('无详情')
      expect(document.getElementById('bgmSyncToggleDetails')?.style.display).toBe('none')
    })

    it('点击展开/收起切换显示与文案', async () => {
      const { showSyncResult } = await loadDialogReady()

      showSyncResult('同步完成', ['明细'])
      const details = document.getElementById('bgmSyncDetails')
      const toggle = document.getElementById('bgmSyncToggleDetails')

      toggle?.click()
      expect(details?.style.display).toBe('block')
      expect(toggle?.textContent).toBe('收起详情')

      toggle?.click()
      expect(details?.style.display).toBe('none')
      expect(toggle?.textContent).toBe('显示详情')
    })

    it('点击确定关闭弹窗', async () => {
      const { showSyncResult } = await loadDialogReady()

      showSyncResult('同步完成', [])
      document.getElementById('bgmSyncResultOk')?.click()

      expect(getModal('bgmSyncResultDialog').style.display).toBe('none')
    })
  })

  describe('同步进度弹窗', () => {
    it('创建 modal 模式进度组件并透传配置摘要', async () => {
      const { showSyncProgressDialog } = await loadDialogReady()
      const handlers = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() }

      showSyncProgressDialog('正在同步', handlers, {
        sourceLabel: '动画',
        strategyLabel: '增量',
        directionLabel: '双向',
        timeFilterLabel: '近一月',
        selectedRowsOnly: true,
        extra: [{ label: '标签', value: '奇幻' }],
      })

      expect(progressMock.lastOptions?.mode).toBe('modal')
      expect(progressMock.lastOptions?.title).toBe('正在同步')
      expect(progressMock.lastOptions?.enablePause).toBe(true)
      const configHtml = progressMock.lastOptions?.configHtml as string
      expect(configHtml).toContain('动画')
      expect(configHtml).toContain('仅选中行')
    })

    it('无配置时不带 configHtml', async () => {
      const { showSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })

      expect(progressMock.lastOptions).not.toHaveProperty('configHtml')
    })

    it('暂停/恢复/停止回调透传给调用方', async () => {
      const { showSyncProgressDialog } = await loadDialogReady()
      const handlers = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() }

      showSyncProgressDialog('标题', handlers)
      getProgressCallback('onPause')?.()
      getProgressCallback('onResume')?.()
      getProgressCallback('onStop')?.()

      expect(handlers.onPause).toHaveBeenCalledTimes(1)
      expect(handlers.onResume).toHaveBeenCalledTimes(1)
      expect(handlers.onStop).toHaveBeenCalledTimes(1)
    })

    it('更新进度：普通日志行同时走 update 与 log', async () => {
      const { showSyncProgressDialog, updateSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      updateSyncProgressDialog(1, 10, '处理中', '日志行')

      expect(progressMock.update).toHaveBeenCalledWith(1, 10, '处理中', undefined)
      expect(progressMock.log).toHaveBeenCalledWith('日志行')
    })

    it('「预计剩余」开头的日志行视为 ETA，不再重复进日志', async () => {
      const { showSyncProgressDialog, updateSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      updateSyncProgressDialog(2, 10, '处理中', '预计剩余 30 秒')

      expect(progressMock.update).toHaveBeenCalledWith(2, 10, '处理中', '预计剩余 30 秒')
      expect(progressMock.log).not.toHaveBeenCalled()
    })

    it('「剩余:」开头的日志行同样视为 ETA', async () => {
      const { showSyncProgressDialog, updateSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      updateSyncProgressDialog(2, 10, '处理中', '剩余: 1分')

      expect(progressMock.update).toHaveBeenCalledWith(2, 10, '处理中', '剩余: 1分')
      expect(progressMock.log).not.toHaveBeenCalled()
    })

    it('显式 eta 优先于日志行', async () => {
      const { showSyncProgressDialog, updateSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      updateSyncProgressDialog(3, 10, '处理中', '日志', 'ETA 文本')

      expect(progressMock.update).toHaveBeenCalledWith(3, 10, '处理中', 'ETA 文本')
      expect(progressMock.log).toHaveBeenCalledWith('日志')
    })

    it('未展示进度弹窗时更新直接返回', async () => {
      const { updateSyncProgressDialog } = await loadDialogReady()

      updateSyncProgressDialog(1, 10, '处理中', '日志')

      expect(progressMock.update).not.toHaveBeenCalled()
    })

    it('完成后汇总含用时，并渲染统计图表', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()
      vi.useFakeTimers()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      vi.advanceTimersByTime(1500)
      completeSyncProgressDialog('同步完成', [], false, undefined, makeStats())

      const call = progressMock.complete.mock.calls.at(-1)?.[0]
      expect(call?.ok).toBe(true)
      expect(call?.summary).toContain('用时')
      expect(call?.resultHtml).toContain('远程总条目')
    })

    it('被停止时 ok 为 false 并透传 onNext', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()
      const onNext = vi.fn()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('已停止', ['d'], true, onNext)

      const call = progressMock.complete.mock.calls.at(-1)?.[0]
      expect(call?.ok).toBe(false)
      expect(call?.onNext).toBe(onNext)
      expect(call?.details).toEqual(['d'])
      expect(call?.resultHtml).toBeUndefined()
    })

    it('有明细对象时渲染表格而非纯文本详情', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('完成', ['文本详情'], false, undefined, undefined, [
        makeDetail(),
      ])

      const call = progressMock.complete.mock.calls.at(-1)?.[0]
      expect(call?.detailsHtml).toContain('bgm-detail-table')
    })

    it('未开始计时时不追加用时', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()
      vi.useFakeTimers()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('同步完成', [])

      expect(progressMock.complete).toHaveBeenCalledWith(
        expect.objectContaining({ summary: '同步完成' }),
      )
    })

    it('隐藏后清空实例，后续更新不再生效', async () => {
      const {
        showSyncProgressDialog,
        updateSyncProgressDialog,
        hideSyncProgressDialog,
      } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      hideSyncProgressDialog()
      updateSyncProgressDialog(1, 10, '处理中', '日志')

      expect(progressMock.hide).toHaveBeenCalledTimes(1)
      expect(progressMock.update).not.toHaveBeenCalled()
    })

    it('重复 show 会先隐藏上一个实例', async () => {
      const { showSyncProgressDialog } = await loadDialogReady()
      const handlers = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() }

      showSyncProgressDialog('第一次', handlers)
      showSyncProgressDialog('第二次', handlers)

      expect(progressMock.hide).toHaveBeenCalledTimes(1)
      expect(progressMock.lastOptions?.title).toBe('第二次')
    })
  })

  describe('renderSyncDetailTable 明细表格', () => {
    it('空数组返回占位文案', async () => {
      const { renderSyncDetailTable } = await loadDialogReady()

      expect(renderSyncDetailTable([])).toBe('<p>无明细数据</p>')
    })

    it('四种操作类型渲染对应标签与样式类', async () => {
      const { renderSyncDetailTable } = await loadDialogReady()

      const html = renderSyncDetailTable([
        makeDetail({ kind: 'add' }),
        makeDetail({ kind: 'update' }),
        makeDetail({ kind: 'delete' }),
        makeDetail({ kind: 'fail' }),
      ])

      expect(html).toContain('➕ 新增')
      expect(html).toContain('bgm-detail-kind--add')
      expect(html).toContain('🔄 更新')
      expect(html).toContain('bgm-detail-kind--update')
      expect(html).toContain('🗑️ 删除')
      expect(html).toContain('bgm-detail-kind--delete')
      expect(html).toContain('❌ 失败')
      expect(html).toContain('bgm-detail-kind--fail')
    })

    it('缺失的名称/行号/字段回退为 --', async () => {
      const { renderSyncDetailTable } = await loadDialogReady()

      const html = renderSyncDetailTable([makeDetail({ name: undefined, fields: [] })])

      expect(html).toContain('--')
      expect(html).toContain('共 1 条明细')
    })

    it('带完整字段时逐列渲染', async () => {
      const { renderSyncDetailTable } = await loadDialogReady()

      const html = renderSyncDetailTable([
        makeDetail({ row: 7, fields: ['标签', '平台'], message: '已写入' }),
      ])

      expect(html).toContain('>7<')
      expect(html).toContain('标签, 平台')
      expect(html).toContain('已写入')
    })

    it('对名称做 HTML 转义，阻断注入', async () => {
      const { renderSyncDetailTable } = await loadDialogReady()

      const html = renderSyncDetailTable([
        makeDetail({ name: '<img src=x onerror=alert(1)>' }),
      ])

      expect(html).not.toContain('onerror')
      expect(html).not.toContain('alert(1)')
    })
  })

  describe('renderSyncStatsChart（经 complete 间接）', () => {
    it('完成度 ≥90% 用绿色环', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('完成', [], false, undefined, makeStats({ unchanged: 0, failed: 0 }))

      expect(progressMock.complete.mock.calls.at(-1)?.[0]?.resultHtml).toContain('var(--green')
    })

    it('完成度 50%~89% 用黄色环', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('完成', [], false, undefined, makeStats())

      expect(progressMock.complete.mock.calls.at(-1)?.[0]?.resultHtml).toContain('var(--yellow')
    })

    it('完成度 <50% 用红色环', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('完成', [], false, undefined, makeStats({ unchanged: 60 }))

      expect(progressMock.complete.mock.calls.at(-1)?.[0]?.resultHtml).toContain('var(--red')
    })

    it('速度为 0 时显示占位、预计剩余显示完成', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('完成', [], false, undefined, makeStats({ avgSpeed: 0 }))

      const call = progressMock.complete.mock.calls.at(-1)?.[0]
      expect(call?.resultHtml).toContain('--')
      expect(call?.resultHtml).toContain('完成')
    })

    it('无跳过无失败时不渲染这两类标签', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog(
        '完成',
        [],
        false,
        undefined,
        makeStats({ skipped: 0, failed: 0 }),
      )

      const call = progressMock.complete.mock.calls.at(-1)?.[0]
      expect(call?.resultHtml).not.toContain('跳过 0')
      expect(call?.resultHtml).not.toContain('失败 0')
    })

    it('有跳过与失败时渲染告警标签', async () => {
      const { showSyncProgressDialog, completeSyncProgressDialog } = await loadDialogReady()

      showSyncProgressDialog('标题', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
      completeSyncProgressDialog('完成', [], false, undefined, makeStats())

      const call = progressMock.complete.mock.calls.at(-1)?.[0]
      expect(call?.resultHtml).toContain('跳过 4')
      expect(call?.resultHtml).toContain('失败 1')
    })
  })
})
