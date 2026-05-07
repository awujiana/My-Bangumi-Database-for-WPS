/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
interface RibbonControl {
    Id: string;
    [key: string]: any;
}
interface RibbonUI {
    [key: string]: any;
}
/**
 * 加载项初始化回调
 * @param ribbonUI - Ribbon UI 对象
 */
export declare function OnAddinLoad(ribbonUI: RibbonUI): boolean;
/**
 * Ribbon 按钮点击处理
 * @param control - 按钮控件
 */
export declare function OnAction(control: RibbonControl): boolean;
/**
 * 获取按钮图标
 * @param control - 按钮控件
 */
export declare function GetBangumiImage(control: RibbonControl): string;
export {};
//# sourceMappingURL=ribbon.d.ts.map