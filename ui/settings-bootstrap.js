// Settings 页面启动引导脚本
// 作为 ES Module 加载，避免内联 script（CSP script-src 'self' 要求）
// 职责：1) 按依赖顺序加载所有模块；2) 在模块就绪前禁用按钮，就绪后启用

if (typeof window !== 'undefined') {
    window.addEventListener('error', function (e) {
        var target = e.target || e.srcElement;
        if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
            console.error('[BGM Settings] Resource load failed:', target.src || target.href);
        }
    }, true);

    window.addEventListener('unhandledrejection', function (e) {
        console.error('[BGM Settings] Unhandled promise rejection:', e.reason);
    });
}

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
import '../dist-ts/entry/settings-entry.js';

// 模块加载完成检查
console.log('[BGM Settings] 模块加载链完成');

// 模块就绪前禁用所有 data-action 按钮
document.querySelectorAll('button[data-action]').forEach(function (btn) {
    btn.disabled = true;
});

// 接收到 modulesReady 事件后启用按钮
document.addEventListener('bgm:modulesReady', function () {
    document.querySelectorAll('button[data-action]').forEach(function (btn) {
        btn.disabled = false;
    });
    console.log('[BGM Settings] 模块加载完成，按钮已启用');
});

// 超时兜底：如果 5 秒后仍未收到 bgm:modulesReady，输出 WARN 日志并强制启用按钮
(function () {
    var timeoutMs = 5000;
    var forced = false;
    var originalDispatch = document.dispatchEvent;

    // 监听 bgm:modulesReady 是否被发出
    document.addEventListener('bgm:modulesReady', function () {
        forced = true;
    });

    setTimeout(function () {
        if (!forced) {
            console.warn('[BGM Settings] ' + timeoutMs + 'ms 内未收到 bgm:modulesReady 事件，强制启用按钮（兜底）');
            document.querySelectorAll('button[data-action]').forEach(function (btn) {
                btn.disabled = false;
            });
        }
    }, timeoutMs);
})();
