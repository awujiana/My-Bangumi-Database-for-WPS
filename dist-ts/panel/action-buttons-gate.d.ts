/**
 * @fileoverview 「模块就绪前禁用 data-action 按钮」启动门禁
 * @module panel/actionButtonsGate
 * @description 四个页面入口（panel / settings / clean / enrich）此前各写一份逐字相同的
 *              「禁用 → 收到 `bgm:modulesReady` 后启用」逻辑，且**功能已漂移**：
 *              只有 settings 版带 5 秒超时兜底，其余三页一旦事件没来就**永远禁用按钮**。
 *              收敛为一份后四页都有兜底。
 */
/**
 * 安装启动门禁：先禁用所有 `data-action` 按钮，模块就绪后启用。
 *
 * 超时兜底是**必须的**：模块加载失败（脚本 404 / 语法错误）时 `bgm:modulesReady`
 * 永远不会来，没有兜底整个页面的按钮就永久失效且无任何提示。
 *
 * @param logTag 日志前缀（如 `[BGM Settings]`，便于区分是哪个页面）
 */
export declare function installActionButtonsGate(logTag: string): void;
/**
 * 通知门禁：本页模块初始化完成，启用 `data-action` 按钮。
 *
 * 各页面 `initializeXxxPage()` 末尾必须调用。漏调不会让按钮永久失效（5s 后兜底强开），
 * 但用户会看到按钮灰 5 秒，控制台只剩一条极易被当噪声忽略的 warn——所以别漏。
 */
export declare function notifyModulesReady(): void;
//# sourceMappingURL=action-buttons-gate.d.ts.map