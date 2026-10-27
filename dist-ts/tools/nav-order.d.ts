/**
 * @fileoverview 功能模块排序（跨页同步）
 * @module tools/navOrder
 * @description 让用户在设置页调整 panel / enrich / clean / settings 四个页面的
 *              「侧栏导航项 + 主区模块」显示顺序。
 *
 * 设计要点：
 *   1. 顺序持久化在 PluginStorage 的 `bgm_nav_order`（JSON 对象，形如
 *      `{ "panel": ["sec-command", ...] }`）；未设置的页面回落到注册表默认顺序。
 *   2. 自愈：读取时过滤掉存储中已不存在的模块 id，并把注册表里新增但存储中缺失的
 *      模块追加到末尾 —— 因此新增/删除模块无需写迁移逻辑，旧配置也不会失效。
 *   3. 跨页同步分两条路径：
 *      - **本页（编辑器所在页）**：改动后由 `notifyNavOrderChanged(page)` 同步重排，
 *        零延迟 —— 用户点完 ↑↓ 立刻看到结果；
 *      - **其它页**：各页入口调用 `startNavOrderSync()`，各自轮询 PluginStorage
 *        （WPS 各任务窗格是独立 WebView，postMessage 无法跨窗格广播，没有推送通道）。
 *        轮询间隔自适应：空闲 2s，命中变化后一段时间内加密到 300ms，让连续调整跟手。
 *
 * 新增页面时必须同步更新：`PAGE_MODULES` / `PAGE_LABELS` / `ORDERABLE_PAGES`，
 * 并在该页入口加上 `startNavOrderSync('<page>')` 与 `startNavModeSync()`。
 * 以上一致性由 `scripts/check-nav-order.mjs` 门禁强制校验。
 */
/** 单个可排序模块的定义 */
export interface NavModule {
    /** 模块根元素 id（同时是导航锚点 `#id`） */
    id: string;
    /** 展示名称（导航文案） */
    label: string;
    /** 导航图标（emoji） */
    icon: string;
}
/** 页面键 → 该页可排序模块的默认顺序 */
export declare const PAGE_MODULES: Readonly<Record<string, readonly NavModule[]>>;
/** 页面键 → 页面中文名（供设置页展示） */
export declare const PAGE_LABELS: Readonly<Record<string, string>>;
/** 设置页中可配置排序的页面键（顺序即展示顺序） */
export declare const ORDERABLE_PAGES: readonly string[];
/**
 * 读取指定页面的模块顺序。
 * 结果始终包含该页注册表中的**全部**模块 id：存储里缺失的按注册表顺序补到末尾，
 * 存储里多余的（已下线模块）被丢弃。
 * @param page - 页面键（panel / enrich / clean）
 * @param isSilent - 静默模式，不打印日志（轮询用）
 */
export declare function getNavOrder(page: string, isSilent?: boolean): string[];
/**
 * 写入指定页面的模块顺序。
 * 只接受该页注册表中的已知 id，未出现的模块按注册表顺序补到末尾，
 * 保证写入的数组永远是「完整且合法」的。
 * @param page - 页面键
 * @param order - 期望顺序
 */
export declare function setNavOrder(page: string, order: readonly string[]): boolean;
/** 把指定页面恢复为注册表默认顺序（删除该页面的存储项） */
export declare function resetNavOrder(page: string): boolean;
/**
 * 把模块移动到目标下标（供拖拽使用）。
 * @param page - 页面键
 * @param moduleId - 被移动的模块 id
 * @param targetIndex - 目标下标（会被夹取到合法范围）
 */
export declare function moveModuleTo(page: string, moduleId: string, targetIndex: number): boolean;
/**
 * 把模块上移/下移若干位（供 ↑↓ 按钮使用）。
 * @param page - 页面键
 * @param moduleId - 被移动的模块 id
 * @param offset - 位移（-1 上移，+1 下移）
 */
export declare function moveModuleBy(page: string, moduleId: string, offset: number): boolean;
/**
 * 按当前配置就地重排页面的「侧栏导航项」与「主区模块」。
 *
 * 之所以同时重排两处：侧栏锚点顺序与主区实际顺序必须一致，
 * 否则 scrollspy 的「从上到下第一个完整可见标题」判定会与视觉顺序错位。
 *
 * 不存在的模块 id 会被跳过（页面结构差异，如 enrich 无 sec-command），
 * 主区中不属于排序表的子元素统一追加到末尾，避免被挤到中间破坏布局。
 *
 * @param page - 页面键；缺省时按 `document.body.dataset.page` 推断
 */
export declare function applyNavOrder(page?: string): void;
/**
 * 本页排序已变更：立即就地重排，无需等待轮询。
 *
 * 供设置页的模块排序编辑器在 `setNavOrder` / `resetNavOrder` / `moveModule*`
 * 成功后调用 —— 用户期望「点完 ↑↓ 立刻看到结果」，而跨页轮询最快也要一个间隔。
 * 本页与编辑器处于同一 WebView，可以直接同步调用。
 *
 * @param page - 发生变化的页面键
 */
export declare function notifyNavOrderChanged(page: string): void;
export declare function startNavOrderSync(page: string): () => void;
//# sourceMappingURL=nav-order.d.ts.map