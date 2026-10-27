/**
 * @fileoverview 通用清理页面的 UI 控制器
 * @module panel/cleanPage
 * @description
 * 页面**不含任何硬编码路径 / 表名 / 清理算法**：
 * - 可清理项：由 `clean-rules.ts` 的 CLEAN_RULES 渲染（新增项只改配置）；
 * - 清理范围：由 `clean-engine.ts` 的 describeCleanScope() 读取配置后展示；
 * - 预览 / 执行：全部委托引擎，页面只负责渲染与交互。
 */
/**
 * 初始化清理页面。
 * 幂等：重复调用只会重复渲染（不重复绑定按钮），由 bootstrap 保证单次调用。
 */
export declare function initializeCleanPage(): void;
//# sourceMappingURL=clean-page.d.ts.map