/**
 * BGM 主入口模块
 * @module main
 */
'use strict';

const MODULES = [
    { src: 'dist-ts/index.js', type: 'module', critical: true },     // 先加载类型/枚举
    { src: 'dist-ts/tools/config.js', type: 'module', critical: true },
    { src: 'dist-ts/tools/util.js', type: 'module', critical: true },
    { src: 'dist-ts/core/result.js', type: 'module', critical: true },     // BgmError + Result
    { src: 'dist-ts/core/constants.js', type: 'module', critical: true },
    { src: 'dist-ts/core/crypto.js', type: 'module', critical: true },
    { src: 'dist-ts/tools/events.js', type: 'module', critical: true },
    { src: 'dist-ts/tools/wps.js', type: 'module', critical: true },        // isWpsApp 等
    { src: 'dist-ts/tools/http.js', type: 'module' },
    { src: 'dist-ts/ui/dialog.js', type: 'module' },
    { src: 'dist-ts/ui/message.js', type: 'module' },
    { src: 'dist-ts/ui/preview.js', type: 'module' },
    { src: 'dist-ts/sync/syncRecord.js', type: 'module' },
    { src: 'dist-ts/sync/scraping.js', type: 'module' },
    { src: 'dist-ts/sync/exceltobangumi.js', type: 'module' },
    { src: 'dist-ts/sync/githubSyncDiff.js', type: 'module' },   // GitHub 同步纯函数（零依赖）
    { src: 'dist-ts/sync/githubConfig.js', type: 'module' },     // GitHub 仓库配置管理
    { src: 'dist-ts/sync/githubSync.js', type: 'module' },       // GitHub 仓库增量同步主模块
    { src:'dist-ts/services/ribbonService.js', type:'module'},
    // 自 Task 13 重构后，ribbon.ts 不再在模块加载时自动注册 message 监听器。
    // 改为通过 entry/ribbon-entry.ts 显式调用 initRibbon() 启动（入口模块内部
    // 含 typeof window !== 'undefined' 守卫，确保 Node 测试环境导入不会触发副作用）。
    { src: 'dist-ts/entry/ribbon-entry.js', type: 'module', critical: true },
    { src: 'dist-ts/ui/handlers.js', type: 'module', critical: true },
    { src: 'dist-ts/panel/panelPage.js', type: 'module', critical: true }
];

// 暴露模块加载状态给调试面板（debugPanel.ts 读取）
window.__BGM_MODULE_STATUS__ = MODULES.map(function(m) {
    return { src: m.src, loaded: false, critical: m.critical || false, error: undefined };
});

function loadScript(src, type) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        if (type === 'module') script.type = 'module';
        script.onload = () => {
            console.log('[BGM] Loaded: ' + src);
            var status = window.__BGM_MODULE_STATUS__;
            var entry = status.find(function(m) { return m.src === src; });
            if (entry) entry.loaded = true;
            resolve();
        };
        script.onerror = (e) => {
            console.error('[BGM] Failed to load: ' + src, e);
            var status = window.__BGM_MODULE_STATUS__;
            var entry = status.find(function(m) { return m.src === src; });
            if (entry) { entry.loaded = false; entry.error = 'Failed to load'; }
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