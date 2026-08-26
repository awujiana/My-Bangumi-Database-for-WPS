// 富化页面启动引导脚本
// 作为 ES Module 加载，避免内联 script（CSP script-src 'self' 要求）
// 职责：1) 按依赖顺序加载所有模块；2) 在模块就绪前禁用按钮，就绪后启用；3) 初始化富化页面
//
// 注意：此文件对应 enrich-bootstrap.ts 源文件，TypeScript 源文件位于 ui/ 目录，
// 但不在 tsconfig.json 的 include 范围内，因此需手动维护此 .js 文件。
// 参考 taskpane-bootstrap.js 和 settings-bootstrap.js 的模式。
import '../dist-ts/index.js';
import '../dist-ts/core/constants.js';
import '../dist-ts/tools/config.js';
import '../dist-ts/tools/util.js';
import '../dist-ts/core/crypto.js';
import '../dist-ts/tools/events.js';
import '../dist-ts/core/result.js';
import '../dist-ts/tools/wps.js';
import '../dist-ts/tools/http.js';
import '../dist-ts/tools/sanitize.js';
import '../dist-ts/tools/stringUtils.js';
import '../dist-ts/ui/dialog.js';
import '../dist-ts/ui/message.js';
import '../dist-ts/ui/preview.js';
import '../dist-ts/sync/syncRecord.js';
import '../dist-ts/sync/scraping.js';
import '../dist-ts/sync/exceltobangumi.js';
import '../dist-ts/sync/enrichEngine.js';
import '../dist-ts/sync/enrichRecord.js';
import { initEnrichPage } from '../dist-ts/panel/enrichPage.js';

// 模块就绪前禁用所有 data-action 按钮，避免误触发未初始化的处理逻辑
document.querySelectorAll('button[data-action]').forEach(function (btn) {
    btn.disabled = true;
});

// 接收到 modulesReady 事件后启用按钮
document.addEventListener('bgm:modulesReady', function () {
    document.querySelectorAll('button[data-action]').forEach(function (btn) {
        btn.disabled = false;
    });
    console.log('[BGM Enrich] 模块加载完成，按钮已启用');
});

// DOM 就绪后初始化富化页面
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        initEnrichPage();
    });
} else {
    initEnrichPage();
}