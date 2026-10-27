/**
 * @fileoverview 功能模块折叠 / 隐藏（按页面持久化 + 跨页同步）
 * @module tools/module-state
 * @description 让每个功能模块右上角出现折叠按钮，并允许在设置页把模块整体隐藏。
 *
 * 设计要点：
 *   1. **两种状态互相独立**：
 *      - 折叠（collapsed）：模块标题保留、内容收起，用户随时可点开；
 *      - 隐藏（hidden）：模块在主区与侧栏锚点中彻底消失，只能在设置页恢复。
 *   2. **按页面分别记录**：`sec-preview` 在 panel / enrich / clean 三页都存在，
 *      折叠 panel 的不影响 enrich —— 与排序配置（`nav-order`）的按页存储口径一致。
 *   3. **都持久化进 PluginStorage**（`bgm_module_collapsed` / `bgm_module_hidden`），
 *      即用户说的「计入缓存配置」：刷新 / 重开任务窗格后仍在。
 *   4. **自愈**：存储里已下线的模块 id 被丢弃，无需迁移逻辑（与 nav-order 同策略）。
 *   5. **跨页同步只能轮询**（WPS 各任务窗格是独立 WebView，没有推送通道），
 *      策略与 `nav-order` 一致：空闲 2s，命中变化后加密到 300ms 并保持 5s。
 *
 * 6. **折叠按钮原生写在四页 HTML 的模块 `<h3>` 里**（2026-09-13 由「运行时注入」改回）：
 *      按钮与 `PAGE_MODULES` 的一一对应由 `scripts/check-nav-order.mjs` 门禁强制；
 *      本模块只负责 `bindCollapseToggles()` 挂点击委托 + 套用状态。
 *      改回原生的理由：HTML 自描述、不依赖 JS 执行时机、可被静态检查；
 *      代价是 27 处按钮成了 `PAGE_MODULES` 之外的第二份清单（漏一个只表现为「少一个按钮」，
 *      不报错），所以必须由门禁兜住 —— 与本项目其它平行清单同一个套路。
 *   7. **全隐藏兜底**：某页模块被全部隐藏时，渲染常驻占位块（含「打开设置」按钮）并弹一次
 *      toast。**不禁止全隐藏**（用户可能就是想清屏），但要保证永远有路可回 ——
 *      占位块必须常驻，因为 toast 3 秒就消失了，而用户回来看到的是一片空白。
 *
 * 新增页面时必须同步更新 `nav-order.ts` 的 `PAGE_MODULES`、页面 HTML 里的折叠按钮，并在该页
 * 入口调用 `startModuleStateSync('<page>')` —— 以上均由 `scripts/check-nav-order.mjs` 强制校验。
 */
/**
 * 「功能导航（侧栏）」伪模块 id
 *
 * 侧栏 `.nav` 不是主区 `<section>`，因此不能进 `PAGE_MODULES`（那份注册表与页面
 * HTML 的 `<section id>` 严格一一对应，硬塞会被 `check-nav-order.mjs` 判成结构缺失）。
 * 但用户希望在设置页用同一个眼睛按钮把整条功能导航也藏掉，于是给它一个保留 id，
 * 混在同一个 `bgm_module_hidden` 映射里按页存储 —— 读写两侧都必须放行，
 * 否则 `setIds` 的「只接受注册表 id」过滤会把它静默丢掉。
 */
export declare const NAV_MODULE_ID = "__nav__";
/** 当前是否处于专注模式 */
export declare function isSoloMode(): boolean;
/** 当前专注的模块 id（未进入时为 null） */
export declare function currentSoloModule(): string | null;
/**
 * 进入专注模式：本页只显示 `moduleId` 一个模块。
 *
 * 目标模块同时被强制展开 —— 收起状态进专注模式只会看到一条标题栏，
 * 用户会以为功能坏了。
 */
