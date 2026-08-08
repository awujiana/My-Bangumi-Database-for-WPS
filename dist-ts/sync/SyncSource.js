/**
 * @fileoverview 同步源接口定义
 * @module sync/SyncSource
 * @description 定义统一的同步源接口，所有数据源（GitHub/GitLab/Gitee/本地文件/Gist）
 *              需实现此接口，由 syncSourceRegistry 注册并按 sourceType 调度。
 *
 * 设计目的：
 * - 解耦「数据来源」与「差异计算/应用」逻辑
 * - 新增数据源只需实现接口并注册，无需改动 syncFromGithub 主流程
 * - 通过统一校验接口让配置错误在调用前暴露
 */
export {};
//# sourceMappingURL=SyncSource.js.map