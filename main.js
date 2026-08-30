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
            // 探测真实 HTTP 状态码 + Content-Type，一眼区分「404 文件缺失」与「MIME 拒绝」
            diagnoseScriptFailure(src).then(function (diag) {
                if (entry && diag) {
                    entry.error = 'HTTP ' + diag.status + ' / ' + diag.contentType;
                }
                reject(new Error('Failed to load script: ' + src));
            }).catch(function () {
                reject(new Error('Failed to load script: ' + src));
            });
        };
        document.head.appendChild(script);
    });
}

/**
 * 通过 fetch 探测脚本 URL 的真实响应，打印 HTTP 状态码与 Content-Type。
 * 目的：<script onerror> 本身拿不到状态码，无法区分
 *   - 404 / 0（文件不存在、路径错误、部署包陈旧）
 *   - 200 但 Content-Type 非 JS（MIME 拒绝 / 宿主 CSP 拦截）
 * 直接在控制台输出，方便下次定位根因。
 * @param {string} src 脚本地址
 */
function diagnoseScriptFailure(src) {
    if (typeof fetch !== 'function') {
        console.error('[BGM] diagnoseScriptFailure: fetch 不可用，无法探测 ' + src);
        return Promise.resolve(null);
    }
    return fetch(src, { method: 'GET', cache: 'no-store' })
        .then(function (resp) {
            const ct = resp.headers && resp.headers.get ? resp.headers.get('content-type') : '(未知)';
            const isJsMime = ct && /\/(javascript|ecmascript)|\+xml|text\/plain/i.test(ct);
            // 读取响应体前几字节，区分「真 JS 只是 MIME 标头错」与「服务器返回了 HTML 回退页」
            let bodyHead = '';
            let isHtmlBody = false;
            const probe = resp.clone();
            return probe.text().then(function (text) {
                bodyHead = (text || '').slice(0, 120).replace(/\s+/g, ' ');
                isHtmlBody = /^\s*<!?(doctype|html|html\b)/i.test(text || '');
                let verdict;
                if (resp.status === 404 || resp.status === 0) {
                    verdict = '疑似 404 / 文件缺失（路径错误、dist 未构建或部署包陈旧）';
                } else if (isHtmlBody) {
                    verdict = '服务器把该请求当页面返回了 HTML（SPA 回退 / 路由重写 / 路径未命中静态文件），并非真正的 JS 文件';
                } else if (resp.status === 200 && !isJsMime) {
                    verdict = '疑似 MIME 拒绝：状态码 200 且确为 JS 内容，但 Content-Type 非 JS（宿主/服务器 MIME 配置错误）';
                } else if (resp.status === 403 || resp.status === 401) {
                    verdict = '疑似权限/鉴权拒绝（' + resp.status + '）';
                } else {
                    verdict = '状态码 ' + resp.status + '，Content-Type="' + ct + '"';
                }
                console.error(
                    '[BGM] 诊断 ' + src + '\n' +
                    '    状态码: ' + resp.status + '\n' +
                    '    Content-Type: ' + ct + '\n' +
                    '    响应体前 120 字: ' + (bodyHead || '(空)') + '\n' +
                    '    → ' + verdict
                );
                // 缓存最近一次诊断，供崩溃覆盖层读取展示
                if (typeof window !== 'undefined') {
                    window.__BGM_LAST_DIAG__ = window.__BGM_LAST_DIAG__ || {};
                    window.__BGM_LAST_DIAG__[src] = {
                        status: resp.status,
                        contentType: ct,
                        verdict: verdict,
                        isHtmlBody: isHtmlBody,
                    };
                }
                return { status: resp.status, contentType: ct, verdict: verdict, isHtmlBody: isHtmlBody };
            }).catch(function () {
                // 读取响应体失败（如流式/受限），退回到仅看状态码+标头
                let verdict;
                if (resp.status === 404 || resp.status === 0) {
                    verdict = '疑似 404 / 文件缺失';
                } else if (resp.status === 200 && !isJsMime) {
                    verdict = '疑似 MIME 拒绝：状态码 200 但 Content-Type 非 JS';
                } else if (resp.status === 403 || resp.status === 401) {
                    verdict = '疑似权限/鉴权拒绝（' + resp.status + '）';
                } else {
                    verdict = '状态码 ' + resp.status + '，Content-Type="' + ct + '"';
                }
                if (typeof window !== 'undefined') {
                    window.__BGM_LAST_DIAG__ = window.__BGM_LAST_DIAG__ || {};
                    window.__BGM_LAST_DIAG__[src] = { status: resp.status, contentType: ct, verdict: verdict };
                }
                return { status: resp.status, contentType: ct, verdict: verdict };
            });
        })
        .catch(function (err) {
            console.error('[BGM] 诊断 ' + src + ' 的 fetch 探测失败: ' + (err && err.message ? err.message : err));
            return null;
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
                const diag = window.__BGM_LAST_DIAG__ && window.__BGM_LAST_DIAG__[mod.src];
                const diagLine = diag
                    ? `<p>探测结果：HTTP ${diag.status} / Content-Type: ${diag.contentType}` +
                      (diag.isHtmlBody ? ' / 实为 HTML 页面（SPA 回退）' : '') +
                      `<br>${diag.verdict}</p>`
                    : '';
                document.body.innerHTML = `<div style="color:red;padding:20px;font-size:16px;">
                    <h3>核心模块加载失败</h3>
                    <p>模块: ${mod.src}</p>
                    <p>${e.message}</p>
                    ${diagLine}
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