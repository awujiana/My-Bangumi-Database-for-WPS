/**
 * @fileoverview 已打开工作簿的自动识别模块
 * @module sync/workbookAutoDetect
 * @description 在 WPS 当前已打开的工作簿中自动识别「新番表源工作簿」与「Bangumi 目标工作簿」。
 *
 * 识别方式参考 Bangumi 同步工具（tools/locked-sheet.ts findBangumiTargetSheets）：
 *   1. 低成本名称预筛：文件名 / 工作表名包含目标关键词；
 *   2. 表头校验：命中 ≥3 个目标表头关键字；
 *   3. 数据行校验：表头行后 ≥2 行有数据。
 *
 * 检查时机（多种，注册后统一生效）：
 *   A. 打开 WPS（加载项加载）时：initializeWorkbookAutoDetection 全量扫描 + 事件监听，结果持久化到 PluginStorage；
 *   B. 打开富化工具页面时：collectDetectedWorkbookPaths 合并持久化结果与实时扫描，由页面自动添加并识别；
 *   C. 打开新工作簿时：WorkbookOpen 事件实时记录；
 *   D. 切换活动工作簿时：WorkbookActivate 事件实时记录；
 *   E. 切换活动工作表时：SheetActivate 事件实时记录。
 */
import type { WpsWorkbook, WpsWorksheet } from '../tools/wps.js';
/** 工作簿检测器：定义一种「目标工作簿」的识别方式（名称预筛 + 表头/数据行校验） */
export interface WorkbookDetector {
    /** PluginStorage 持久化键（不同检测目标独立存储，避免相互覆盖） */
    key: string;
    /** 显示名（日志 / 提示用） */
    label: string;
    /** 低成本名称级预筛：命中才做表头/数据行完整校验；未提供则跳过预筛 */
    isNameMatch?: (wb: WpsWorkbook) => boolean;
    /** 完整校验：在指定工作簿中查找首个命中目标的工作表；未命中返回 null */
    findFirstMatchingSheet: (wb: WpsWorkbook) => WpsWorksheet | null;
}
/** 新番表文件名预筛关键词（低成本，命中后再做表头/数据行校验） */
export declare const ANIME_SOURCE_FILENAME_KEYWORDS: readonly ["新番", "番组", "xinfan"];
/** 文件名是否命中新番表关键词（纯函数，可单测） */
export declare function isAnimeSourceFilename(name: string): boolean;
/** 从文件路径提取文件名（纯函数，可单测） */
export declare function extractFileNameFromPath(filePath: string): string;
/**
 * 从工作簿名提取「yy年m月」月度标签（纯函数，可单测）。
 * 例：「2026年4月新番表 v2.13.xlsx」→「26年4月」；无月份时返回去扩展名的文件名。
 */
export declare function monthLabelFromWorkbookName(name: string): string;
/** 在指定工作簿中查找首个满足「新番表布局 + ≥2 数据行」的工作表；未命中返回 null */
export declare function findAnimeSourceSheetInWorkbook(wb: WpsWorkbook): WpsWorksheet | null;
/** 新番表检测器：文件名关键词预筛 + 表头/数据行校验 */
export declare const ANIME_SOURCE_DETECTOR: WorkbookDetector;
/** Bangumi 数据表检测器：工作表名关键词预筛 + 表头/数据行校验（参考 findBangumiTargetSheets） */
export declare const BANGUMI_TARGET_DETECTOR: WorkbookDetector;
/** 全部已注册检测器（事件与全量扫描统一遍历） */
export declare const ALL_DETECTORS: readonly WorkbookDetector[];
/**
 * 判断工作簿是否命中检测目标：名称预筛 + 表头/数据行双重校验。
 * 仅命中名称不算数，必须同时存在可识别的目标表布局，避免误判普通表格。
 */
export declare function isMatchingWorkbook(detector: WorkbookDetector, wb: WpsWorkbook): boolean;
/**
 * 扫描所有已打开工作簿，返回命中指定检测目标的工作簿列表。
 *
 * 边界处理：部分 WPS 环境下 `Application.Workbooks` 集合可能与当前活动工作簿不一致
 * （活动工作簿未出现在枚举结果中），因此额外把 ActiveWorkbook 作为兜底候选纳入扫描，
 * 避免「已打开目标工作簿却扫描不到」。
 *
 * 排序偏好（参考 findBangumiTargetSheets）：当前活动工作簿优先，其余按扫描顺序。
 */
export declare function scanMatchingWorkbooks(detector: WorkbookDetector): WpsWorkbook[];
/** 描述当前 WPS 中已打开的工作簿（诊断日志用，读取失败不影响主流程） */
export declare function describeOpenWorkbooks(): string;
/** 读取指定检测目标的自动识别记录（可能包含已关闭的工作簿，调用方需二次校验） */
export declare function loadDetectedPaths(detector: WorkbookDetector): string[];
/** 持久化指定检测目标的自动识别结果（去重） */
export declare function persistDetectedPaths(detector: WorkbookDetector, paths: readonly string[]): void;
/** 判断持久化路径对应的工作簿当前是否仍在 WPS 中打开（仅做名称比对，不读单元格） */
export declare function isWorkbookOpen(path: string): boolean;
/**
 * 合并自动识别候选（纯函数，可单测）：
 * 1. 实时扫描结果优先（已验证、活动工作簿靠前）；
 * 2. 持久化记录中「仍打开」且未被实时扫描覆盖的作为兜底（应对实时校验瞬时失败）。
 */
export declare function mergeCandidatePaths(persisted: readonly string[], openPaths: readonly string[], isStillOpen: (path: string) => boolean): string[];
/** 汇总指定检测目标当前应自动添加的工作簿路径（持久化结果 ∩ 仍打开 ∪ 实时扫描） */
export declare function collectDetectedWorkbookPaths(detector: WorkbookDetector): string[];
/**
 * 把当前实时扫描结果**并入**持久化记录（仅追加/去重，不清空历史记录）。
 *
 * 与 overwriteDetectedPathsInStorage 的区别：后者在 WPS 启动时全量覆盖，适用于「以当前事实为准」；
 * 本函数适用于页面打开等中途场景 —— 若此时 Workbooks 集合尚未就绪（例如只枚举到部分工作簿），
 * 覆盖写会把已经识别到的目标工作簿记录抹掉，导致后续页面更扫不到。
 *
 * @returns 各检测目标的合并后条数（调用方可直接用于日志，避免再单独扫一遍）
 */
export declare function mergeDetectedPathsIntoStorage(): {
    label: string;
    count: number;
}[];
/**
 * 初始化自动识别（打开 WPS 时调用，幂等）：
 * 1. 立即扫描已打开工作簿并持久化；
 * 2. 注册 WorkbookOpen / WorkbookActivate / SheetActivate 事件，实时维护识别记录。
 *    事件注册失败不影响功能：富化页面打开时仍会做实时扫描检查。
 */
export declare function initializeWorkbookAutoDetection(): void;
//# sourceMappingURL=workbook-auto-detect.d.ts.map