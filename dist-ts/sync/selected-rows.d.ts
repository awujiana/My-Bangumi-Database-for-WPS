/**
 * @fileoverview 从 WPS 当前选区提取行 SID（「仅同步选中行」共用）
 * @module sync/selectedRows
 * @description `github-sync.ts` 与 `sync-source-registry.ts` 此前各有一份
 *              **逐字重复**的实现（连日志文案都一样），收敛为一份，避免后续各自漂移。
 *
 *              依赖只有 `tools/util/index.js` 与 `pure-utilities.js`，是零副作用的叶子模块。
 */
/**
 * 从 WPS 当前选区提取所有行的 SID 集合（用于「仅同步选中行」）
 *
 * 遍历 Selection 的行范围，读取每行的 Bangumi_URL 列并提取 SID。
 *
 * @returns SID 字符串集合；空集合表示未选中行或未找到 URL
 */
export declare function getSelectedRowSubjectIds(): Set<string>;
//# sourceMappingURL=selected-rows.d.ts.map