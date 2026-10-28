/**
 * @fileoverview 番剧高亮「实时预览」的详情渲染（表格 / 卡片两种视图）
 * @module panel/highlight-preview-render
 *
 * 为什么单独成模块：预览详情是**纯字符串拼装**（行号 / 名称 / 匹配值 → HTML），
 * 而高亮页本身被 COM 依赖缠住（`ts/panel/highlight-page.ts` 要 mock 十几个模块
 * 才能在 jsdom 里跑）。把拼装抽出来，就能直接对「转义、上限、视图切换」写单测，
 * 页面只负责取数与写 DOM。
 *
 * 两种视图是同一份数据的不同呈现，**不是两套取数**：
 * - `table`：行号 / 名称 / 匹配值三列表格，窄窗格里一屏能看十几行；
 * - `card`：一行一张卡片，名称与匹配值分行显示，长名称不会被列宽截断。
 *
 * 上限 {@link PREVIEW_DETAIL_LIMIT} 是**渲染上限**，不是命中上限：命中可能上千行
 * （一整季的番剧），全量铺进 DOM 会让预览区卡住；超出部分只报数，不静默丢。
 */
/** 预览视图 */
export type PreviewView = 'table' | 'card';
/** 一条命中行（预览详情的最小数据单元） */
export interface PreviewRowDetail {
    /** 工作表行号（1 基） */
    row: number;
    /** 名称列的值（可能为空串：表里没填名称） */
    name: string;
    /** 日期源列的值（参与季度匹配的原始文本） */
    value: string;
}
/**
 * 详情区最多渲染多少行
 *
 * 50 行 × 3 列 ≈ 150 个单元格，任何窗格宽度下滚动都不卡；再多的行用户也不会
 * 靠预览看，而是去表里看 —— 预览的职责是「确认口径对不对」。
 */
export declare const PREVIEW_DETAIL_LIMIT = 50;
/** 把存储里读到的任意值归一成视图名（坏值一律当表格） */
export declare function normalizePreviewView(value: string): PreviewView;
/**
 * 表格视图
 *
 * 用真 `<table>` 而不是 CSS Grid：预览表的列固定三列、行数有上限，
 * 表格语义（th/td）对读屏与复制都更友好，也不需要列宽拖拽。
 */
export declare function buildPreviewTableHtml(items: readonly PreviewRowDetail[]): string;
/** 卡片视图（一行一张卡：行号徽标 + 名称 + 匹配值） */
export declare function buildPreviewCardsHtml(items: readonly PreviewRowDetail[]): string;
/**
 * 按视图拼详情 HTML
 *
 * @param items 命中行（已带名称与匹配值）
 * @param view 视图；坏值当表格（{@link normalizePreviewView}）
 * @returns 空数组时返回空串 —— 调用方据此清空容器（无命中时摘要行已说明「命中 0 行」，
 *   再渲染一个空表格只会多一层噪音）
 */
export declare function buildPreviewDetailHtml(items: readonly PreviewRowDetail[], view: PreviewView): string;
//# sourceMappingURL=highlight-preview-render.d.ts.map