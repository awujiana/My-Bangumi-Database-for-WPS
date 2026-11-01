/**
 * 页面标识归一（历史别名兼容）
 * @module tools/pageKey
 * @description 2.4.0 把页面标识 `panel` 改名为 `sync-panel` —— 原名字看不出
 *              这是「同步面板」，与 enrich / clean / highlight 等页面并列时尤其含糊。
 *
 *              但已发布的 2.3.0 用旧标识写过 PluginStorage 与配置：
 *              `bgm_locked_sheet_panel`、`pane_alive_panel`、`bgm_nav_order` 的
 *              `{"panel": […]}`、`bgm_module_collapsed` / `bgm_module_hidden` 同理。
 *              直接改名会让升级用户丢掉「锁定的工作表 / 侧栏顺序 / 折叠状态」，
 *              所以读存储时把旧标识映射到新标识，写回去时自然落到新键上。
 */
/**
 * 把历史页面标识归一到当前标识。
 *
 * 用于拼 PluginStorage 键、查注册表 —— 幂等，新标识原样返回。
 */
export declare function normalizePageKey(page: string): string;
/**
 * 该页面的历史标识列表（不含当前标识）。
 *
 * 读存储时按「当前键 → 历史键」依次回退：新键有值就用新键，没有才去翻旧键。
 */
export declare function legacyPageKeys(page: string): string[];
/**
 * 给 `{ 页面: … }` 形态的存储映射迁移别名键。
 *
 * 就地修改传入对象并返回它（调用方刚 JSON.parse 出来的临时对象，不会污染外部状态）。
 * 两条规则：
 *   - 只在目标键**不存在**时才用历史值填 —— 否则会把升级后新写入的状态覆盖回旧的；
 *   - 迁完**删掉历史键** —— 否则「重置排序 / 清空折叠状态」这类靠 `delete map[page]`
 *     实现的写操作会失效：删了新键，下次读又把它从旧键补回来。
 */
export declare function applyPageKeyAliases(map: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=page-key.d.ts.map