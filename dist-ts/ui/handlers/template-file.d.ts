/**
 * @fileoverview 「帮助与格式 → 模板文件」三个入口的接线层
 * @module ui/handlers/template-file
 * @description
 *   面板打开时拉一次数据仓库 Latest Release，把「版本 · 文件名 · 大小」显示在
 *   按钮上方；三个按钮分别是下载（交给宿主导航）/ 复制链接 / 打开 Release 页。
 *
 *   为什么一定要有「复制链接」：WPS 任务窗格对外部导航的处理各版本不一致
 *   （CEF 有的接管下载、有的直接拦掉），复制出来的链接是唯一永远可用的通路。
 *
 *   只查一次（会话内缓存）：接口未鉴权限流 60 次/小时/IP，反复开关面板没必要
 *   反复问；查不到也只是显示兜底文案，不影响任何功能。
 */
/**
 * 拉取并展示最新模板信息
 *
 * 元素不存在时直接返回（面板初始化会为每个页面跑一遍 handlers，
 * 别在非面板页白打一次网络请求）。
 */
export declare function loadTemplateFileInfo(): Promise<void>;
/**
 * 打开下载地址：交给宿主 WebView 导航（CEF 的下载器接管时不走跨域）
 *
 * 不用 fetch 下载：`objects.githubusercontent.com` 不给跨域头（详见
 * `tools/template-release.ts` 文件头说明）。
 */
export declare function downloadTemplateFile(): void;
/** 复制下载链接（宿主拦截导航时的保底通路） */
export declare function copyTemplateLink(): void;
/** 打开 Release 页面（看历史版本 / 手动挑文件） */
export declare function openTemplateReleasePage(): void;
/** 测试用：复位会话缓存 */
export declare function resetTemplateFileForTest(): void;
//# sourceMappingURL=template-file.d.ts.map