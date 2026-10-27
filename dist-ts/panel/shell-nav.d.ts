/**
 * @fileoverview 三页面（panel / settings / enrich）共享的外壳导航逻辑
 * @module panel/shellNav
 * @description 统一处理「顶栏 + 侧栏导航」外壳的两个运行时行为：
 *
 *   1. updateStickyOffsets —— 吸顶偏移测量：
 *      将顶栏实际高度写入 --topbar-h、窄态（≤880px）横向导航块高度写入 --nav-h，
 *      供 CSS 控制 sidebar 吸顶位置与锚点 scroll-padding 偏移补偿。
 *      此前只有 panel-bootstrap 调用，settings / enrich 页未设置导致：
 *      - 侧栏吸顶位置落在顶栏之下被遮挡（导航按钮显示不全）
 *      - 锚点跳转时目标区块标题被顶栏盖住（视觉错位）
 *
 *   2. initializeScrollspy —— 滚动高亮（scrollspy）：
 *      依当前滚动位置反推主导区块并高亮侧栏对应导航项；
 *      点击导航项立即高亮（不等平滑滚动完成），滚动 / 缩放 / 加载后重算。
 */
/** 测量吸顶元素高度并写入 CSS 变量（load / resize 时需重跑） */
export declare function updateStickyOffsets(): void;
/**
 * 初始化滚动高亮：主区内 id 以 sec- 开头的区块 ↔ 侧栏导航项
 * 无导航或无区块时静默跳过（如测试环境 / 无侧栏页面）。
 *
 * 高亮反馈：导航容器内注入绝对定位的滑动胶囊（.nav-indicator），
 * 当前区块变化时胶囊平滑滑动到对应导航项，竖排（桌面）与
 * 横排换行（窄态）均通过 offsetLeft/offsetTop 相对定位统一计算。
 */
export declare function initializeScrollspy(): void;
/**
 * 外壳导航统一初始化：吸顶偏移测量（含 load/resize 重跑）+ 滚动高亮。
 * 三个面板的启动入口（panel / settings / enrich bootstrap）都应调用一次。
 */
export declare function initializeShellNav(): void;
/**
 * 主动触发一次「当前可见区块 + 导航高亮」重算。
 * 供各面板在动态加载/重布局（识别表头、渲染预览、切换工作簿等）后调用，
 * 避免高亮停留在陈旧状态。
 */
export declare function recomputeScrollspy(): void;
//# sourceMappingURL=shell-nav.d.ts.map