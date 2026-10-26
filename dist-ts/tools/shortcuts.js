/**
 * @fileoverview 全局快捷键（键盘 + 鼠标）
 * @module tools/shortcuts
 * @description 让用户自定义「打开某个面板」的键盘组合与侧栏导航上的鼠标手势，
 *              并提供冲突检测：同一个组合被两个动作占用时拒绝保存并指出占用者。
 *
 * 设计要点：
 *   1. **动作清单是唯一真相**（`SHORTCUT_ACTIONS`）：设置页的绑定列表由它渲染，
 *      默认值也写在它里面 —— 新增动作只改这一处，不必再同步一份 HTML。
 *   2. **存的是「用户改过的差异」而不是整张表**：`bgm_shortcut_bindings` 里只放
 *      改过 / 清空的动作（清空存空串）。这样以后给某个动作换默认键，老用户不会
 *      被冻在旧默认值上（自愈思路与 nav-order / module-state 一致）。
 *   3. **冲突在写入侧就拦掉**：冲突的两条绑定一旦落盘，运行时分发就会随机命中
 *      其中一个（取决于遍历顺序），用户会觉得「快捷键时灵时不灵」。故
 *      `setShortcutBinding` 遇到重复组合直接返回占用者，由 UI 提示，不写盘。
 *   4. **分发器只挂一次**：`startShortcutDispatcher` 幂等，由 `initializeTheme`
 *      统一启动 —— 那是所有页面（panel / enrich / clean / highlight /
 *      conditional-format / settings / donate）唯一都调用的公共入口，
 *      不必再维护「哪几个入口要记得加」的平行清单。
 *   5. **输入框里不抢键**：焦点在 input / textarea / select / contenteditable 时
 *      直接放行，否则用户没法在输入框里打「Alt+1」这类字符。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { CONFIG_KEYS, getConfig, setConfig } from './config.js';
import { applyModuleState, enterSoloMode, exitSoloMode, isSoloMode, toggleModuleHidden, } from './module-state.js';
import { bgmLog, showBangumiPanel, showCleanPanel, showConditionalFormatPanel, showEnrichPanel, showHighlightPanel, showSettingsPanel, } from './util/index.js';
/**
 * 全部可绑定动作（唯一真相）
 *
 * 只放「跨页面都用得上」的动作：面板跳转。页面内的具体操作（同步 / 清理 / 应用）
 * 各自有显式按钮，绑成全局键反而容易误触（尤其 Alt+S 与宿主菜单冲突）。
 */
export const SHORTCUT_ACTIONS = [
    { id: 'nav.bangumi', label: '主面板', defaultKey: 'Alt+1', hint: '打开 Bangumi 数据面板' },
    { id: 'nav.enrich', label: '富化面板', defaultKey: 'Alt+2', hint: '打开新番表富化面板' },
    { id: 'nav.clean', label: '清理面板', defaultKey: 'Alt+3', hint: '打开数据清理面板' },
    { id: 'nav.highlight', label: '高亮面板', defaultKey: 'Alt+4', hint: '打开番剧高亮面板' },
    {
        id: 'nav.conditionalFormat',
        label: '条件格式',
        defaultKey: 'Alt+5',
        hint: '打开条件格式管理页',
    },
    { id: 'nav.settings', label: '设置页', defaultKey: 'Alt+6', hint: '打开设置页' },
];
/** 动作 id → 动作定义（查表用，避免每次 find） */
const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));
/** 只按下修饰键时返回空串（不算一个组合） */
const MODIFIER_KEY_NAMES = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock']);
/** 特殊键的展示名（其余键直接用大写字符 / 原名） */
const KEY_DISPLAY_NAMES = {
    ' ': 'Space',
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Del',
    Tab: 'Tab',
};
// ========== 键盘组合的规范化 ==========
/** 单个按键的展示名 */
function normalizeKeyName(key) {
    const named = KEY_DISPLAY_NAMES[key];
    if (named !== undefined)
        return named;
    return key.length === 1 ? key.toUpperCase() : key;
}
/**
 * 把键盘事件规范成存储 / 比较用的组合串（修饰键固定顺序：Ctrl+Alt+Shift+Meta+键）
 *
 * 固定顺序是冲突检测的前提：用户先按 Ctrl 还是先按 Shift 都是同一个组合，
 * 否则「Ctrl+Shift+K」和「Shift+Ctrl+K」会被当成两个键、冲突检测失效。
 */
