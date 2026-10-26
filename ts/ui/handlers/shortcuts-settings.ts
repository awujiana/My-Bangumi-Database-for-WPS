/**
 * @fileoverview 设置页「⌨️ 快捷键」编辑器
 * @module ui/handlers/shortcuts-settings
 * @description 由 `tools/shortcuts` 的动作注册表渲染绑定清单（不手写 HTML 行），
 *              提供「点一下 → 按新键」的录制、单个 / 全部恢复默认、冲突提示，
 *              以及侧栏导航上的两个鼠标手势槽位。
 *
 * 设计要点：
 *  - 清单整体重渲染（行数固定 6 条，代价可忽略），避免逐行维护 DOM 状态；
 *  - 录制用 document 级 keydown 捕获阶段：录制期间 stopPropagation，
 *    否则按 Alt+1 会立刻触发「打开主面板」，用户看到的界面在录制时被切走；
 *  - 冲突不在 UI 层判：`setShortcutBinding` 已拒绝重复组合并返回占用者，
 *    UI 只负责把占用者的中文名说清楚（两处各判一次必然会漂）。
 */

import { LOG_LEVELS, bgmLog, showToast } from '../../index.js'
import {
  findShortcutConflicts,
  getMouseShortcuts,
  getShortcutBindings,
  areShortcutsEnabled,
  MOUSE_ACTION_LABELS,
  MOUSE_SLOT_LABELS,
  normalizeKeyboardEvent,
  resetAllShortcutBindings,
  resetShortcutBinding,
  setMouseShortcut,
  setShortcutBinding,
  setShortcutsEnabled,
  SHORTCUT_ACTIONS,
  describeShortcut,
} from '../../tools/shortcuts.js'
import type { MouseShortcutAction, MouseShortcutConfig } from '../../tools/shortcuts.js'

/** 正在录制新组合的动作 id（null = 未在录制） */
let recordingActionId: string | null = null

/** 动作 id → 中文名（冲突提示里说「被谁占用」） */
function actionLabel(actionId: string): string {
  return SHORTCUT_ACTIONS.find((action) => action.id === actionId)?.label ?? actionId
}

/** 渲染一条绑定行 */
function buildRow(actionId: string, label: string, combo: string, hint: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'shortcut-row'
  row.dataset.shortcutRow = actionId

  const name = document.createElement('span')
  name.className = 'shortcut-label'
  name.textContent = label
  name.title = hint

  const key = document.createElement('button')
  key.type = 'button'
  key.className = 'bgm-btn small shortcut-key'
  key.dataset.shortcutRecord = actionId
  key.textContent = describeShortcut(combo)
  key.title = '点一下，然后按下要绑定的组合键（Esc 取消）'
  key.setAttribute('aria-label', `${label} 当前绑定 ${describeShortcut(combo)}，点击可改绑`)

  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'bgm-btn small'
  reset.dataset.shortcutReset = actionId
  reset.textContent = '↩️'
  reset.title = '恢复默认组合'
  reset.setAttribute('aria-label', `${label} 恢复默认组合`)

  row.append(name, key, reset)
  return row
}

/** 渲染冲突提示（无冲突时隐藏） */
function renderConflicts(): void {
  const host = document.getElementById('shortcutConflicts')
  if (!host) return
  const conflicts = findShortcutConflicts(getShortcutBindings(true))
  if (conflicts.length === 0) {
    host.hidden = true
    host.textContent = ''
    return
  }
  host.hidden = false
  host.textContent = `⚠️ 有 ${String(conflicts.length)} 组组合被重复占用：${conflicts
    .map((item) => `${item.combo}（${item.actionIds.map((actionId) => actionLabel(actionId)).join('、')}）`)
    .join('；')}`
}

/** 重渲染整份绑定清单 */
export function renderShortcutList(): void {
  const host = document.getElementById('shortcutList')
  if (!host) return
  const bindings = getShortcutBindings(true)
  host.replaceChildren()
  for (const action of SHORTCUT_ACTIONS) {
    const combo = bindings[action.id] ?? ''
    const isRecording = recordingActionId === action.id
    const row = buildRow(action.id, action.label, isRecording ? '按下按键…' : combo, action.hint)
    if (isRecording) row.querySelector('.shortcut-key')?.classList.add('is-recording')
    host.append(row)
  }
  renderConflicts()
}

/** 渲染两个鼠标手势下拉（选项来自 MOUSE_ACTION_LABELS，不手写第二份清单） */
function renderMouseRows(): void {
  const host = document.getElementById('shortcutMouseRows')
  if (!host) return
  const config = getMouseShortcuts(true)
  host.replaceChildren()
  for (const slot of Object.keys(MOUSE_SLOT_LABELS) as (keyof MouseShortcutConfig)[]) {
    const row = document.createElement('div')
    row.className = 'form-group'

    const label = document.createElement('label')
    label.textContent = `鼠标 · ${MOUSE_SLOT_LABELS[slot]}`
    label.htmlFor = `shortcutMouse-${slot}`

    const select = document.createElement('select')
    select.className = 'input'
    select.id = `shortcutMouse-${slot}`
    select.dataset.shortcutMouse = slot
    for (const [value, text] of Object.entries(MOUSE_ACTION_LABELS)) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      select.append(option)
    }
    select.value = config[slot]

    row.append(label, select)
    host.append(row)
  }
}

