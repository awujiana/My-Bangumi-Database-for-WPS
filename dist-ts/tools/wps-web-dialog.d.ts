/**
 * @fileoverview WPS 原生 Web 对话框（独立于任务窗格的窗口）
 * @module tools/wpsWebDialog
 * @description 任务窗格里的浮动窗口受限于窗格视口（`position: fixed` 相对 WebView，
 *   最大宽度就是窗格宽度），做不到「浮在 WPS 表格上面」。本模块走宿主的
 *   Web 对话框接口开出真正的独立窗口：可拖出窗格、可最大化、非模态时用户仍能
 *   回到表格框选区。
 *
 * ## 两条宿主通路（能力探测，不是二选一写死）
 * 1. `Application.CreateWebDialog(url)` → WebDialog：返回句柄，可 `Visible` /
 *    `IsModal` / `Resize` / `Delete`，还能凭 `ID` 用 `GetWebDialog(id)` 查存活。
 *    **唯一支持「程序化关闭」与「关了能感知」的通路**，故优先。
 *    代价：签名里没有标题参数，窗口标题只能由网页 `<title>` 提供。
 * 2. `Application.ShowDialog(url, caption, width, height, isModal)` → 老接口，
 *    有标题与初始尺寸，但**返回值是否可用句柄因版本而异**。拿不到句柄时
 *    `close()` 返回 false（UI 需提示用户手动关窗口），`isAlive()` 也只能
 *    乐观返回 true —— 宁可「以为还开着」，也不要在窗口开着时把它判死。
 * 3. 两条都不存在 → `openWebDialog` 返回 null，调用方回落到任务窗格内浮动
 *    （`ui/components/detachable-panel.js` 的 float 模式），功能不丢。
 *
 * ## 物理像素
 * 宿主收的宽高是**物理像素**，CSS 像素要乘 `devicePixelRatio`，否则高分辨率屏上
 * 窗口只有预期的一半大（官方文档特意点过这个坑）。
 */
/** 采用的打开通路（日志与排障用） */
export type WebDialogStrategy = 'web-dialog' | 'show-dialog';
/** 开一个对话框的请求 */
export interface WebDialogRequest {
    /** 对话框要加载的页面地址（绝对或相对，见 `resolveDialogUrl`） */
    url: string;
    /** 窗口标题（仅 `ShowDialog` 通路生效；`CreateWebDialog` 走网页 `<title>`） */
    title: string;
    /** CSS 像素宽 */
    width: number;
    /** CSS 像素高 */
    height: number;
    /** 是否模态。**管理器必须 false**：用户还要回表格框选区 */
    isModal?: boolean;
}
/** 已打开对话框的句柄 */
export interface WebDialogSession {
    /** 实际采用的通路 */
    readonly strategy: WebDialogStrategy;
    /** 宿主给的实例 id；拿不到句柄时为 null */
    readonly id: number | null;
    /**
     * 是否仍然开着
     *
     * 拿不到句柄时**乐观返回 true**：窗口确实开着（没人关过它），
     * 判成 false 会让调用方在窗口还在时就把占位块收回，比「多留一会儿」糟。
     */
    readonly isAlive: () => boolean;
    /** 关闭窗口；宿主不支持程序化关闭时返回 false（调用方应提示手动关闭） */
    readonly close: () => boolean;
    /** 改窗口尺寸（物理像素由内部换算）；宿主不支持时返回 false */
    readonly resize: (width: number, height: number) => boolean;
}
/**
 * CSS 像素 → 物理像素
 *
 * @param width CSS 像素宽
 * @param height CSS 像素高
 * @param devicePixelRatio 设备像素比；非法值（0 / NaN / Infinity）按 1 处理
 */
export declare function dialogPhysicalSize(width: number, height: number, devicePixelRatio?: number): {
    width: number;
    height: number;
};
/**
 * 把相对页名解析成绝对地址
 *
 * 任务窗格的地址在调试态是 `http://127.0.0.1:3889/ui/xxx.html`、发布态是本地资源
 * 路径，写死任一种都会在另一种下 404。相对当前页面解析两种都对。
 * 解析失败（base 不是合法 URL）时原样返回入参，交给宿主处理。
 */
export declare function resolveDialogUrl(relative: string, baseUrl: string): string;
/**
 * 开一个 WPS 原生 Web 对话框
 *
 * @returns 句柄；宿主不支持时返回 **null**，调用方必须回落到任务窗格内浮动
 */
export declare function openWebDialog(request: WebDialogRequest): WebDialogSession | null;
/**
 * 宿主是否支持原生对话框
 *
 * 用于在打开**之前**决定「⧉」按钮的文案与行为，避免点了才被告知不支持。
 */
export declare function isWebDialogSupported(): boolean;
//# sourceMappingURL=wps-web-dialog.d.ts.map