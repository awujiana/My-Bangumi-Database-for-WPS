/**
 * @fileoverview 数据中心页面逻辑（统计 / 推荐 / 搜索 / 更新检查 / 导出）
 * @module panel/dataCenterPage
 * @description 顶层只绑定 DOM 与 i18n；所有碰 COM 的读取都在按钮回调里执行。
 *              数据计算交给 services 层纯函数，图表交给 ui/data-center-charts.ts。
 */
/** 绑定所有按钮；重复调用安全（页面只初始化一次） */
export declare function initializeDataCenterPage(): void;
//# sourceMappingURL=data-center-page.d.ts.map