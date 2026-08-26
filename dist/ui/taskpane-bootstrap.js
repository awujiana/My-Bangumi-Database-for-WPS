// Taskpane 启动引导脚本
// 作为 ES Module 加载，避免内联 script（CSP script-src 'self' 要求）
// 职责：1) 按依赖顺序加载所有模块；2) 在模块就绪前禁用按钮，就绪后启用
//
// 注意：自 Task 13 重构后，panel/panelPage.ts 与 ui/handlers/index.ts 不再在模块加载时
// 自动注册 DOMContentLoaded 监听器。统一通过 ts/entry/panel-entry.ts 入口模块
// 显式调用 initTaskpane() + initHandlers() 启动（入口模块内部含 taskpane.html 路径守卫，
// 在非浏览器或非 taskpane 上下文下不会触发副作用）。
import '../dist-ts/index.js';
import '../dist-ts/core/constants.js';
import '../dist-ts/tools/config.js';
import '../dist-ts/tools/util.js';
import '../dist-ts/core/crypto.js';
import '../dist-ts/tools/events.js';
import '../dist-ts/core/result.js';
import '../dist-ts/tools/wps.js';
import '../dist-ts/tools/http.js';
import '../dist-ts/ui/dialog.js';
import '../dist-ts/ui/message.js';
import '../dist-ts/ui/preview.js';
import '../dist-ts/sync/syncRecord.js';
import '../dist-ts/sync/scraping.js';
import '../dist-ts/sync/exceltobangumi.js';
import '../dist-ts/entry/panel-entry.js';

// 模块加载完成检查
if (typeof window.initPanel === 'function') {
    console.log('[BGM] All modules loaded, window functions ready');
} else {
    console.error('[BGM] Modules loaded but window.initPanel not found');
}

// 模块就绪前禁用所有 data-action 按钮，避免误触发未初始化的处理逻辑
document.querySelectorAll('button[data-action]').forEach(function (btn) {
    btn.disabled = true;
});

// 接收到 modulesReady 事件后启用按钮
document.addEventListener('bgm:modulesReady', function () {
    document.querySelectorAll('button[data-action]').forEach(function (btn) {
        btn.disabled = false;
    });
    console.log('[BGM] 模块加载完成，按钮已启用');
});
