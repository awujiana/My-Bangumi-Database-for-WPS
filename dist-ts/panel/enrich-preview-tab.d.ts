/**
 * @fileoverview 富化页「数据预览」页签的可见性与提示文案
 * @module panel/enrich-preview-tab
 * @description
 *   页签切换（source=新番表数据 / match=匹配结果）会牵动一批预览区元素的显示
 *   与空态文案。这些函数被「初始化 / 表头识别 / 目标工作表选择 / 匹配预览 /
 *   富化执行」等多处调用，原先散落在 `enrich-page.ts` 的两个区块里。抽成叶子
 *   后，各流程模块可以单向依赖它而不必反向依赖 `enrich-page.ts`。
 *
 *   收口原则：**显示与否一律由 `applyPreviewTabVisibility` 决定**，其余函数只写
 *   内容或只切页签，避免"两处各管一半"导致切页签后残留上一个页签的提示。
 */
/** 设置预览区元素的显示/隐藏；hasTextOnly=true 时文本为空则强制隐藏 */
export declare function setPreviewElementVisible(id: string, isVisible: boolean, hasTextOnly?: boolean): void;
/**
 * 按当前页签统一设置「数据预览」各区块可见性。
 *
 * 目的：修复切换页签后残留上一个页签的提示/按钮（如新番表页签仍显示匹配统计卡片，
 * 或匹配结果页签仍显示「查看详细数据表格」），以及未预览时展示空白/仅表头表格的问题。
 */
export declare function applyPreviewTabVisibility(): void;
/** 切换「数据预览」页签（统一入口：同步 active 样式 + 各区块可见性） */
export declare function setPreviewTab(tab: 'source' | 'match'): void;
/**
 * 刷新匹配结果页签的提示文案（只写文案，显示与否由 applyPreviewTabVisibility 决定）。
 *
 * 三种状态：
 *   1. 尚未预览：给出「点击预览匹配」的引导，避免页签空白；
 *   2. 目标表为空且有未匹配条目：提示富化时将新增行数；
 *   3. 其余：清空文案（自动隐藏）。
 */
export declare function refreshMatchHintText(): void;
/** 清空匹配结果（切换源表/重新识别表头时调用，避免展示过期结果） */
export declare function resetMatchResults(): void;
//# sourceMappingURL=enrich-preview-tab.d.ts.map