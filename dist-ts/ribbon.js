/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
import { WPS_ENUM, getIncrementalSync, getSkipConflicts, setIncrementalSync, setSkipConflicts } from './index.js';
/**
 * 获取“跳过冲突”复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetSkipConflictsPressed(control) {
    return getSkipConflicts();
}
/**
 * 当“跳过冲突”复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control) {
    setSkipConflicts(control.Pressed);
}
/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetIncrementalSyncPressed(control) {
    return getIncrementalSync();
}
/**
 * 当增量同步复选框被点击时，保存状态
 */
export function OnIncrementalSyncChange(control) {
    setIncrementalSync(control.Pressed);
}
// ========== Ribbon 回调 ==========
export function OnAddinLoad(ribbonUI) {
    if (typeof window.Application.ribbonUI !== 'object') {
        window.Application.ribbonUI = ribbonUI;
    }
    if (typeof window.Application.Enum !== 'object') {
        window.Application.Enum = WPS_ENUM;
    }
    window.Application.PluginStorage.setItem('EnableFlag', false);
    window.Application.PluginStorage.setItem('ApiEventFlag', false);
    return true;
}
