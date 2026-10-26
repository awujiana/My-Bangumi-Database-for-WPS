/**
 * @fileoverview 「模块就绪前禁用 data-action 按钮」启动门禁
 * @module panel/actionButtonsGate
 * @description 四个页面入口（panel / settings / clean / enrich）此前各写一份逐字相同的
 *              「禁用 → 收到 `bgm:modulesReady` 后启用」逻辑，且**功能已漂移**：
 *              只有 settings 版带 5 秒超时兜底，其余三页一旦事件没来就**永远禁用按钮**。
 *              收敛为一份后四页都有兜底。
 */
/** 超时兜底：多久没收到 `bgm:modulesReady` 就强制启用按钮 */
const READY_TIMEOUT_MS = 5000;
/** 统一的按钮选择器（与 HTML 里的 `data-action` 约定一致） */
const ACTION_BUTTON_SELECTOR = 'button[data-action]';
/**
 * 当前页面的日志前缀，由 {@link installActionButtonsGate} 登记。
 *
 * 页面侧只调 {@link notifyModulesReady}，不再各自拼事件名 / 拼 tag——重复手写正是
 * 「cf / highlight / clean 三页都忘了派发、只能等 5s 超时兜底」的成因。
 */
let pageLogTag = '[BGM]';
function setActionButtonsDisabled(isDisabled) {
    for (const button of document.querySelectorAll(ACTION_BUTTON_SELECTOR)) {
        const element = button;
        element.disabled = isDisabled;
    }
}
/**
 * 安装启动门禁：先禁用所有 `data-action` 按钮，模块就绪后启用。
 *
 * 超时兜底是**必须的**：模块加载失败（脚本 404 / 语法错误）时 `bgm:modulesReady`
 * 永远不会来，没有兜底整个页面的按钮就永久失效且无任何提示。
 *
 * @param logTag 日志前缀（如 `[BGM Settings]`，便于区分是哪个页面）
 */
export function installActionButtonsGate(logTag) {
    if (typeof document === 'undefined')
        return;
    pageLogTag = logTag;
    // 模块就绪前禁用所有 data-action 按钮，避免误触发未初始化的处理逻辑
    setActionButtonsDisabled(true);
    let isReady = false;
    document.addEventListener('bgm:modulesReady', () => {
        isReady = true;
        setActionButtonsDisabled(false);
        // eslint-disable-next-line no-console -- 启动兜底阶段日志后端未必就绪，console 是唯一输出通道
        console.log(`${logTag} 模块加载完成，按钮已启用`);
    });
    setTimeout(() => {
        if (isReady)
            return;
        // eslint-disable-next-line no-console -- 启动兜底阶段日志后端未必就绪，console 是唯一输出通道
        console.warn(`${logTag} ${String(READY_TIMEOUT_MS)}ms 内未收到 bgm:modulesReady 事件，强制启用按钮（兜底）`);
        setActionButtonsDisabled(false);
    }, READY_TIMEOUT_MS);
}
/**
 * 通知门禁：本页模块初始化完成，启用 `data-action` 按钮。
 *
 * 各页面 `initializeXxxPage()` 末尾必须调用。漏调不会让按钮永久失效（5s 后兜底强开），
 * 但用户会看到按钮灰 5 秒，控制台只剩一条极易被当噪声忽略的 warn——所以别漏。
 */
export function notifyModulesReady() {
    if (typeof document === 'undefined')
        return;
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
    // eslint-disable-next-line no-console -- 启动阶段日志后端未必就绪，console 是唯一输出通道
    console.log(`${pageLogTag} 模块就绪事件已派发`);
}
