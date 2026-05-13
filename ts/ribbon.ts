/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import { WPS_ENUM, showBangumiPanel,BGM, getIncrementalSync, getSkipConflicts, setIncrementalSync, setSkipConflicts } from './index.js';
import * as RibbonService from './services/ribbonService.js';


/**
 * 获取“跳过冲突”复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetSkipConflictsPressed(control: any): boolean {
    return getSkipConflicts();
}

/**
 * 当“跳过冲突”复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control: any) {
    setSkipConflicts(control.Pressed);
}

/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetIncrementalSyncPressed(control: any): boolean {
    return getIncrementalSync();
}

/**
 * 当增量同步复选框被点击时，保存状态
 */
export function OnIncrementalSyncChange(control: any) {
    setIncrementalSync(control.Pressed);
}

// ========== Ribbon 回调 ==========

export function OnAddinLoad(ribbonUI: any): boolean {
    if (typeof (window as any).Application.ribbonUI !== 'object') {
        (window as any).Application.ribbonUI = ribbonUI;
    }
    if (typeof (window as any).Application.Enum !== 'object') {
        (window as any).Application.Enum = WPS_ENUM;
    }
    (window as any).Application.PluginStorage.setItem('EnableFlag', false);
    (window as any).Application.PluginStorage.setItem('ApiEventFlag', false);
    return true;
}