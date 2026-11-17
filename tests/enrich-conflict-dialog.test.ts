// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/enrich-conflict-dialog.ts`（富化字段冲突对话框）单元测试。
 *
 * 依赖形状：
 * - `enrich-page-context`（`state` + `safeGetElement`）用**真实模块** —— `state` 单例就是
 *   被断言的对象，「元素缺失 → 早退」由**真删 DOM** 驱动，不是 mock 出来的；
 * - `enrich-progress-hosts` 用**真实模块**（`progressHosts` 的赋值/清空本身就是断言目标），
 *   只把它下层的 `ui/components/progress.js` 的 `createProgress` 换成返回桩的假工厂；
 * - `tools/util/index.js`（barrel）走 `tests/helpers/util-mock.js` 的共享替身；
 * - `sync/enrich-engine.js` 只 mock `resolveConflictField`（本文件不测它的内部策略，
 *   只断言「被调用 / 抛错时的降级」）。
 *
 * `handleConflictResolution` 是**私有函数**，只能经「对话框按钮点击」这条路驱动 ——
 * 所以每组用例都先建好带 `[data-resolution]` 的静态按钮，再 `dispatch` 点击。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConflictInfo, EnrichResultItem } from '../ts/sync/enrich-types.js'

// ========== 依赖替身 ==========

const engineMock = vi.hoisted(() => ({
  resolveConflictField: vi.fn<(sheet: unknown, conflict: unknown, enriched: unknown[]) => void>(),
}))

const progressMock = vi.hoisted(() => ({
  createProgress: vi.fn<(options: unknown) => unknown>(),
}))

vi.mock('../ts/tools/util/index.js', async () => {
  const helpers = await import('./helpers/utility-mock.js')
  return helpers.utilityMock
})
vi.mock('../ts/sync/enrich-engine.js', () => ({
  resolveConflictField: engineMock.resolveConflictField,
}))
vi.mock('../ts/ui/components/progress.js', () => ({ createProgress: progressMock.createProgress }))

import { state } from '../ts/panel/enrich-page-context.js'
import { progressHosts } from '../ts/panel/enrich-progress-hosts.js'
import { resetEnrichState } from './helpers/enrich-context.js'
import { clearDom, mountElement } from './helpers/dom.js'
import { hasLogMessage, resetUtilityMock, utilityMock } from './helpers/utility-mock.js'

/** 动态 import 被测模块（避免顶部 import 早于 mock 生效的阅读错觉） */
const loadModule = async () => import('../ts/panel/enrich-conflict-dialog.js')

type ConflictDialogModule = Awaited<ReturnType<typeof loadModule>>

/** `createProgress` 返回的桩 controller */
function makeControllerStub() {
  return {
    update: vi.fn<(current: number, total: number) => void>(),
    hide: vi.fn<() => void>(),
  }
}

let controller = makeControllerStub()

/** 构造一条冲突记录 */
function makeConflict(overrides: Partial<ConflictInfo> = {}): ConflictInfo {
  return {
    fieldName: '脚本',
    bangumiColumn: 7,
    bangumiRow: 3,
    oldValue: '旧编剧',
    updatedValue: '新编剧',
    animeRow: 2,
    matchedAnimeName: '葬送的芙莉莲',
    resolution: 'keep',
    ...overrides,
  }
}

/** 建好对话框静态骨架（含三个 data-resolution 按钮） */
function mountDialog(): {
  dialog: HTMLElement
  buttons: Record<string, HTMLButtonElement>
} {
  const dialog = mountElement('conflictDialog')
  const buttons: Record<string, HTMLButtonElement> = {}
  for (const resolution of ['keep', 'overwrite', 'append']) {
    const button = document.createElement('button')
    button.dataset.resolution = resolution
    button.textContent = resolution
    dialog.append(button)
    buttons[resolution] = button
  }
  mountElement('conflictTitle')
  mountElement('conflictName')
  mountElement('conflictField')
  mountElement('conflictOld')
  mountElement('conflictNew')
  return { dialog, buttons }
}

