/**
 * @fileoverview 番剧高亮页 UI 控制器
 * @module panel/highlightPage
 * @description 「按季度起点高亮最新番剧」的独立页面：日期源自选、自动/手动季目标、
 *   高亮列多选（默认值缓存）、面板内实时预览（不动表）、应用/清除。
 *
 * 三个设计约束：
 * 1. **预览不动表**：只有点「应用高亮」才写工作表（用户选定的 A 口径）；
 * 2. **地址串长度不是瓶颈**：2026-10-20 真机探针实测单次 `Range` 可接受约 524287 字符
 *    （VBA 那个 255 是 Excel 2003 时代的说法）。仍按 8000 字符 greedy 装车 + 连续行合并，
 *    且块失败会对半拆分重试——不赌平台上限，也不像宏那样整批静默失败；
 * 3. **清除只抹本插件加的绿**：上次应用的地址记录在 PluginStorage，清除精确重放，
 *    不整列 ColorIndex 乱扫（那会抹掉用户手工填的色）。
 *
 * 序列号列刻意不进高亮列列表：它的绿色是「已上传」判定色（isUploadedByColor），
 * 高亮它会让「看起来传过」与「本季新番」混淆。
 */
import type { ComPhase } from '../tools/com-ready.js';
/**
 * 高亮页初始化分片（仅轻量 COM）。
 *
 * 关键原则（2026-10-21 真机 bisect）：新窗格打开时若在宿主「attach → COM 桥建好」
 * 的窗口里自动读表，会把 WPS 主线程卡 70 秒（宿主与渲染进程互锁死等，直到 JSAPI
 * 桥看门狗超时）。所以初始化**只做轻量 COM**（配置 + 枚举表名 + 主题），数据读取
 * 100% 交给用户点「加载并预览」——那时宿主早已就绪，稀疏同步 COM 只有几百毫秒，
 * 不再撞窗口、也不轮询。
 */
export declare function createHighlightPagePhases(): ComPhase[];
/** 一次性跑完所有分片并加载（供测试 / 非窗格场景；窗格页面请走 runComPhases） */
export declare function initializeHighlightPage(): void;
//# sourceMappingURL=highlight-page.d.ts.map