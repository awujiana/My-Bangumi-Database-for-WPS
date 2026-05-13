/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
/**
 * 获取“跳过冲突”复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export declare function GetSkipConflictsPressed(control: any): boolean;
/**
 * 当“跳过冲突”复选框被点击时，保存状态
 */
export declare function OnSkipConflictsChange(control: any): void;
/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export declare function GetIncrementalSyncPressed(control: any): boolean;
/**
 * 当增量同步复选框被点击时，保存状态
 */
export declare function OnIncrementalSyncChange(control: any): void;
export declare function OnAddinLoad(ribbonUI: any): boolean;
//# sourceMappingURL=ribbon.d.ts.map