/** 点击某个解决策略按钮（驱动私有 handleConflictResolution） */
function clickResolution(buttons: Record<string, HTMLButtonElement>, key: string): void {
  buttons[key]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

let m: ConflictDialogModule

beforeEach(async () => {
  resetUtilityMock()
  resetEnrichState()
  clearDom()

  // 本文件自己的 hoisted 替身必须显式重置：`resetUtilityMock` 只管 util barrel，
  // 漏掉这两个会让上一条用例的调用计数 / 抛错实现泄漏，断言静默变形。
  engineMock.resolveConflictField.mockReset()
  controller = makeControllerStub()
  progressMock.createProgress.mockReset()
  progressMock.createProgress.mockReturnValue(controller)

  // progressHosts 是真实模块级单例：重置为生产初值，否则上一条用例的实例会串场
  progressHosts.enrich = null
  progressHosts.batch = null
  progressHosts.conflict = null

  m = await loadModule()
  m.bindConflictDialogButtons()
})

// ========== collectAllConflicts ==========

describe('collectAllConflicts', () => {
  it('结果集里没有任何 conflicts → 返回空数组', () => {
    expect(m.collectAllConflicts([])).toEqual([])
    expect(
      m.collectAllConflicts([{ conflicts: [] } as unknown as EnrichResultItem]),
    ).toEqual([])
  })

  it('conflicts 为 undefined 的条目被跳过', () => {
    expect(m.collectAllConflicts([{} as EnrichResultItem])).toEqual([])
  })

  it('多条结果的冲突按顺序展平合并', () => {
    const first = makeConflict({ fieldName: '脚本' })
    const second = makeConflict({ fieldName: '导演' })
    const third = makeConflict({ fieldName: '编剧' })

    const collected = m.collectAllConflicts([
      { conflicts: [first, second] } as unknown as EnrichResultItem,
      { conflicts: undefined } as unknown as EnrichResultItem,
      { conflicts: [third] } as unknown as EnrichResultItem,
    ])

    expect(collected).toEqual([first, second, third])
  })
})

// ========== bindConflictDialogButtons ==========

describe('bindConflictDialogButtons', () => {
  it('对话框元素不存在 → 静默返回，不抛错', async () => {
    clearDom()
    expect(() => {
      m.bindConflictDialogButtons()
    }).not.toThrow()
  })

  it('点击按钮把 dataset.resolution 传进解决流程', async () => {
    clearDom()
    const { buttons } = mountDialog()
    m.bindConflictDialogButtons()

    state.pendingConflicts = [makeConflict()]
    state.currentConflictIndex = 0
    state.bangumiSheet = { Name: 'BGM' } as never

    clickResolution(buttons, 'overwrite')

    expect(engineMock.resolveConflictField).toHaveBeenCalledTimes(1)
    expect(state.currentConflictIndex).toBe(1)
  })

  it('对话框内没有 data-resolution 按钮 → 不注册任何监听', async () => {
    clearDom()
    mountElement('conflictDialog')
    m.bindConflictDialogButtons()

    state.pendingConflicts = [makeConflict()]
    expect(state.currentConflictIndex).toBe(0)
    expect(engineMock.resolveConflictField).not.toHaveBeenCalled()
  })

  it('重复调用不会重复绑定（每次点击只推进一格）', async () => {
    clearDom()
    const { buttons } = mountDialog()
    m.bindConflictDialogButtons()
    m.bindConflictDialogButtons()

    state.pendingConflicts = [makeConflict(), makeConflict({ fieldName: '导演' })]
    state.bangumiSheet = null

    clickResolution(buttons, 'keep')
    clickResolution(buttons, 'keep')

    expect(state.currentConflictIndex).toBe(2)
    // 每次点击只走一次解决流程（若重复绑定了监听，这里会是 4 条）
    const parseLogs = utilityMock.bgmLog.mock.calls.filter((call) =>
      call[1].includes('[conflict] 字段'),
    )
    expect(parseLogs).toHaveLength(2)
  })
})

// ========== showConflictDialog ==========

describe('showConflictDialog', () => {
  it('对话框元素不存在 → 直接返回', () => {
    clearDom()
    state.pendingConflicts = [makeConflict()]
    expect(() => {
      m.showConflictDialog()
    }).not.toThrow()
    expect(progressMock.createProgress).not.toHaveBeenCalled()
  })

  it('当前索引没有冲突 → 隐藏对话框并回收进度实例', () => {
    const { dialog } = mountDialog()
    progressHosts.conflict = controller as never
    state.pendingConflicts = []
    state.currentConflictIndex = 0

    m.showConflictDialog()

    expect(dialog.style.display).toBe('none')
    expect(progressHosts.conflict).toBeNull()
    expect(controller.hide).toHaveBeenCalledTimes(1)
  })

  it('渲染冲突内容并显示对话框', () => {
    const { dialog } = mountDialog()
    state.pendingConflicts = [makeConflict(), makeConflict({ fieldName: '导演' })]
    state.currentConflictIndex = 0

    m.showConflictDialog()

    expect(document.getElementById('conflictTitle')?.textContent).toBe('⚡️ 字段冲突确认 (1/2)')
    expect(document.getElementById('conflictName')?.textContent).toBe('葬送的芙莉莲')
    expect(document.getElementById('conflictField')?.textContent).toBe('脚本')
    expect(document.getElementById('conflictOld')?.textContent).toBe('旧编剧')
    expect(document.getElementById('conflictNew')?.textContent).toBe('新编剧')
    expect(dialog.style.display).toBe('block')
    expect(progressMock.createProgress).toHaveBeenCalledTimes(1)
    expect(controller.update).toHaveBeenCalledWith(1, 2)
  })

  it('传递的进度宿主参数为冲突进度槽位', () => {
    mountDialog()
    state.pendingConflicts = [makeConflict()]

    m.showConflictDialog()

    expect(progressMock.createProgress.mock.calls[0]?.[0]).toMatchObject({
      mode: 'inline',
      hostId: 'conflictProgressHost',
      icon: '⚡️',
    })
  })

  it('重复展示复用同一个进度实例（不重复创建）', () => {
    mountDialog()
    state.pendingConflicts = [makeConflict(), makeConflict({ fieldName: '导演' })]

    state.currentConflictIndex = 0
    m.showConflictDialog()
    state.currentConflictIndex = 1
    m.showConflictDialog()

    expect(progressMock.createProgress).toHaveBeenCalledTimes(1)
    expect(controller.update).toHaveBeenLastCalledWith(2, 2)
  })

  it('标题等可选元素缺失 → 不抛错，对话框仍显示', () => {
    clearDom()
    const dialog = mountElement('conflictDialog')
    state.pendingConflicts = [makeConflict()]

    expect(() => {
      m.showConflictDialog()
    }).not.toThrow()
    expect(dialog.style.display).toBe('block')
  })
})

// ========== handleConflictResolution（经按钮点击） ==========

describe('冲突解决流程', () => {
  it('点击时当前索引已越界 → 直接返回，不调用引擎', async () => {
    clearDom()
    const { buttons } = mountDialog()
    m.bindConflictDialogButtons()

    state.pendingConflicts = []
    state.currentConflictIndex = 5

    clickResolution(buttons, 'keep')

    expect(engineMock.resolveConflictField).not.toHaveBeenCalled()
    expect(state.currentConflictIndex).toBe(5)
  })

  it('尚未选择 BGM 工作表 → 跳过引擎调用但仍记账并推进', async () => {
    clearDom()
    const { buttons } = mountDialog()
    m.bindConflictDialogButtons()

    state.bangumiSheet = null
    state.pendingConflicts = [makeConflict()]

    clickResolution(buttons, 'append')

    expect(engineMock.resolveConflictField).not.toHaveBeenCalled()
    expect(state.currentConflictIndex).toBe(1)
    expect(hasLogMessage('[conflict] 字段 "脚本" (葬送的芙莉莲): append')).toBe(true)
  })

  it('已选 BGM 工作表 → 调用引擎并把 resolution 写回冲突对象', async () => {
    clearDom()
    const { buttons } = mountDialog()
    m.bindConflictDialogButtons()

    const sheet = { Name: 'BGM' }
    const conflict = makeConflict()
    state.bangumiSheet = sheet as never
    state.pendingConflicts = [conflict]

    clickResolution(buttons, 'overwrite')

    expect(engineMock.resolveConflictField).toHaveBeenCalledTimes(1)
    expect(engineMock.resolveConflictField.mock.calls[0]?.[0]).toBe(sheet)
    expect(conflict.resolution).toBe('overwrite')
  })

  it('引擎抛错 → 记 ERROR 日志且流程继续推进', async () => {
    clearDom()
    const { buttons } = mountDialog()
    m.bindConflictDialogButtons()

    state.bangumiSheet = {} as never
    state.pendingConflicts = [makeConflict()]
    engineMock.resolveConflictField.mockImplementation(() => {
      throw new Error('写盘失败')
    })

    clickResolution(buttons, 'keep')

    expect(hasLogMessage('[conflict] 解析冲突失败: 写盘失败')).toBe(true)
    expect(state.currentConflictIndex).toBe(1)
  })

  it('引擎抛非 Error 值 → 用 String() 兜底拼接', async () => {
    clearDom()
    const { buttons } = mountDialog()
    m.bindConflictDialogButtons()

    state.bangumiSheet = {} as never
    state.pendingConflicts = [makeConflict()]
    engineMock.resolveConflictField.mockImplementation(() => {
      throw 'raw-string'
    })

    clickResolution(buttons, 'keep')

    expect(hasLogMessage('[conflict] 解析冲突失败: raw-string')).toBe(true)
  })

  it('还有下一个冲突 → 自动展示下一条', async () => {
    clearDom()
    const { buttons, dialog } = mountDialog()
    m.bindConflictDialogButtons()

    state.pendingConflicts = [makeConflict(), makeConflict({ fieldName: '导演' })]

    clickResolution(buttons, 'keep')

    expect(state.currentConflictIndex).toBe(1)
    expect(document.getElementById('conflictTitle')?.textContent).toBe('⚡️ 字段冲突确认 (2/2)')
    expect(document.getElementById('conflictField')?.textContent).toBe('导演')
    expect(dialog.style.display).toBe('block')
  })

  it('解决最后一条时对话框已从 DOM 移除 → 只回收进度实例，不抛错', () => {
    clearDom()
    const { buttons, dialog } = mountDialog()
    m.bindConflictDialogButtons()

    state.pendingConflicts = [makeConflict()]
    progressHosts.conflict = controller as never

    // 按钮随容器一起脱离文档，但节点上的监听器仍可被直接派发
    dialog.remove()

    clickResolution(buttons, 'keep')

    expect(state.currentConflictIndex).toBe(1)
    expect(progressHosts.conflict).toBeNull()
    expect(controller.hide).toHaveBeenCalledTimes(1)
    expect(utilityMock.BGM.Dialog.alert).toHaveBeenCalledWith('冲突解决完成', '共处理 1 个字段冲突')
  })

  it('最后一条解决 → 收起对话框、记完成日志并弹出汇总', async () => {
    clearDom()
    const { buttons, dialog } = mountDialog()
    m.bindConflictDialogButtons()

    state.pendingConflicts = [makeConflict(), makeConflict({ fieldName: '导演' })]
    progressHosts.conflict = controller as never

    clickResolution(buttons, 'keep')
    clickResolution(buttons, 'keep')

    expect(state.currentConflictIndex).toBe(2)
    expect(dialog.style.display).toBe('none')
    expect(progressHosts.conflict).toBeNull()
    expect(hasLogMessage('[conflict] 所有冲突已解决')).toBe(true)
    expect(utilityMock.BGM.Dialog.alert).toHaveBeenCalledWith('冲突解决完成', '共处理 2 个字段冲突')
  })
})
