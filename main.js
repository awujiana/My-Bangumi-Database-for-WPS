/**
 * BGM 主入口模块
 * @module main
 */
'use strict';

const MODULES = [
    { src: 'dist-ts/ts/core/constants.js', type: 'module', critical: true },
    { src: 'dist-ts/ts/core/crypto.js', type: 'module', critical: true },
    { src: 'dist-ts/ts/tools/index.js', type: 'module', critical: true },     // 先加载类型/枚举
    { src: 'dist-ts/ts/core/result.js', type: 'module', critical: true },     // BgmError + Result
    { src: 'dist-ts/ts/tools/wps.js', type: 'module', critical: true },        // isWpsApp 等
    { src: 'dist-ts/ts/tools/util.js', type: 'module', critical: true },
    { src: 'dist-ts/ts/tools/http.js', type: 'module' },
    { src: 'dist-ts/ts/ui/dialog.js', type: 'module' },
    { src: 'dist-ts/ts/ui/message.js', type: 'module' },
    { src: 'dist-ts/ts/ui/preview.js', type: 'module' },
    { src: 'dist-ts/ts/sync/syncRecord.js', type: 'module' },
    { src: 'dist-ts/ts/sync/scraping.js', type: 'module' },                    // 移到 exceltobangumi 之前
    { src: 'dist-ts/ts/sync/exceltobangumi.js', type: 'module' },
    { src: 'dist-ts/ts/ribbon.js', type: 'module', critical: true },
    { src: 'dist-ts/ts/ui/handlers.js', type: 'module', critical: true },
    { src: 'dist-ts/ts/taskpane.js', type: 'module', critical: true }
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