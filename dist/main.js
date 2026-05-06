/**
 * BGM 主入口模块
 * @module main
 * @description 动态加载所有模块脚本
 */

'use strict';

// ========== 模块依赖顺序 ==========
const MODULES = [
    // 核心模块
    { src: 'js/core/constants.js', type: 'module' },
    { src: 'js/core/crypto.js', type: 'module' },
    // 工具模块
    { src: 'js/util.js', type: 'module' },
    { src: 'js/http.js', type: 'module' },
    // UI 模块（dialog 先于业务模块，避免重复挂载 window）
    { src: 'js/ui/dialog.js', type: 'module' },
    { src: 'js/ui/message.js', type: 'module' },
    { src: 'js/ui/preview.js', type: 'module' },
    // 业务模块
    { src: 'js/syncRecord.js', type: 'module' },
    { src: 'js/bangumi.js', type: 'module' },
    { src: 'js/ribbon.js', type: 'module' },
    { src: 'js/ui/handlers.js', type: 'module' },
    { src: 'js/sync/scraping.js', type: 'module' },
    // 面板模块（挂载 window 函数供 HTML onclick 调用）
    { src: 'js/taskpane.js', type: 'module' },
    // 系统模块
    { src: 'js/systemdemo.js', type: 'script' }
];

/**
 * 加载脚本（支持 module 和 classic 两种模式）
 * @param {string} src - 脚本路径
 * @param {string} type - 脚本类型 ('module' 或 'script')
 * @returns {Promise} - 加载完成 Promise
 */
function loadScript(src, type) {
    return new Promise(function(resolve, reject) {
        var script = document.createElement('script');
        script.src = src;
        
        if (type === 'module') {
            script.type = 'module';
        }
        
        script.onload = function() {
            console.log('[BGM] Loaded: ' + src);
            resolve();
        };
        script.onerror = function(e) {
            console.error('[BGM] Failed to load: ' + src, e);
            reject(new Error('Failed to load script: ' + src));
        };
        document.head.appendChild(script);
    });
}

/**
 * 使用 ES6 动态 import 加载模块
 * @param {string} src - 模块路径
 * @returns {Promise} - 加载完成 Promise
 */
async function loadModule(src) {
    try {
        await import(/* @mangle */'./' + src);
        console.log('[BGM] Imported: ' + src);
    } catch (e) {
        console.error('[BGM] Failed to import: ' + src, e);
        // 回退到传统脚本加载
        await loadScript(src, 'script');
    }
}

/**
 * 按顺序加载所有模块
 */
async function loadAllModules() {
    console.log('[BGM] Starting module loading...');
    
    for (const mod of MODULES) {
        try {
            if (mod.type === 'module') {
                // 优先尝试 ES6 import（需要服务器支持 CORS）
                await loadModule(mod.src);
            } else {
                // 普通脚本直接加载
                await loadScript(mod.src, 'script');
            }
        } catch (e) {
            console.error('[BGM] Module loading failed:', e);
            // 继续加载下一个模块
        }
    }
    
    console.log('[BGM] Module loading complete');
    
    // 通知加载完成
    if (typeof window.BGM !== 'undefined') {
        window.BGM.onModulesLoaded && window.BGM.onModulesLoaded();
    }
}

/**
 * 初始化
 */
function init() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAllModules);
    } else {
        // DOM 已就绪
        loadAllModules();
    }
}

// 启动
init();

// ========== 导出（用于外部访问）==========
export { loadAllModules, loadModule, loadScript };
