/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
/**
 * WPS Ribbon 控件回调参数最小接口
 * WPS Ribbon 系统在调用 getPressed/onAction 回调时传入的 control 对象。
 * 第三方 WPS Ribbon API 无 @types，仅定义本项目使用到的字段。
 */
interface WpsRibbonControl {
    /** 控件 ID（对应 ribbon.xml 中的 id 属性） */
    Id?: string;
    /** 控件 Tag（对应 ribbon.xml 中的 tag 属性） */
    Tag?: string;
    /** 复选框当前按下状态（仅 checkBox 控件回调使用） */
    Pressed?: boolean;
    /** 上下文对象（通常为当前 Workbook） */
    Context?: unknown;
}
/**
 * WPS Ribbon UI 最小接口定义
 * 第三方 WPS Ribbon API 无 @types，仅定义本项目使用到的方法
 */
interface WpsRibbonUI {
    Invalidate(): void;
    InvalidateControl(id: string): void;
    ActivateTab?(tabId: string): void;
}
/**
 * 初始化 Ribbon 模块：注册消息监听器 + 启动配置轮询。
 *
 * postMessage 仅在同上下文（同源 iframe）中生效，
 * 轮询机制作为跨 WebView 通信的兜底方案。
 *
 * 必须由显式入口（如 `ts/entry/ribbon-entry.ts`）调用，
 * 不在模块加载时自动执行，便于在测试环境按需初始化。
 */
export declare function initRibbon(): void;
/**
 * 移除 Ribbon 消息监听器 + 停止配置轮询，防止内存泄漏
 */
export declare function removeRibbonMessageListener(): void;
/**
 * 获取"跳过冲突"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export declare function GetSkipConflictsPressed(_control: WpsRibbonControl): boolean;
/**
 * 当"跳过冲突"复选框被点击时，保存状态
 */
export declare function OnSkipConflictsChange(control: WpsRibbonControl): boolean;
/**
 * 获取"启用同步记录"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export declare function GetEnableSyncRecordPressed(_control: WpsRibbonControl): boolean;
/**
 * 当"启用同步记录"复选框被点击时，保存状态
 */
export declare function OnEnableSyncRecordChange(control: WpsRibbonControl): boolean;
/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export declare function GetIncrementalSyncPressed(_control: WpsRibbonControl): boolean;
/**
 * 当增量同步复选框被点击时，保存状态
 */
export declare function OnIncrementalSyncChange(control: WpsRibbonControl): boolean;
export declare function OnAddinLoad(ribbonUI: WpsRibbonUI): boolean;
/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */
export declare function OnAction(control: {
    Id: string;
}): boolean;
export declare function GetBangumiImage(control: {
    Id: string;
}): string;
export {};
//# sourceMappingURL=ribbon.d.ts.map