/** 结束录制并重渲染 */
function stopRecording(): void {
  recordingActionId = null
  renderShortcutList()
}

/** 录制阶段的 keydown：先于全局分发器拿到按键（capture + stopPropagation） */
function onRecordingKeyDown(event: KeyboardEvent): void {
  if (recordingActionId === null) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    stopRecording()
    showToast('已取消改绑', 'info')
    return
  }
  const combo = normalizeKeyboardEvent(event)
  if (combo === '') return
  const actionId = recordingActionId
  const result = setShortcutBinding(actionId, combo)
  if (!result.ok) {
    const holder = result.conflictWith === null ? '其它动作' : `「${actionLabel(result.conflictWith)}」`
    showToast(`组合 ${combo} 已被${holder}占用，未保存`, 'warn')
    stopRecording()
    return
  }
  bgmLog(LOG_LEVELS.INFO, `[shortcuts] 设置页改绑 ${actionId} → ${combo}`)
  showToast(`「${actionLabel(actionId)}」已绑定 ${combo}`, 'success')
  stopRecording()
}

/** 清单点击委托：改绑 / 恢复默认 / 全部恢复 */
function onListClick(event: Event): void {
  const { target } = event
  if (!(target instanceof Element)) return

  const recordButton = target.closest<HTMLElement>('[data-shortcut-record]')
  const recordId = recordButton?.dataset.shortcutRecord
  if (recordId !== undefined) {
    event.preventDefault()
    recordingActionId = recordId
    renderShortcutList()
    return
  }

  const resetButton = target.closest<HTMLElement>('[data-shortcut-reset]')
  const resetId = resetButton?.dataset.shortcutReset
  if (resetId !== undefined) {
    event.preventDefault()
    if (resetShortcutBinding(resetId)) {
      showToast(`「${actionLabel(resetId)}」已恢复默认组合`, 'success')
      renderShortcutList()
    } else {
      showToast('恢复默认失败', 'error')
    }
    return
  }

  if (target.closest('[data-shortcut-reset-all]') !== null) {
    event.preventDefault()
    if (resetAllShortcutBindings()) {
      showToast('全部快捷键已恢复默认', 'success')
      renderShortcutList()
    } else {
      showToast('恢复默认失败', 'error')
    }
  }
}

/** 鼠标手势下拉的 change 委托 */
function onMouseChange(event: Event): void {
  const { target } = event
  if (!(target instanceof HTMLSelectElement)) return
  const slot = target.dataset.shortcutMouse
  if (slot !== 'middle' && slot !== 'ctrlClick') return
  const action = target.value as MouseShortcutAction
  if (setMouseShortcut(slot, action)) {
    showToast(`${MOUSE_SLOT_LABELS[slot]}：${MOUSE_ACTION_LABELS[action]}`, 'success')
  } else {
    showToast('鼠标手势保存失败', 'error')
  }
}

/** 总开关变化 */
function onEnabledChange(event: Event): void {
  const { target } = event
  if (!(target instanceof HTMLInputElement)) return
  if (setShortcutsEnabled(target.checked)) {
    showToast(target.checked ? '已启用全局快捷键' : '已停用全局快捷键', 'info')
  } else {
    showToast('快捷键开关保存失败', 'error')
  }
}

/**
 * 初始化设置页的快捷键编辑器。
 * 仅在存在 `#shortcutList` 的设置页生效，其余页面静默跳过。
 */
export function initializeShortcutSettings(): void {
  const list = document.getElementById('shortcutList')
  if (!list) return
  renderShortcutList()
  renderMouseRows()

  const enabled = document.getElementById('chkShortcutsEnabled')
  if (enabled instanceof HTMLInputElement) enabled.checked = areShortcutsEnabled(true)

  // 容器级委托：清单会整体重渲染，逐行绑定会随节点一起失效。
  // 绑在 #shortcutPanel（而非 #shortcutList）上，才能一并接住列表外的
  // 「全部恢复默认」按钮。
  const panel = document.getElementById('shortcutPanel') ?? list
  if (panel.dataset.bound !== '1') {
    panel.dataset.bound = '1'
    panel.addEventListener('click', onListClick)
    // 录制监听必须挂在 **window** 的捕获阶段：全局分发器挂在 document 的捕获阶段，
    // 而捕获路径是 window → document → …，只有挂在 window 才能抢在分发器前面
    // 拿到按键（否则录制时按 Alt+1 会先把界面切到主面板）。
    window.addEventListener('keydown', onRecordingKeyDown, { capture: true })
  }
  const mouseHost = document.getElementById('shortcutMouseRows')
  if (mouseHost !== null && mouseHost.dataset.bound !== '1') {
    mouseHost.dataset.bound = '1'
    mouseHost.addEventListener('change', onMouseChange)
  }
  if (enabled !== null && enabled.dataset.bound !== '1') {
    enabled.dataset.bound = '1'
    enabled.addEventListener('change', onEnabledChange)
  }
  bgmLog(LOG_LEVELS.INFO, '[shortcuts] 设置页快捷键编辑器已初始化')
}
