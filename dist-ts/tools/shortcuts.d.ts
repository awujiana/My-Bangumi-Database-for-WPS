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
/** 一个可绑定快捷键的动作 */
export interface ShortcutAction {
    /** 稳定 id（存储键；改名会丢用户绑定，故不要随文案改） */
    id: string;
    /** 设置页里显示的动作名 */
    label: string;
    /** 默认组合（空串 = 默认不绑定） */
    defaultKey: string;
    /** 一句话说明 */
    hint: string;
}
/**
 * 全部可绑定动作（唯一真相）
 *
 * 只放「跨页面都用得上」的动作：面板跳转。页面内的具体操作（同步 / 清理 / 应用）
 * 各自有显式按钮，绑成全局键反而容易误触（尤其 Alt+S 与宿主菜单冲突）。
 */
export declare const SHORTCUT_ACTIONS: readonly ShortcutAction[];
/**
 * 把键盘事件规范成存储 / 比较用的组合串（修饰键固定顺序：Ctrl+Alt+Shift+Meta+键）
 *
 * 固定顺序是冲突检测的前提：用户先按 Ctrl 还是先按 Shift 都是同一个组合，
 * 否则「Ctrl+Shift+K」和「Shift+Ctrl+K」会被当成两个键、冲突检测失效。
 */
export declare function normalizeKeyboardEvent(event: KeyboardEvent): string;
/** 组合串的展示名（空串 → 「未绑定」） */
export declare function describeShortcut(combo: string): string;
/**
 * 当前生效的完整绑定表（默认值 + 用户差异）
 * @param isSilent - 静默模式（轮询 / 分发器热路径用）
 */
export declare function getShortcutBindings(isSilent?: boolean): Record<string, string>;
/**
 * 找出被多个动作共用的组合
 * @returns 冲突列表（combo + 占用它的动作 id）；空数组表示无冲突
 */
export declare function findShortcutConflicts(bindings: Readonly<Record<string, string>>): {
    combo: string;
    actionIds: string[];
}[];
/** 设置单个动作的绑定；组合已被别的动作占用时拒绝并返回占用者 */
export declare function setShortcutBinding(actionId: string, combo: string): {
    ok: boolean;
    conflictWith: string | null;
};
/** 单个动作恢复默认组合 */
export declare function resetShortcutBinding(actionId: string): boolean;
/** 全部动作恢复默认（清空整份差异） */
export declare function resetAllShortcutBindings(): boolean;
/** 快捷键总开关（默认开） */
export declare function areShortcutsEnabled(isSilent?: boolean): boolean;
export declare function setShortcutsEnabled(isEnabled: boolean): boolean;
declare const MOUSE_ACTIONS: readonly ["none", "solo", "hide"];
/** 侧栏导航上可用鼠标手势触发的动作 */
export type MouseShortcutAction = (typeof MOUSE_ACTIONS)[number];
/** 鼠标动作的中文名（设置页下拉用） */
export declare const MOUSE_ACTION_LABELS: Readonly<Record<MouseShortcutAction, string>>;
/** 两个可配置的鼠标手势槽位 */
export interface MouseShortcutConfig {
    /** 中键点击导航项 */
    middle: MouseShortcutAction;
    /** Ctrl + 左键点击导航项 */
    ctrlClick: MouseShortcutAction;
}
/** 槽位名 → 中文名 */
export declare const MOUSE_SLOT_LABELS: Readonly<Record<keyof MouseShortcutConfig, string>>;
/** 读取鼠标手势配置（坏数据逐槽回落默认值） */
export declare function getMouseShortcuts(isSilent?: boolean): MouseShortcutConfig;
/** 设置某个槽位的鼠标手势 */
export declare function setMouseShortcut(slot: keyof MouseShortcutConfig, action: string): boolean;
/**
 * 执行一个快捷键动作（未知 id 直接忽略，调用方先用 `SHORTCUT_ACTIONS` 判存在）
 */
export declare function runShortcutAction(actionId: string): void;
/**
 * 启动快捷键分发器（键盘 + 侧栏鼠标手势）
 *
 * 幂等：各页面入口都会经 `initializeTheme` 调用它，重复调用直接返回空清理函数。
 * @returns 清理函数（解绑监听）
 */
export declare function startShortcutDispatcher(): () => void;
export {};
//# sourceMappingURL=shortcuts.d.ts.map