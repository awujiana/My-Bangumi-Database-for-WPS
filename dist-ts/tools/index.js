/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口
 *              其他模块只需 `import { ... } from './types/index.js'`
 */
// ========== 错误级别枚举 ==========
export const ErrorLevel = {
    SILENT: 0,
    WARN: 1,
    ERROR: 2,
    THROW: 3
};
export { isWpsApp, isWpsWorksheet, isWpsRange } from './wps.js';
