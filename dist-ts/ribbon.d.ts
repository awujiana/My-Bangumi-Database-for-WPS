/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
/**
 * 获取“跳过冲突”复选框的初始按下状态
 * 从 PluginStorage 读取上次保存的设置，默认未选中
 */
export declare function GetSkipConflictsPressed(control: any): boolean;
/**
 * 当“跳过冲突”复选框被点击时，保存状态
 */
export declare function OnSkipConflictsChange(control: any): void;
export declare function GetIncrementalSyncPressed(control: any): boolean;
export declare function OnIncrementalSyncChange(control: any): void;
export declare function OnAddinLoad(ribbonUI: any): boolean;
export declare function OnAction(control: {
    Id: string;
}): boolean;
export declare function GetBangumiImage(control: {
    Id: string;
}): string;
//# sourceMappingURL=ribbon.d.ts.map