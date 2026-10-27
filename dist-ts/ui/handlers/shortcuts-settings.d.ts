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
/** 重渲染整份绑定清单 */
export declare function renderShortcutList(): void;
/**
 * 初始化设置页的快捷键编辑器。
 * 仅在存在 `#shortcutList` 的设置页生效，其余页面静默跳过。
 */
export declare function initializeShortcutSettings(): void;
//# sourceMappingURL=shortcuts-settings.d.ts.map