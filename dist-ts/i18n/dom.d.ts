/**
 * @fileoverview 静态 HTML 的文案替换（`data-i18n*` 扫描）
 * @module i18n/dom
 * @description 页面加载后跑一次，切语言时再跑一次。**只改文案，不动结构**：
 *   `data-i18n` 用 `textContent` 整段替换，所以带子元素（图标 + 文字）的节点
 *   要挂在内层纯文本节点上，不能挂在容器上——否则图标会被抹掉。
 *
 * ## 为什么必须先判断「源语言就绪」
 *
 * 语言包加载失败时 `t()` 会原样返回 key。如果这时照常跑 `applyI18n`，整个界面
 * 会变成一片 `ribbon.buttonOpenSyncPanel` 这种字样——**比不翻译更糟**。所以源语言没
 * 加载成功时，本模块一个字都不改，HTML 里写的简体原文就是兜底。
 */
/** 当前是否具备替换条件（源语言已加载） */
export declare function canApplyI18n(): boolean;
/**
 * 把 `root` 子树里的 `data-i18n*` 全部按当前语言重写
 *
 * @param root - 扫描起点；默认 `document`
 */
export declare function applyI18n(root?: ParentNode): void;
//# sourceMappingURL=dom.d.ts.map