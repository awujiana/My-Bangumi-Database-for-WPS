/**
 * 目标工作表「识别结果缓存」。
 *
 * @module tools/target-detect-cache
 * @description
 * 面板 / 富化页在打开时都会调用 `findBangumiTargetSheets()`：它会遍历**每个已打开
 * 工作簿的每一张工作表**（读表头、数数据行、比名称关键词）。工作簿一多，首帧就被
 * 跨进程 COM 扫描拖住——这是用户抱怨「卡」的主要来源。
 *
 * 本模块把上一次的识别结果连同「工作簿集合签名」持久化：签名未变时直接命中，
 * 由调用方再做**一次**存在性 + 表头复核（约 3–5 次 COM），而不是全簿全表扫描。
 *
 * 签名口径：`Count|各簿Name|活动簿名`（沿用富化页既有的 `readWorkbookSignature`）。
 *  - 打开 / 关闭 / 重命名工作簿、切换活动工作簿 → 签名变化 → 回退全扫并回写；
 *  - 同一组工作簿、同一个活动簿重开面板 → 命中缓存。
 *
 * 之所以包含活动簿：面板与富化页的候选排序都把「当前活动工作簿」排最前，
 * 只有签名含活动簿，才能保证「命中缓存」≡「此刻全扫也会得到同一答案」。
 *
 * 设计约束：
 *  - **不改 UX**：命中时仍然自动定位到追踪表，用户无感知；
 *  - **不产生死角**：手动刷新按钮传 `force` 跳过缓存并回写；
 *  - **存储失败不影响主流程**：PluginStorage 不可用 / 内容损坏时一律视为未命中。
 */
/** 缓存用途：面板与富化页各存一份（语义不同，互不覆盖） */
export type TargetCachePurpose = 'panel' | 'enrich';
/** 识别结果（可持久化的最小集合） */
export interface CachedTarget {
    workbookName: string;
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
    /** 表头关键词命中数（面板用于展示；命中缓存时原样返回） */
    matchCount?: number;
    /** 列数（同上） */
    columnCount?: number;
}
/** 缓存键（PluginStorage） */
export declare const TARGET_CACHE_KEY = "bgm_target_detect_cache";
/** 最小存储形状（WpsPluginStorage 结构兼容；测试可注入假实现） */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/** 读签名所需的最小宿主形状 */
export interface WorkbookSetHost {
    Workbooks?: {
        Count?: number;
        Item?: (index: number) => {
            Name?: string;
        } | null | undefined;
    } | undefined;
    ActiveWorkbook?: {
        Name?: string;
    } | null | undefined;
}
export interface SignatureOptions {
    /** 是否把活动工作簿名并入签名（富化页的工作簿变化监听需要；缓存不需要） */
    includeActive?: boolean;
}
/**
 * 读工作簿集合签名：只读 `Count` 与各簿 `Name`，不碰工作表内容。
 * 成本 ≈ 1 + N 次 COM（N = 打开的工作簿数），比全量识别低一个数量级。
 *
 * 默认**包含活动工作簿名**：面板 / 富化页的候选排序都把「当前活动工作簿」排在最前，
 * 若签名不含活动簿，用户切到另一个含追踪表的工作簿后重开面板会命中旧结果、
 * 与原有排序行为不一致。包含它可保证「命中缓存」≡「此刻全扫也会得到同一答案」。
 *
 * @param app 宿主
 * @param options `includeActive: false` 时只按工作簿集合判等
 */
export declare function readWorkbookSignature(app: WorkbookSetHost | null | undefined, options?: SignatureOptions): string;
/**
 * 读缓存：签名一致且字段完整才返回，否则 `null`（调用方回退全扫）。
 * @param purpose 用途
 * @param signature 当前工作簿集合签名
 * @param storage 可选存储（测试注入）
 */
export declare function loadTargetCache(purpose: TargetCachePurpose, signature: string, storage?: StorageLike | null): CachedTarget | null;
/**
 * 写回缓存（覆盖同一用途的旧条目）。
 * @param purpose 用途
 * @param signature 本次识别时的工作簿集合签名
 * @param target 识别结果
 * @param storage 可选存储（测试注入）
 */
export declare function saveTargetCache(purpose: TargetCachePurpose, signature: string, target: CachedTarget, storage?: StorageLike | null): void;
/**
 * 清除缓存。
 * @param purpose 省略时清空全部用途
 * @param storage 可选存储（测试注入）
 */
export declare function clearTargetCache(purpose?: TargetCachePurpose, storage?: StorageLike | null): void;
//# sourceMappingURL=target-detect-cache.d.ts.map