/**
 * Excel→Bangumi 同步模块 - re-export 入口
 * @module sync/exceltobangumi
 * @description 兼容入口：原 exceltobangumi.ts 已按职责拆分到 exceltobangumi/ 子目录，
 *              此文件仅做 re-export，保持外部 import 路径 `'./sync/exceltobangumi.js'` 不变。
 *
 * 拆分结构：
 *   - exceltobangumi/api.ts：API 请求层（openBangumiTokenPage、testTokenValidityForRibbon、bgmRequestSync、setBangumiToken 等）
 *   - exceltobangumi/chapterMarker.ts：章节标记（fetchEpisodeIds、markEpisodesComplete）
 *   - exceltobangumi/progressReporter.ts：进度上报与结果应用（SyncTask 类型、颜色标记、结果汇总）
 *   - exceltobangumi/index.ts：核心同步流程（常量、辅助函数、getFilterStatus、SyncToBangumiAsync、syncSelectedRows 等）
 */
export * from './exceltobangumi/index.js';
//# sourceMappingURL=exceltobangumi.js.map