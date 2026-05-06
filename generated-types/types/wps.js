/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */
// ========== 类型守卫函数 ==========
/**
 * 检查对象是否为有效的 WPS Application
 */
export function isWpsApp(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'ActiveWorkbook' in value);
}
/**
 * 检查对象是否为有效的 WPS 工作表
 */
export function isWpsWorksheet(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'Name' in value &&
        'Range' in value);
}
/**
 * 检查对象是否为有效的 WPS Range
 */
export function isWpsRange(value) {
    return (typeof value === 'object' &&
        value !== null &&
        ('Row' in value ||
            'Value' in value ||
            'Value2' in value));
}
