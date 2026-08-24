/**
 * 工具模块 - re-export 入口
 * @module tools/util
 * @description 兼容入口：原 util.ts 已按职责拆分到 util/ 子目录，
 *              此文件仅做 re-export，保持外部 import 路径 `'./tools/util.js'` 不变。
 *
 * 拆分结构：
 *   - util/cell.ts：单元格读取/设置（getCell、getCellValue、setCellValue、getSheetByIndex）
 *   - util/sheet.ts：工作表读取/缓存（readRangeValues、cacheGet、findHeaderRow、getColumnMap、clearSheetCache、getLastRow、isEmptyValue、getDataSheet、safeActivate）
 *   - util/sleep.ts：延时（sleep、delay）
 *   - util/index.ts：BGM 命名空间、bgmLog、getApp、Token 存储、用户 ID/用户名、辅助函数（shellExecuteByOAAssist、getUrlPath、showBangumiPanel）
 */
export * from './util/index.js';
//# sourceMappingURL=util.js.map