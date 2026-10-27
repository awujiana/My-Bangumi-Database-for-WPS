/**
 * @fileoverview 同步前列映射确认对话框
 * @module ui/syncMappingDialog
 * @description 2026-10-17 新增。点「立即同步」后**先**弹本框，展示「远程字段 → 本地列」
 *              的对应关系，用户可：
 *              ① 取消勾选（该字段本次不下载也不写入）；
 *              ② 拖拽排序（仅展示顺序；写入按列名寻址，顺序不影响结果）；
 *              ③ 改目标列（把某个远程字段写到本地另一列）；
 *              ④ 一键补齐缺失列（把缺的列名写进表头行末尾，写后读回校验）。
 *              确认后返回 {@link SyncMappingConfig} 交给同步主流程；取消返回 null。
 *
 *              纯逻辑（行构建 / 选择解析 / 冲突校验）在 `sync/sync-mapping.ts`；
 *              本模块只负责 DOM 与写表头。DOM 模式与 `sync-result-dialog.ts` 一致
 *              （自建 `.bgm-modal` + innerHTML + 事件绑定），复用既有 dialog 样式类。
 */
import type { SyncMappingConfig } from '../sync/sync-mapping.js';
/**
 * 显示列映射确认框
 *
 * @returns 用户确认后的配置；点「取消同步」/ 遮罩 / ESC 返回 null。
 *          读不到工作表时返回空配置（不阻塞同步，等价于「全部按默认」）。
 */
export declare function showSyncMappingDialog(): Promise<SyncMappingConfig | null>;
//# sourceMappingURL=sync-mapping-dialog.d.ts.map