export declare function enterSoloMode(page: string, moduleId: string): void;
/** 退出专注模式，恢复各模块本来的隐藏 / 折叠状态 */
export declare function exitSoloMode(): void;
/**
 * 在专注模式里上下切换模块。
 *
 * 跳过「不可参与」的模块（设置页排序编辑器自身）与当前不存在的模块 ——
 * 注册表里有、DOM 里没有的模块（个别页面按需渲染）跳过去，
 * 否则切到它屏幕上什么都不显示，像是切换坏了。
 */
export declare function stepSoloMode(delta: number): void;
/**
 * 该模块是否允许被隐藏。
 * 编辑器模块本身不可隐藏 —— 隐藏后就没有入口能把它（和其它模块）恢复了。
 */
export declare function canHideModule(page: string, moduleId: string): boolean;
/** 读取被折叠的模块 id */
export declare function getCollapsedModules(page: string, isSilent?: boolean): string[];
/** 读取被隐藏的模块 id（受保护的模块即使配置里写了也不算隐藏） */
export declare function getHiddenModules(page: string, isSilent?: boolean): string[];
/** 直接写入折叠集合（供「全部展开 / 全部折叠」类批量操作使用） */
export declare function setCollapsedModules(page: string, ids: readonly string[]): boolean;
/** 直接写入隐藏集合（受保护的模块会被剔除，存储里不留脏数据） */
export declare function setHiddenModules(page: string, ids: readonly string[]): boolean;
/** 切换单个模块的折叠状态；不可隐藏模块的隐藏请求会被静默忽略 */
export declare function toggleModuleCollapsed(page: string, moduleId: string): void;
/**
 * 切换单个模块的隐藏状态。
 *
 * 不可隐藏的模块（设置页的排序编辑器自身）在 `filterHideable` 里被剔除 ——
 * 渲染层把按钮置灰只是提示，真出事的是有人绕过 disabled 触发点击；而配置还有
 * 导入 / 旧版本遗留这些不经过本函数的来源。可恢复性属于不变量，必须落在数据层。
 */
export declare function toggleModuleHidden(page: string, moduleId: string): void;
/**
 * 把折叠 / 隐藏状态套用到当前页面的 DOM。
 *
 * 四处一起处理，否则会出现「主区没了但侧栏锚点还在」这类半生效状态：
 *  1. 模块根元素：隐藏用 `hidden` 属性（配 CSS `!important` 覆盖布局类），
 *     折叠用类名 `is-module-collapsed`（CSS 隐藏除标题外的子元素，标题必须留着才能再点开）；
 *  2. 侧栏锚点：模块隐藏时一并隐藏，避免点了跳转到一个不存在的区块；
 *  3. 折叠按钮（HTML 里原生的那些）：`aria-expanded` / `aria-controls` 与图标跟随状态更新；
 *  4. 全隐藏兜底：一个可见模块都不剩时挂常驻占位块（见 `syncEmptyHint`）。
 */
export declare function applyModuleState(page?: string): void;
/**
 * 挂上折叠按钮的点击委托（**不再创建按钮**）。
 *
 * 按钮原生写在四页 HTML 的模块 `<h3>` 里（见文件头说明），本函数只挂一次 document 级委托。
 * 幂等：重复调用不会重复绑定 —— 绑两次的结果是一次点击切换两次，等于没反应。
 */
export declare function bindCollapseToggles(): void;
/** 两个状态键的合并快照，用于判断「配置是否变了」 */
/**
 * 启动本页的模块状态同步：挂折叠委托 → 套用一次状态 → 轮询其它页的改动。
 *
 * **为什么是轮询**：见 `nav-order.ts` 的说明 —— WPS 各任务窗格是独立 WebView，
 * 没有跨窗格广播通道，PluginStorage 只能读、不通知。
 *
 * @param page - 当前页面键
 * @returns 清理函数（清除定时器）
 */
export declare function startModuleStateSync(page: string): () => void;
//# sourceMappingURL=module-state.d.ts.map