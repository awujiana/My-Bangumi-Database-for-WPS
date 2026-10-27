/**
 * 跨页数据上下文共享
 * @module tools/dataContext
 * @description 页面获取到的工作簿 / 工作表 / 列 / 行信息写入 PluginStorage（键
 *   `bgm_data_context`），其它页面**进入时**读一次并重放成通知条。
 *
 * 为什么是「进入时读一次」而不是实时推送 / 轮询：周期性同步 COM 是 2026-10-21
 * 定位的卡顿根因（宿主初始化窗口内 / 频繁跨进程读取都会卡），这里只在两个
 * 天然便宜的时机各碰一次存储 —— 写入方在用户点击的按需路径上，读取方在页面
 * 初始化已读 PluginStorage 的同一阶段。
 */
import type { WpsWorksheet } from './wps.js';
export interface DataContextSnapshot {
    workbook: string;
    sheet: string;
    /** 表头列名（按列序） */
    columns: string[];
    /** 数据行数（不含表头；拿不到时 0） */
    rowCount: number;
    /** 获取数据的页面标识（panel / enrich / …） */
    fromPage: string;
    /** 写入时间（Date.now()） */
    savedAt: number;
}
/** 写入最新数据上下文（用户点击获取数据的按需路径上调用，勿在自动轮询里调） */
export declare function saveDataContext(snap: Omit<DataContextSnapshot, 'savedAt'>): void;
/** 读取最新数据上下文；没有或解析失败返回 null */
export declare function readDataContext(): DataContextSnapshot | null;
/**
 * 各页的「套用」实现：把快照落到本页的目标表选择上，返回是否成功。
 *
 * 为什么用注册表而不是在 tools 层直接写各页的键：
 *   - tools 层反向 import panel/* 会成环（check:cycles 会红）；
 *   - 各页键格式不同（panel/enrich 是 locked-sheet 的 index 锁，
 *     条件格式/高亮是 `工作簿::工作表` 配置串），落到页内最自然；
 *   - 套用往往还要顺带刷新预览（读表），那更是页内的事。
 */
type TargetSheetApplier = (snapshot: DataContextSnapshot) => boolean;
/** 注册本页的「套用」实现（init 时调用；同一页重复注册以最后一次为准） */
export declare function registerTargetSheetApplier(page: string, applier: TargetSheetApplier): void;
/** 本页是否支持「一键套用」（通知条据此决定显不显示按钮） */
export declare function hasTargetSheetApplier(page: string): boolean;
/**
 * 执行「套用到本页」。没有 applier 或执行抛错都返回 false（调用方只改按钮文案，
 * 不往上抛 —— 套用是便利功能，不该把页面搞崩）。
 */
export declare function applyDataContextToPage(page: string): boolean;
/** 仅供测试：清空注册表（避免跨文件残留影响其它用例） */
export declare function resetTargetSheetAppliers(): void;
/**
 * 页面进入时重放：把其它页面获取的数据上下文显示为通知条（本页自己写的不重复展示）。
 *
 * 挂到 `<main class="main">` 顶部，一次性读存储，不做任何轮询；
 * 用户点 ✕ 即消失（本次进入期间不再出现）。
 *
 * 通知条带「套用到本页」按钮（仅当该页注册过 applier 时显示）：
 * 用户在高亮页选了表 → 跑到主面板 → 看到「高亮页已获取 X/Y」→ 点一下就
 * 把主面板也切到 X/Y，不用再把两级下拉重新点一遍。
 */
export declare function mountDataContextNotice(page: string): void;
/**
 * 从工作表提取快照（列名走 getColumnMap 的表头读，行数走 getLastRow）。
 * 供各页在「用户点击获取数据」的路径上统一取数，避免每页自己拼。
 *
 * 工作簿名走 `worksheet.Parent.Name`（取不到时退 `ActiveWorkbook.Name`）——
 * 曾经两处都填 `worksheet.Name`，通知条于是显示成「动画 / 动画」，
 * 「一键套用」也无从知道该切到哪个工作簿。
 */
export declare function snapshotFromWorksheet(worksheet: WpsWorksheet, headerRow: number, fromPage: string): Omit<DataContextSnapshot, 'savedAt'>;
export {};
//# sourceMappingURL=data-context.d.ts.map