export function normalizeKeyboardEvent(event) {
    if (MODIFIER_KEY_NAMES.has(event.key))
        return '';
    const parts = [];
    if (event.ctrlKey)
        parts.push('Ctrl');
    if (event.altKey)
        parts.push('Alt');
    if (event.shiftKey)
        parts.push('Shift');
    if (event.metaKey)
        parts.push('Meta');
    parts.push(normalizeKeyName(event.key));
    return parts.join('+');
}
/** 组合串的展示名（空串 → 「未绑定」） */
export function describeShortcut(combo) {
    return combo === '' ? '未绑定' : combo;
}
// ========== 存储读写 ==========
/** 读取用户改过的绑定差异（`{ 动作 id: 组合串 }`），坏数据当空对象 */
function readBindingDiff(isSilent) {
    const raw = getConfig(CONFIG_KEYS.SHORTCUT_BINDINGS, '', isSilent);
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        const result = {};
        for (const [id, value] of Object.entries(parsed)) {
            if (typeof value === 'string' && ACTION_BY_ID.has(id))
                result[id] = value;
        }
        return result;
    }
    catch (error) {
        bgmLog(LOG_LEVELS.WARN, `[shortcuts] 绑定配置解析失败: ${error.message}`);
        return {};
    }
}
/** 写回绑定差异（空对象时删键，保持存储干净） */
function saveBindingDiff(diff) {
    return setConfig(CONFIG_KEYS.SHORTCUT_BINDINGS, JSON.stringify(diff));
}
/**
 * 当前生效的完整绑定表（默认值 + 用户差异）
 * @param isSilent - 静默模式（轮询 / 分发器热路径用）
 */
export function getShortcutBindings(isSilent = false) {
    const diff = readBindingDiff(isSilent);
    const bindings = {};
    for (const action of SHORTCUT_ACTIONS) {
        bindings[action.id] = diff[action.id] ?? action.defaultKey;
    }
    return bindings;
}
/**
 * 找出被多个动作共用的组合
 * @returns 冲突列表（combo + 占用它的动作 id）；空数组表示无冲突
 */
