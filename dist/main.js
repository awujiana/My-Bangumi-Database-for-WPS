/**
 * BGM 主入口模块（修复版）
 * @module main
 */
'use strict';

const MODULES = [
    { src: 'js/core/constants.js', type: 'module', critical: true },
    { src: 'js/core/crypto.js', type: 'module', critical: true },
    { src: 'js/util.js', type: 'module', critical: true },
    { src: 'js/http.js', type: 'module' },
    { src: 'js/core/unified.js', type: 'module' },
    { src: 'js/ui/dialog.js', type: 'module' },
    { src: 'js/ui/message.js', type: 'module' },
    { src: 'js/ui/preview.js', type: 'module' },
    { src: 'js/sync/syncRecord.js', type: 'module' },
    { src: 'js/sync/exceltobangumi.js', type: 'module' },
    { src: 'js/ribbon.js', type: 'module', critical: true },
    { src: 'js/ui/handlers.js', type: 'module', critical: true },
    { src: 'js/sync/scraping.js', type: 'module' },
    { src: 'js/taskpane.js', type: 'module', critical: true }
    // systemdemo.js 已移除（脚手架模板，与业务无关）
];

function loadScript(src, type) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        if (type === 'module') script.type = 'module';
        script.onload = () => {
            console.log('[BGM] Loaded: ' + src);
            resolve();
        };
        script.onerror = (e) => {
            console.error('[BGM] Failed to load: ' + src, e);
            reject(new Error('Failed to load script: ' + src));
        };
        document.head.appendChild(script);
    });
}

async function loadAllModules() {
    console.log('[BGM] Starting module loading...');
    for (const mod of MODULES) {
        try {
            await loadScript(mod.src, mod.type);
        } catch (e) {
            console.error('[BGM] Module loading failed:', e);
            if (mod.critical) {
                document.body.innerHTML = `<div style="color:red;padding:20px;font-size:16px;">
                    <h3>核心模块加载失败</h3>
                    <p>模块: ${mod.src}</p>
                    <p>${e.message}</p>
                    <p>请检查网络或文件完整性，然后重新加载。</p>
                </div>`;
                return;
            }
            // 非关键模块加载失败继续执行
        }
    }
    console.log('[BGM] Module loading complete');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAllModules);
} else {
    loadAllModules();
}