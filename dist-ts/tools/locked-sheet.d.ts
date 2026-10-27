/**
 * 共享工作表锁定模块
 * @module tools/lockedSheet
 * @description 主面板与富化页面共用的目标工作表锁定与跨所有已打开工作簿的自动扫描。
 *              统一读写 BGM.sheet 状态，持久化到 `bgm_locked_sheet_<page>`，
 *              删除独立于 BGM.sheet 的富化锁定状态（方案一）。
 */
import type { WpsWorkbook, WpsWorksheet } from './wps.js';
import type { CachedTarget } from './target-detect-cache.js';
/** 锁定持久化键前缀（各页独立键：`bgm_locked_sheet_<page>`） */
export declare const LOCKED_SHEET_KEY = "bgm_locked_sheet";
/**
 * 各页独立的锁定键：panel 与 enrich 曾共用一把锁互相覆盖 ——
 * 在面板锁了表，切到富化页锁另一张，回来面板的锁没了。现在各页各存各的。
 * @param page 页面标识（'panel' / 'enrich' …）
 */
export declare function lockedSheetKey(page: string): string;
export interface LockedSheetInfo {
    index: number;
    name: string;
    workbookName?: string;
}
export declare function saveLockedSheet(info: LockedSheetInfo | null, page?: string): void;
/**
 * 应用锁定状态到 `BGM.sheet`（内存状态的**唯一置位 / 清位点**）。
 *
 * §5.6 C4：主面板 `toggleSheetLock` 与富化页 `toggleEnrichWorkbookLock` 原先
 * 各写一份四字段赋值（还有 `lockEnrichWorkbookByName` 的自动锁定路径），
 * 收敛到本函数后，页面层只负责校验 / 提示 / 持久化 / 页面后处理。
 * @param info 锁定的工作表信息；`null` 表示解锁（四个字段全部清空）
 */
export declare function applyLockedSheet(info: LockedSheetInfo | null): void;
/**
 * 当前锁定是否指向该工作表。
 * @param sheetIndex 工作表索引（1-based）
 * @param workbookName 传入时还要求工作簿名一致（富化页语义）；
 *                     不传时只比较索引（主面板语义）
 */
export declare function isLockedAt(sheetIndex: number, workbookName?: string): boolean;
/**
 * 渲染锁定按钮与状态文字（主面板 / 富化页共用，§5.6 C4）。
 *
 * 两处页面的**按钮**渲染完全一致；**状态区**的显隐方式不同：
 * - `inline`（主面板）：`style.display` 显隐，锁定文案只带工作表名；
 * - `badge`（富化页）：`classList.show` 显隐，锁定文案带「工作簿 → 工作表」。
 * 逐字保留两套既有行为，不强行统一视觉。
 */
export declare function renderSheetLockUi(buttonId: string, statusId: string, statusMode?: 'inline' | 'badge'): void;
/** 清除 BGM.sheet 锁定状态（内存 + 持久化） */
export declare function clearLockedSheet(page?: string): void;
/**
 * 从 PluginStorage 恢复锁定状态到 BGM.sheet，并校验工作簿是否仍存在
 * @param page 页面标识（读该页自己的锁定键）
 * @returns 是否成功恢复
 */
export declare function restoreLockedSheet(page?: string): boolean;
/**
 * 获取当前 Application 实例中已打开的工作簿。
 *
 * WPS 边界：部分版本/窗口切换时 `Application.Workbooks` 的 Count/Item 枚举
 * 暂时不包含活动工作簿；但 `Application.ActiveWorkbook` 仍可直接访问。因此所有
 * 页面和扫描器都必须通过这个统一入口取工作簿，不能各自只遍历 Workbooks。
 *
 * 注意：这里的 Application 只代表当前 WPS 实例。若用户把文件分别打开在两个
 * 独立的 WPS 进程中，当前加载项无法跨进程枚举另一个进程的工作簿，这是 WPS
 * JS API 的边界，不应把「当前实例不可见」误报成「文件未打开」。
 */
export declare function getOpenWorkbooks(): WpsWorkbook[];
export declare function findWorkbookByName(name: string | null): WpsWorkbook | null;
export declare function findSheetInWorkbook(wbName: string, sheetName: string): WpsWorksheet | null;
/**
 * 校验识别结果缓存里的目标表是否仍然可用。
 *
 * 命中缓存后只花「找簿 + 找表 + 1 次表头矩形读」，不扫其它工作簿/工作表：
 *  1. 工作簿仍打开（按名称）；
 *  2. 工作表仍存在（索引提示 + 名称复核，重排/改名都不会解析到错表）；
 *  3. 表头仍能识别（表头行可能因插行而上移/下移，故用**新读到的行号**覆盖缓存值）。
 *
 * @returns 复核通过的识别结果（索引/表头以本次复核为准）；任一环节失败返回 `null`
 */
export declare function resolveCachedTarget(target: CachedTarget): CachedTarget | null;
/**
 * 解析当前锁定的工作簿 + 工作表引用（跨所有已打开工作簿）
 * @returns [工作簿, 工作表] 元组；未锁定或引用失效时清除锁并返回 null
 */
export declare function getLockedSheet(page?: string): [WpsWorkbook, WpsWorksheet] | null;
/** 工作表名称初筛关键词（低成本预筛，命中后再用表头+数据行校验） */
export declare const TARGET_SHEET_NAME_KEYWORDS: readonly ["bangumi", "bgm", "追踪", "剧集", "动画", "番剧", "动漫"];
/** 自动扫描命中的候选目标工作表 */
export interface TargetSheetCandidate {
    workbookName: string;
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
    headerMatchCount: number;
    dataRowCount: number;
    /** 名称是否命中关键词（true 表示强候选） */
    isNameHit: boolean;
}
/** 判断某行「前 MAX_SCAN_COLUMNS 列中是否有任一列有值」 */
export declare function isRowPopulated(worksheet: WpsWorksheet, row: number): boolean;
/** 统计表头行后前 10 行中「任意列有值」的数据行数 */
export declare function countDataRowsAfter(worksheet: WpsWorksheet, headerRow: number): number;
/**
 * 扫描所有已打开工作簿，寻找 Bangumi 追踪表目标工作表。
 *
 * 判定规则（表头 + 数据行数 + 名称关键词）：
 *  1. 表头校验：findHeaderRow 命中 ≥3 个 Bangumi 表头关键词；
 *  2. 数据行数：表头行后前 10 行中 ≥2 行有数据；
 *  3. 名称关键词：工作表名命中 bangumi/追踪/剧集/动画/番剧/动漫 等；
 *     名称命中的强候选优先；无名称命中时回退扫描全部通过表头+数据行校验的工作表。
 *
 * 排序偏好：当前活动工作簿 + 当前活动工作表 > 当前活动工作簿 > 名称关键词命中 > 扫描顺序。
 * @returns 按偏好排序的候选列表（可能为空）
 */
export declare function findBangumiTargetSheets(): TargetSheetCandidate[];
/**
 * 在指定工作簿内查找最优 Bangumi 追踪表候选。
 * 判定规则与 findBangumiTargetSheets 一致（表头 ≥3 关键词 + 数据行 ≥2），
 * 排序偏好：工作表名命中关键词的强候选优先，否则取扫描顺序首个通过校验的工作表。
 * 供自动识别模块对单个工作簿（事件时机）做实时校验。
 */
export declare function findBangumiTargetSheetInWorkbook(wb: WpsWorkbook): WpsWorksheet | null;
//# sourceMappingURL=locked-sheet.d.ts.map