export function findShortcutConflicts(bindings) {
    const byCombo = new Map();
    const entries = Object.entries(bindings).filter(([, combo]) => combo !== '');
    for (const [id, combo] of entries) {
        const list = byCombo.get(combo);
        if (list === undefined)
            byCombo.set(combo, [id]);
        else
            list.push(id);
    }
    const conflicts = [];
    for (const [combo, actionIds] of byCombo) {
        if (actionIds.length > 1)
            conflicts.push({ combo, actionIds });
    }
    return conflicts;
}
/** 设置单个动作的绑定；组合已被别的动作占用时拒绝并返回占用者 */
export function setShortcutBinding(actionId, combo) {
    if (!ACTION_BY_ID.has(actionId))
        return { ok: false, conflictWith: null };
    if (combo !== '') {
        const current = getShortcutBindings(true);
        const holder = Object.entries(current).find(([id, value]) => value === combo && id !== actionId);
        if (holder !== undefined) {
            bgmLog(LOG_LEVELS.WARN, `[shortcuts] 组合 ${combo} 已被 ${holder[0]} 占用，拒绝写入`);
            return { ok: false, conflictWith: holder[0] };
        }
    }
    const diff = readBindingDiff(false);
    const action = ACTION_BY_ID.get(actionId);
    // 与默认值相同时不留差异（配置里少一条，换默认值时能跟上）
    if (combo === action?.defaultKey)
        Reflect.deleteProperty(diff, actionId);
    else
        diff[actionId] = combo;
    const isSaved = saveBindingDiff(diff);
    if (isSaved)
        bgmLog(LOG_LEVELS.INFO, `[shortcuts] ${actionId} 绑定为「${describeShortcut(combo)}」`);
    return { ok: isSaved, conflictWith: null };
}
/** 单个动作恢复默认组合 */
export function resetShortcutBinding(actionId) {
    const diff = readBindingDiff(false);
    if (!Object.hasOwn(diff, actionId))
        return true;
    Reflect.deleteProperty(diff, actionId);
    return saveBindingDiff(diff);
}
/** 全部动作恢复默认（清空整份差异） */
export function resetAllShortcutBindings() {
    return saveBindingDiff({});
}
// ========== 总开关 ==========
/** 快捷键总开关（默认开） */
export function areShortcutsEnabled(isSilent = false) {
    return getConfig(CONFIG_KEYS.SHORTCUTS_ENABLED, 'true', isSilent) === 'true';
}
export function setShortcutsEnabled(isEnabled) {
    return setConfig(CONFIG_KEYS.SHORTCUTS_ENABLED, isEnabled ? 'true' : 'false');
}
// ========== 鼠标快捷键（侧栏导航上的手势） ==========
const MOUSE_ACTIONS = ['none', 'solo', 'hide'];
/** 鼠标动作的中文名（设置页下拉用） */
export const MOUSE_ACTION_LABELS = {
    none: '不响应',
    solo: '只显示该模块（专注）',
    hide: '隐藏该模块',
};
const DEFAULT_MOUSE_SHORTCUTS = { middle: 'solo', ctrlClick: 'hide' };
/** 槽位名 → 中文名 */
export const MOUSE_SLOT_LABELS = {
    middle: '中键点击导航项',
    ctrlClick: 'Ctrl + 左键点击导航项',
};
function normalizeMouseAction(value) {
    return MOUSE_ACTIONS.includes(value)
        ? value
        : 'none';
}
/** 读取鼠标手势配置（坏数据逐槽回落默认值） */
export function getMouseShortcuts(isSilent = false) {
    const raw = getConfig(CONFIG_KEYS.SHORTCUT_MOUSE, '', isSilent);
    if (!raw)
        return { ...DEFAULT_MOUSE_SHORTCUTS };
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ...DEFAULT_MOUSE_SHORTCUTS };
        }
        const record = parsed;
        const middle = typeof record.middle === 'string' ? record.middle : '';
        const ctrlClick = typeof record.ctrlClick === 'string' ? record.ctrlClick : '';
        return {
            middle: middle === '' ? DEFAULT_MOUSE_SHORTCUTS.middle : normalizeMouseAction(middle),
            ctrlClick: ctrlClick === '' ? DEFAULT_MOUSE_SHORTCUTS.ctrlClick : normalizeMouseAction(ctrlClick),
        };
    }
    catch {
        return { ...DEFAULT_MOUSE_SHORTCUTS };
    }
}
/** 设置某个槽位的鼠标手势 */
export function setMouseShortcut(slot, action) {
    if (!Object.hasOwn(MOUSE_SLOT_LABELS, slot))
        return false;
    const next = getMouseShortcuts(true);
    next[slot] = normalizeMouseAction(action);
    return setConfig(CONFIG_KEYS.SHORTCUT_MOUSE, JSON.stringify(next));
}
// ========== 执行 ==========
/**
 * 执行一个快捷键动作（未知 id 直接忽略，调用方先用 `SHORTCUT_ACTIONS` 判存在）
 */
