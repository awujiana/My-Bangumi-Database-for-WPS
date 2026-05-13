/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
/**
 * 获取"跳过冲突"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export declare function GetSkipConflictsPressed(control: any): boolean;
/**
 * 当"跳过冲突"复选框被点击时，保存状态
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
/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */
export declare function OnAction(control: any): void;
/**
 * 获取按钮图标（占位函数，实际图标由 CSS 或图片提供）
 */
export declare function GetBangumiImage(control: any): string;
export declare function OnAddinLoad(ribbonUI: any): boolean;
//# sourceMappingURL=ribbon.d.ts.map