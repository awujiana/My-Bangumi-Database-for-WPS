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
import { LOG_LEVELS, bgmLog, showToast } from '../../index.js';
import { TEMPLATE_FALLBACK, fetchLatestTemplate, formatTemplateMeta, } from '../../tools/template-release.js';
import { copyTextToClipboard } from './clipboard.js';
/** 会话内缓存的模板信息（查不到时保持兜底值） */
let latest = TEMPLATE_FALLBACK;
/** 是否已经查过（只查一次，避免反复开关面板打接口） */
let hasLoaded = false;
/** 元素 id（与 ui/panel.html 保持一致） */
const META_ELEMENT_ID = 'templateFileMeta';
/** 取元素（找不到返回 null：设置页等没有这个区块的页面静默跳过） */
function metaElement() {
    const found = document.getElementById(META_ELEMENT_ID);
    return found instanceof HTMLElement ? found : null;
}
/** 把当前模板信息写进说明行 */
function renderMeta() {
    const meta = metaElement();
    if (!meta)
        return;
    // textContent：资产名来自接口，绝不拼 HTML
    meta.textContent = formatTemplateMeta(latest);
}
/**
 * 拉取并展示最新模板信息
 *
 * 元素不存在时直接返回（面板初始化会为每个页面跑一遍 handlers，
 * 别在非面板页白打一次网络请求）。
 */
export async function loadTemplateFileInfo() {
    if (hasLoaded || metaElement() === null)
        return;
    hasLoaded = true;
    try {
        latest = await fetchLatestTemplate();
    }
    catch {
        // fetchLatestTemplate 内部已兜底，这里只防异常逃逸（宿主 fetch 可能整条不通）
    }
    renderMeta();
    bgmLog(LOG_LEVELS.INFO, `[templateFile] 模板信息: resolved=${String(latest.resolved)}, tag=${latest.tag}, asset=${latest.assetName}`);
}
/**
 * 打开下载地址：交给宿主 WebView 导航（CEF 的下载器接管时不走跨域）
 *
 * 不用 fetch 下载：`objects.githubusercontent.com` 不给跨域头（详见
 * `tools/template-release.ts` 文件头说明）。
 */
export function downloadTemplateFile() {
    bgmLog(LOG_LEVELS.INFO, `[templateFile] 打开下载地址: ${latest.downloadUrl}`);
    const anchor = document.createElement('a');
    anchor.href = latest.downloadUrl;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    showToast('已打开下载链接；若没自动下载，用「复制链接」粘到浏览器', 'info');
}
/** 复制下载链接（宿主拦截导航时的保底通路） */
export function copyTemplateLink() {
    const isOk = copyTextToClipboard(latest.downloadUrl);
    bgmLog(LOG_LEVELS.INFO, `[templateFile] 复制下载链接: ${String(isOk)}`);
    showToast(isOk ? '下载链接已复制' : '复制失败，请手动选择复制', isOk ? 'success' : 'error');
}
/** 打开 Release 页面（看历史版本 / 手动挑文件） */
export function openTemplateReleasePage() {
    bgmLog(LOG_LEVELS.INFO, `[templateFile] 打开 Release 页: ${latest.pageUrl}`);
    window.open(latest.pageUrl, '_blank');
}
/** 测试用：复位会话缓存 */
export function resetTemplateFileForTest() {
    latest = TEMPLATE_FALLBACK;
    hasLoaded = false;
}