export function runShortcutAction(actionId) {
    switch (actionId) {
        case 'nav.bangumi': {
            showBangumiPanel();
            break;
        }
        case 'nav.enrich': {
            showEnrichPanel();
            break;
        }
        case 'nav.clean': {
            showCleanPanel();
            break;
        }
        case 'nav.highlight': {
            showHighlightPanel();
            break;
        }
        case 'nav.conditionalFormat': {
            showConditionalFormatPanel();
            break;
        }
        case 'nav.settings': {
            showSettingsPanel();
            break;
        }
        default: {
            break;
        }
    }
}
/** 当前页面的键（取自 `body[data-page]`） */
function currentPageKey() {
    return document.body.dataset.page ?? '';
}
/** 在侧栏导航项上执行鼠标手势 */
function runNavMouseAction(action, moduleId) {
    if (action === 'none' || moduleId === '')
        return;
    const page = currentPageKey();
    if (!page)
        return;
    if (action === 'hide') {
        toggleModuleHidden(page, moduleId);
        applyModuleState(page);
        bgmLog(LOG_LEVELS.INFO, `[shortcuts] 鼠标手势隐藏模块: ${page} / ${moduleId}`);
        return;
    }
    // 专注：已在专注态且点的正是当前模块 → 退出（与标题栏 ⛶ 按钮同语义）
    if (isSoloMode())
        exitSoloMode();
    else
        enterSoloMode(page, moduleId);
    bgmLog(LOG_LEVELS.INFO, `[shortcuts] 鼠标手势切换专注: ${page} / ${moduleId}`);
}
/** 从事件目标向上找侧栏导航项，取出它指向的模块 id */
function navModuleIdOf(target) {
    if (!(target instanceof Element))
        return '';
    const link = target.closest('.nav a[href^="#"]');
    const href = link?.getAttribute('href') ?? '';
    return href.length > 1 ? href.slice(1) : '';
}
/** 键盘：命中绑定就执行并阻止默认行为 */
function onKeyDown(event) {
    if (event.defaultPrevented)
        return;
    if (!areShortcutsEnabled(true))
        return;
    const { target } = event;
    if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable)
            return;
    }
    const combo = normalizeKeyboardEvent(event);
    if (combo === '')
        return;
    const match = Object.entries(getShortcutBindings(true)).find(([, value]) => value === combo);
    if (match === undefined)
        return;
    const [actionId] = match;
    if (!ACTION_BY_ID.has(actionId))
        return;
    event.preventDefault();
    runShortcutAction(actionId);
    bgmLog(LOG_LEVELS.INFO, `[shortcuts] 键盘触发 ${actionId}（${combo}）`);
}
/** 鼠标：中键 / Ctrl+左键命中导航项时执行配置的手势 */
function onNavMouse(event) {
    if (!areShortcutsEnabled(true))
        return;
    const isMiddle = event.type === 'auxclick' && event.button === 1;
    const isCtrlClick = event.type === 'click' && event.button === 0 && event.ctrlKey;
    if (!isMiddle && !isCtrlClick)
        return;
    const moduleId = navModuleIdOf(event.target);
    if (moduleId === '')
        return;
    const { middle, ctrlClick } = getMouseShortcuts(true);
    const action = isMiddle ? middle : ctrlClick;
    if (action === 'none')
        return;
    event.preventDefault();
    runNavMouseAction(action, moduleId);
}
/** 非 DOM 环境下的空清理函数 */
function noopCleanup() {
    /* 无需清理 */
}
/** 分发器是否已挂（幂等：重复调用不会重复绑定） */
let isDispatcherBound = false;
/**
 * 启动快捷键分发器（键盘 + 侧栏鼠标手势）
 *
 * 幂等：各页面入口都会经 `initializeTheme` 调用它，重复调用直接返回空清理函数。
 * @returns 清理函数（解绑监听）
 */
export function startShortcutDispatcher() {
    if (typeof document === 'undefined')
        return noopCleanup;
    if (isDispatcherBound)
        return noopCleanup;
    isDispatcherBound = true;
    // capture：宿主 / 组件自己的 keydown 处理器可能 stopPropagation，
    // 冒泡阶段会漏掉；捕获阶段先拿到。
    document.addEventListener('keydown', onKeyDown, { capture: true });
    document.addEventListener('auxclick', onNavMouse, { capture: true });
    document.addEventListener('click', onNavMouse, { capture: true });
    bgmLog(LOG_LEVELS.INFO, '[shortcuts] 快捷键分发器已启动');
    return () => {
        document.removeEventListener('keydown', onKeyDown, { capture: true });
        document.removeEventListener('auxclick', onNavMouse, { capture: true });
        document.removeEventListener('click', onNavMouse, { capture: true });
        isDispatcherBound = false;
    };
}
