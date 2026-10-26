const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./data-export.DuFJuc2X.js","./logger.DfgxokPR.js"])))=>i.map(i=>d[i]);
(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=[{src:`dist-ts/index.js`,type:`module`,critical:!0},{src:`dist-ts/tools/config.js`,type:`module`,critical:!0},{src:`dist-ts/tools/util/index.js`,type:`module`,critical:!0},{src:`dist-ts/core/result.js`,type:`module`,critical:!0},{src:`dist-ts/core/constants.js`,type:`module`,critical:!0},{src:`dist-ts/core/token-payload.js`,type:`module`,critical:!0},{src:`dist-ts/tools/events.js`,type:`module`,critical:!0},{src:`dist-ts/tools/wps.js`,type:`module`,critical:!0},{src:`dist-ts/tools/http.js`,type:`module`},{src:`dist-ts/ui/dialog.js`,type:`module`},{src:`dist-ts/ui/message.js`,type:`module`},{src:`dist-ts/ui/preview.js`,type:`module`},{src:`dist-ts/sync/sync-record.js`,type:`module`},{src:`dist-ts/sync/scraping.js`,type:`module`},{src:`dist-ts/sync/exceltobangumi/index.js`,type:`module`},{src:`dist-ts/sync/github-sync-diff.js`,type:`module`},{src:`dist-ts/sync/github-config.js`,type:`module`},{src:`dist-ts/sync/github-sync.js`,type:`module`},{src:`dist-ts/services/ribbon-service.js`,type:`module`},{src:`dist-ts/entry/ribbon-entry.js`,type:`module`,critical:!0},{src:`dist-ts/ui/handlers/index.js`,type:`module`,critical:!0},{src:`dist-ts/panel/panel-page.js`,type:`module`,critical:!0}];window.__BGM_MODULE_STATUS__=e.map(function(e){return{src:e.src,loaded:!1,critical:e.critical||!1,error:void 0}});function t(e,t){return new Promise((r,i)=>{let a=document.createElement(`script`);a.src=e,t===`module`&&(a.type=`module`),a.onload=()=>{console.log(`[BGM] Loaded: `+e);var t=window.__BGM_MODULE_STATUS__.find(function(t){return t.src===e});t&&(t.loaded=!0),r()},a.onerror=t=>{console.error(`[BGM] Failed to load: `+e,t);var r=window.__BGM_MODULE_STATUS__.find(function(t){return t.src===e});r&&(r.loaded=!1,r.error=`Failed to load`),n(e).then(function(t){r&&t&&(r.error=`HTTP `+t.status+` / `+t.contentType),i(Error(`Failed to load script: `+e))}).catch(function(){i(Error(`Failed to load script: `+e))})},document.head.appendChild(a)})}function n(e){return typeof fetch==`function`?fetch(e,{method:`GET`,cache:`no-store`}).then(function(t){let n=t.headers&&t.headers.get?t.headers.get(`content-type`):`(未知)`,r=n&&/\/(javascript|ecmascript)|\+xml|text\/plain/i.test(n),i=``,a=!1;return t.clone().text().then(function(o){i=(o||``).slice(0,120).replace(/\s+/g,` `),a=/^\s*<!?(doctype|html|html\b)/i.test(o||``);let s;return s=t.status===404||t.status===0?`疑似 404 / 文件缺失（路径错误、dist 未构建或部署包陈旧）`:a?`服务器把该请求当页面返回了 HTML（SPA 回退 / 路由重写 / 路径未命中静态文件），并非真正的 JS 文件`:t.status===200&&!r?`疑似 MIME 拒绝：状态码 200 且确为 JS 内容，但 Content-Type 非 JS（宿主/服务器 MIME 配置错误）`:t.status===403||t.status===401?`疑似权限/鉴权拒绝（`+t.status+`）`:`状态码 `+t.status+`，Content-Type="`+n+`"`,console.error(`[BGM] 诊断 `+e+`
    状态码: `+t.status+`
    Content-Type: `+n+`
    响应体前 120 字: `+(i||`(空)`)+`
    → `+s),typeof window<`u`&&(window.__BGM_LAST_DIAG__=window.__BGM_LAST_DIAG__||{},window.__BGM_LAST_DIAG__[e]={status:t.status,contentType:n,verdict:s,isHtmlBody:a}),{status:t.status,contentType:n,verdict:s,isHtmlBody:a}}).catch(function(){let i;return i=t.status===404||t.status===0?`疑似 404 / 文件缺失`:t.status===200&&!r?`疑似 MIME 拒绝：状态码 200 但 Content-Type 非 JS`:t.status===403||t.status===401?`疑似权限/鉴权拒绝（`+t.status+`）`:`状态码 `+t.status+`，Content-Type="`+n+`"`,typeof window<`u`&&(window.__BGM_LAST_DIAG__=window.__BGM_LAST_DIAG__||{},window.__BGM_LAST_DIAG__[e]={status:t.status,contentType:n,verdict:i}),{status:t.status,contentType:n,verdict:i}})}).catch(function(t){return console.error(`[BGM] 诊断 `+e+` 的 fetch 探测失败: `+(t&&t.message?t.message:t)),null}):(console.error(`[BGM] diagnoseScriptFailure: fetch 不可用，无法探测 `+e),Promise.resolve(null))}async function r(){console.log(`[BGM] Starting module loading...`);for(let n of e)try{await t(n.src,n.type)}catch(e){if(console.error(`[BGM] Module loading failed:`,e),n.critical){let t=window.__BGM_LAST_DIAG__&&window.__BGM_LAST_DIAG__[n.src],r=t?`<p>探测结果：HTTP ${t.status} / Content-Type: ${t.contentType}`+(t.isHtmlBody?` / 实为 HTML 页面（SPA 回退）`:``)+`<br>${t.verdict}</p>`:``;document.body.innerHTML=`<div style="color:red;padding:20px;font-size:16px;">
                    <h3>核心模块加载失败</h3>
                    <p>模块: ${n.src}</p>
                    <p>${e.message}</p>
                    ${r}
                    <p>请检查网络或文件完整性，然后重新加载。</p>
                </div>`;return}}console.log(`[BGM] Module loading complete`)}document.readyState===`loading`?document.addEventListener(`DOMContentLoaded`,r):r();function i(){return window}var a=[{id:`btnShowPanel`,label:`打开同步面板`,icon:`📋`},{id:`btnSyncBangumi`,label:`上传同步`,icon:`🔄`},{id:`btnSetToken`,label:`设置 Token`,icon:`🔑`},{id:`btnTestToken`,label:`测试 Token`,icon:`🧪`},{id:`btnCopyToken`,label:`复制 Token`,icon:`📋`},{id:`btnSetUserId`,label:`设置用户 ID`,icon:`👤`},{id:`btnOpenCollection`,label:`打开收藏页`,icon:`🔗`},{id:`btnSyncFromGithub`,label:`数据同步`,icon:`📥`},{id:`btnUndoLastSync`,label:`撤销同步`,icon:`↩️`}],o=[{label:`全部`,level:void 0},{label:`Info`,level:`INFO`},{label:`Warn`,level:`WARN`},{label:`Error`,level:`ERROR`}];function s(){return i().WpsInvoke===void 0}function c(){return i().__BGM_MODULE_STATUS__??[]}function l(e){let t=document.createElement(`div`);return t.textContent=e,t.innerHTML}function u(){return`
    <div class="bgm-dp-header">
      <div class="bgm-dp-header-left">
        <div class="bgm-dp-logo">BGM</div>
        <span class="bgm-dp-title">调试面板</span>
      </div>
      <button class="bgm-dp-toggle" id="bgm-dp-collapse" title="收起">▶</button>
    </div>
  `}function d(e){let t=e.filter(e=>e.loaded).length,n=e.filter(e=>!e.loaded),r=n.filter(e=>e.critical),a=typeof i()._bgmRibbonReady==`function`,o=[`<span class="bgm-dp-badge ${a?`bgm-dp-badge-ok`:`bgm-dp-badge-err`}">${a?`● Ribbon 就绪`:`○ Ribbon 未就绪`}</span>`];return n.length>0&&o.push(`<span class="bgm-dp-badge ${r.length>0?`bgm-dp-badge-err`:`bgm-dp-badge-warn`}">${String(n.length)} 模块失败</span>`),o.push(`<span class="bgm-dp-badge bgm-dp-badge-muted">${String(t)}/${String(e.length)} 已加载</span>`),`<div class="bgm-dp-statusbar">${o.join(``)}</div>`}function f(e){let t=c();return`
    <div class="bgm-dp-tabs">
      <button class="bgm-dp-tab active" data-tab="modules">模块状态<span class="bgm-dp-tab-count">${String(t.length)}</span></button>
      <button class="bgm-dp-tab" data-tab="ribbon">Ribbon 测试<span class="bgm-dp-tab-count">${String(a.length)}</span></button>
      <button class="bgm-dp-tab" data-tab="console">控制台日志<span class="bgm-dp-tab-count">${String(e)}</span></button>
      <button class="bgm-dp-tab" data-tab="env">环境信息</button>
    </div>
  `}function p(){let e=c();return e.length===0?`<div class="bgm-dp-panel active" data-panel="modules"><p style="color:#64748b;text-align:center;padding:20px;">等待模块加载...</p></div>`:`<div class="bgm-dp-panel active" data-panel="modules"><div class="bgm-dp-mod-grid">${e.map(e=>`
      <div class="bgm-dp-mod-item">
        <span class="bgm-dp-mod-dot ${e.loaded?`bgm-dp-mod-dot-ok`:`bgm-dp-mod-dot-err`}"></span>
        <span class="bgm-dp-mod-name">${e.src}${e.error?` — ${e.error}`:``}</span>
        ${e.critical?`<span class="bgm-dp-mod-tag bgm-dp-mod-tag-critical">critical</span>`:``}
      </div>
    `).join(``)}</div></div>`}function m(){return`<div class="bgm-dp-panel" data-panel="ribbon"><div class="bgm-dp-ribbon-grid">${a.map(e=>`
    <div class="bgm-dp-ribbon-card" data-btn="${e.id}">
      <div class="bgm-dp-ribbon-icon">${e.icon}</div>
      <div class="bgm-dp-ribbon-label">${e.label}</div>
      <div class="bgm-dp-ribbon-id">${e.id}</div>
      <div class="bgm-dp-ribbon-result" data-result="${e.id}">—</div>
      <div class="bgm-dp-ribbon-imgurl" data-imgurl="${e.id}"></div>
    </div>
  `).join(``)}</div></div>`}function h(){return`
    <div class="bgm-dp-panel" data-panel="console">
      <div class="bgm-dp-log-filter">
        ${o.map((e,t)=>`<button class="bgm-dp-filter-btn ${t===0?`active`:``}" data-level="${e.level??`all`}">${e.label}</button>`).join(``)}
        <div class="bgm-dp-log-actions">
          <button class="bgm-dp-log-btn" id="bgm-dp-log-clear">清空</button>
          <button class="bgm-dp-log-btn bgm-dp-log-btn-primary" id="bgm-dp-log-export">导出</button>
        </div>
      </div>
      <div class="bgm-dp-console" id="bgm-dp-console-box">
        <div class="bgm-dp-log-empty">加载中...</div>
      </div>
    </div>
  `}function g(){let e=i();return`
    <div class="bgm-dp-panel" data-panel="env">
      <div class="bgm-dp-env-grid">${[{label:`页面 URL`,value:window.location.href,cssClass:``},{label:`WpsInvoke`,value:e.WpsInvoke===void 0?`undefined (开发模式)`:`available`,cssClass:e.WpsInvoke===void 0?`bgm-dp-env-value-warn`:`bgm-dp-env-value-ok`},{label:`Ribbon 就绪 (_ribbonReady)`,value:String(e._ribbonReady??!1),cssClass:e._ribbonReady?`bgm-dp-env-value-ok`:`bgm-dp-env-value-err`},{label:`OnAddinLoad`,value:typeof e.OnAddinLoad,cssClass:typeof e.OnAddinLoad==`function`?`bgm-dp-env-value-ok`:`bgm-dp-env-value-err`},{label:`OnAction`,value:typeof e.OnAction,cssClass:typeof e.OnAction==`function`?`bgm-dp-env-value-ok`:`bgm-dp-env-value-err`},{label:`GetBangumiImage`,value:typeof e.GetBangumiImage,cssClass:typeof e.GetBangumiImage==`function`?`bgm-dp-env-value-ok`:`bgm-dp-env-value-err`},{label:`GetIncrementalSyncPressed`,value:typeof e.GetIncrementalSyncPressed,cssClass:typeof e.GetIncrementalSyncPressed==`function`?`bgm-dp-env-value-ok`:`bgm-dp-env-value-err`},{label:`DOMPurify (window)`,value:typeof e.DOMPurify,cssClass:typeof e.DOMPurify==`object`?`bgm-dp-env-value-ok`:`bgm-dp-env-value-warn`},{label:`Zod (window.z)`,value:typeof e.z,cssClass:typeof e.z==`object`?`bgm-dp-env-value-ok`:`bgm-dp-env-value-warn`}].map(e=>`
      <div class="bgm-dp-env-card">
        <div class="bgm-dp-env-label">${e.label}</div>
        <div class="bgm-dp-env-value ${e.cssClass}">${e.value}</div>
      </div>
    `).join(``)}</div>
      <div class="bgm-dp-env-actions">
        <button class="bgm-dp-action-btn" id="bgm-dp-refresh">🔄 刷新页面</button>
        <button class="bgm-dp-action-btn" id="bgm-dp-clear-cache">🧹 清除缓存并刷新</button>
        <button class="bgm-dp-action-btn" id="bgm-dp-export-report">📥 导出诊断报告</button>
        <button class="bgm-dp-action-btn bgm-dp-action-btn-primary" id="bgm-dp-reload-modules">▶ 重新加载所有模块</button>
      </div>
    </div>
  `}var _=`modulepreload`,v=function(e,t){return new URL(e,t).href},y={},b=function(e){return e.pathname.endsWith(`.css`)},x=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},S=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{t=v(t,n);let r=s(t),i=b(r);return x(y,r.href,()=>{if(e===void 0){e={all:new Set,styles:new Set};let t=document.getElementsByTagName(`link`);for(let n=t.length-1;n>=0;n--){let r=t[n];e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;let t=document.createElement(`link`);if(t.rel=i?`stylesheet`:_,i||(t.as=`script`),t.crossOrigin=``,t.href=r.href,a&&t.setAttribute(`nonce`,a),document.head.appendChild(t),i)return new Promise((e,n)=>{t.addEventListener(`load`,e),t.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${r}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},C=null;async function w(){if(C)return C;try{return C=await S(()=>import(`./logger.DfgxokPR.js`),[],import.meta.url),C}catch{return null}}var T=null;async function E(){if(T)return T;try{return T=await S(()=>import(`./data-export.DuFJuc2X.js`),__vite__mapDeps([0,1]),import.meta.url),T}catch{return null}}var D=`
.bgm-dp-root {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 420px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: #1e293b;
  background: #f8fafc;
  border-left: 1px solid #e2e8f0;
  box-shadow: -2px 0 8px rgba(0,0,0,0.08);
  transition: transform 0.25s ease;
}
.bgm-dp-root.collapsed { transform: translateX(400px); }
.bgm-dp-root * { box-sizing: border-box; }

/* 标题栏 */
.bgm-dp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.bgm-dp-header-left { display: flex; align-items: center; gap: 8px; }
.bgm-dp-logo {
  width: 24px; height: 24px;
  border-radius: 6px;
  background: #7c3aed;
  color: #fff;
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.bgm-dp-title { font-size: 14px; font-weight: 500; }
.bgm-dp-toggle {
  background: none; border: none; cursor: pointer;
  font-size: 18px; color: #64748b; padding: 4px;
  line-height: 1;
}
.bgm-dp-toggle:hover { color: #1e293b; }

/* 状态条 */
.bgm-dp-statusbar {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 6px 12px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.bgm-dp-badge {
  font-size: 11px; padding: 2px 8px;
  border-radius: 999px;
  display: inline-flex; align-items: center; gap: 3px;
  white-space: nowrap;
}
.bgm-dp-badge-ok { background: #dcfce7; color: #16a34a; }
.bgm-dp-badge-warn { background: #fef3c7; color: #d97706; }
.bgm-dp-badge-err { background: #fee2e2; color: #dc2626; }
.bgm-dp-badge-muted { background: #f1f5f9; color: #64748b; }

/* Tabs */
.bgm-dp-tabs {
  display: flex; gap: 1px;
  padding: 0 8px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.bgm-dp-tab {
  padding: 8px 12px;
  font-size: 13px;
  color: #64748b;
  border: none; background: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color .15s, border-color .15s;
}
.bgm-dp-tab:hover { color: #1e293b; }
.bgm-dp-tab.active {
  color: #7c3aed;
  border-bottom-color: #7c3aed;
  font-weight: 500;
}
.bgm-dp-tab-count {
  font-size: 11px; font-family: monospace;
  background: #f1f5f9; color: #64748b;
  padding: 0 5px; border-radius: 999px;
  margin-left: 3px;
}
.bgm-dp-tab.active .bgm-dp-tab-count {
  background: #ede9fe; color: #7c3aed;
}

/* 内容区 */
.bgm-dp-body { flex: 1; overflow-y: auto; padding: 12px; }
.bgm-dp-panel { display: none; }
.bgm-dp-panel.active { display: block; }

/* 模块网格 */
.bgm-dp-mod-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
}
.bgm-dp-mod-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-family: "SF Mono", Consolas, monospace;
  font-size: 12px;
}
.bgm-dp-mod-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.bgm-dp-mod-dot-ok { background: #16a34a; }
.bgm-dp-mod-dot-err { background: #dc2626; }
.bgm-dp-mod-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bgm-dp-mod-tag {
  font-size: 10px; color: #94a3b8;
  background: #f8fafc; padding: 1px 5px; border-radius: 3px;
}
.bgm-dp-mod-tag-critical { color: #7c3aed; background: #ede9fe; }

/* Ribbon 测试 */
.bgm-dp-ribbon-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.bgm-dp-ribbon-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  text-align: center;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
}
.bgm-dp-ribbon-card:hover {
  border-color: #7c3aed;
  box-shadow: 0 0 0 2px #ede9fe;
}
.bgm-dp-ribbon-icon { font-size: 20px; margin-bottom: 4px; }
.bgm-dp-ribbon-label { font-size: 11px; color: #64748b; margin-bottom: 2px; }
.bgm-dp-ribbon-id { font-family: monospace; font-size: 11px; color: #1e293b; }
.bgm-dp-ribbon-result {
  margin-top: 4px; font-size: 10px; font-family: monospace;
  min-height: 16px; color: #16a34a;
}
.bgm-dp-ribbon-imgurl {
  margin-top: 2px; font-size: 9px; color: #64748b;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 控制台日志 */
.bgm-dp-log-filter { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.bgm-dp-filter-btn {
  font-size: 11px; padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #fff; color: #64748b;
  cursor: pointer;
}
.bgm-dp-filter-btn.active {
  background: #ede9fe; color: #7c3aed; border-color: #7c3aed;
}
.bgm-dp-log-actions { display: flex; gap: 6px; margin-left: auto; }
.bgm-dp-log-btn {
  font-size: 11px; padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #fff; color: #1e293b;
  cursor: pointer;
}
.bgm-dp-log-btn:hover { background: #f1f5f9; }
.bgm-dp-log-btn-primary {
  background: #7c3aed; color: #fff; border-color: #7c3aed;
}
.bgm-dp-log-btn-primary:hover { background: #6366f1; }
.bgm-dp-console {
  background: #1a1a2e;
  border-radius: 8px;
  padding: 10px;
  font-family: "SF Mono", Consolas, monospace;
  font-size: 12px;
  color: #e2e8f0;
  max-height: 400px;
  overflow-y: auto;
}
.bgm-dp-log-line {
  display: flex; gap: 6px;
  padding: 1px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.bgm-dp-log-time { color: #64748b; flex-shrink: 0; }
.bgm-dp-log-level { font-weight: 600; flex-shrink: 0; width: 40px; }
.bgm-dp-log-level-INFO { color: #38bdf8; }
.bgm-dp-log-level-WARN { color: #fbbf24; }
.bgm-dp-log-level-ERROR { color: #f87171; }
.bgm-dp-log-level-DEBUG { color: #94a3b8; }
.bgm-dp-log-msg { flex: 1; word-break: break-all; }
.bgm-dp-log-empty { color: #64748b; text-align: center; padding: 20px; }

/* 环境信息 */
.bgm-dp-env-grid {
  display: grid; grid-template-columns: 1fr; gap: 8px;
}
.bgm-dp-env-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
}
.bgm-dp-env-label { font-size: 11px; color: #64748b; margin-bottom: 3px; }
.bgm-dp-env-value {
  font-family: monospace; font-size: 12px;
  color: #1e293b; word-break: break-all;
}
.bgm-dp-env-value-ok { color: #16a34a; }
.bgm-dp-env-value-err { color: #dc2626; }
.bgm-dp-env-value-warn { color: #d97706; }
.bgm-dp-env-actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-top: 12px;
}
.bgm-dp-action-btn {
  font-size: 12px; padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #fff; color: #1e293b;
  cursor: pointer;
}
.bgm-dp-action-btn:hover { background: #f1f5f9; }
.bgm-dp-action-btn-primary {
  background: #7c3aed; color: #fff; border-color: #7c3aed;
}
.bgm-dp-action-btn-primary:hover { background: #6366f1; }

/* 折叠态浮动按钮 */
.bgm-dp-fab {
  position: fixed;
  right: 0; top: 50%;
  transform: translateY(-50%);
  width: 28px; height: 60px;
  background: #7c3aed;
  color: #fff;
  border-radius: 8px 0 0 8px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  z-index: 99999;
  font-size: 16px;
  box-shadow: -2px 0 6px rgba(0,0,0,0.15);
}
.bgm-dp-fab:hover { background: #6366f1; }
`,O,k=null;function A(e){let t=e.querySelectorAll(`.bgm-dp-tab`),n=e.querySelectorAll(`.bgm-dp-panel`);t.forEach(r=>{r.addEventListener(`click`,()=>{t.forEach(e=>{e.classList.remove(`active`)}),n.forEach(e=>{e.classList.remove(`active`)}),r.classList.add(`active`);let i=r.dataset.tab,a=e.querySelector(`[data-panel="${CSS.escape(i??``)}"]`);if(a&&a.classList.add(`active`),i===`console`?F(e):I(),i===`env`){let t=e.querySelector(`[data-panel="env"]`);if(t){t.outerHTML=g();let n=e.querySelector(`[data-panel="env"]`);n&&n.classList.add(`active`),L(e)}}})})}function j(e){e.querySelectorAll(`.bgm-dp-ribbon-card`).forEach(t=>{t.addEventListener(`click`,()=>{let n=t.dataset.btn;if(!n)return;let r=e.querySelector(`[data-result="${CSS.escape(n)}"]`);if(!r)return;let a=e.querySelector(`[data-imgurl="${CSS.escape(n)}"]`);r.textContent=`▶ 调用中...`,r.style.color=`#64748b`;try{let e=i();if(typeof e.GetBangumiImage==`function`){let t=e.GetBangumiImage({Id:n});a&&(a.textContent=t,a.title=t)}}catch{}setTimeout(()=>{let e=i();if(typeof e.OnAction==`function`)try{e.OnAction({Id:n}),r.textContent=`✅ 已调用`,r.style.color=`#16a34a`}catch(e){let t=e instanceof Error?e.message:String(e);r.textContent=`❌ ${t}`,r.style.color=`#dc2626`}else r.textContent=`⚠️ OnAction 未定义`,r.style.color=`#d97706`},100)})})}function M(e){let t=e.querySelectorAll(`.bgm-dp-filter-btn`);t.forEach(n=>{n.addEventListener(`click`,()=>{t.forEach(e=>{e.classList.remove(`active`)}),n.classList.add(`active`);let{level:r}=n.dataset;O=r===`all`?void 0:r,P(e)})})}function N(e){e.querySelector(`#bgm-dp-log-clear`)?.addEventListener(`click`,()=>{(async()=>{let t=await w();t&&(t.clearLogs(),P(e))})()}),e.querySelector(`#bgm-dp-log-export`)?.addEventListener(`click`,()=>{(async()=>{(await E())?.exportData(`systemLogs`,`txt`)})()})}async function P(e){let t=e.querySelector(`#bgm-dp-console-box`);if(!t)return;let n=await w();if(!n){t.innerHTML=`<div class="bgm-dp-log-empty">logger 模块未加载</div>`;return}let r=n.getRecentLogs(O,200);if(r.length===0){t.innerHTML=`<div class="bgm-dp-log-empty">暂无日志</div>`;return}t.innerHTML=r.map(e=>{let t=new Date(e.timestamp),n=`${String(t.getMinutes()).padStart(2,`0`)}:${String(t.getSeconds()).padStart(2,`0`)}.${String(t.getMilliseconds()).padStart(3,`0`).slice(0,2)}`,r=e.level.toUpperCase();return`<div class="bgm-dp-log-line">
        <span class="bgm-dp-log-time">${n}</span>
        <span class="bgm-dp-log-level bgm-dp-log-level-${r}">${r}</span>
        <span class="bgm-dp-log-msg">${l(e.message)}</span>
      </div>`}).join(``),t.scrollTop=t.scrollHeight;let i=e.querySelector(`:scope .bgm-dp-tab[data-tab="console"] .bgm-dp-tab-count`);if(i){let e=n.getRecentLogs(void 0,1e3);i.textContent=String(e.length)}}function F(e){I(),P(e),k=setInterval(()=>{P(e)},2e3)}function I(){k&&=(clearInterval(k),null)}function L(e){e.querySelector(`#bgm-dp-refresh`)?.addEventListener(`click`,()=>{window.location.reload()}),e.querySelector(`#bgm-dp-clear-cache`)?.addEventListener(`click`,()=>{window.location.assign(`${window.location.origin+window.location.pathname}?bust=${String(Date.now())}`)}),e.querySelector(`#bgm-dp-export-report`)?.addEventListener(`click`,()=>{R()}),e.querySelector(`#bgm-dp-reload-modules`)?.addEventListener(`click`,()=>{window.location.reload()})}function R(){let e=i(),t=c(),n={timestamp:new Date().toISOString(),url:window.location.href,userAgent:navigator.userAgent,wpsInvoke:typeof e.WpsInvoke,ribbonReady:e._ribbonReady??!1,callbacks:{OnAddinLoad:typeof e.OnAddinLoad,OnAction:typeof e.OnAction,GetBangumiImage:typeof e.GetBangumiImage,GetIncrementalSyncPressed:typeof e.GetIncrementalSyncPressed},domPurify:typeof e.DOMPurify,zod:typeof e.z,moduleStatuses:t},r=new Blob([JSON.stringify(n,null,2)],{type:`application/json;charset=utf-8`}),a=URL.createObjectURL(r),o=document.createElement(`a`);o.href=a,o.download=`bgm-diagnostic-${String(Date.now())}.json`,document.body.appendChild(o),o.click(),document.body.removeChild(o),URL.revokeObjectURL(a)}function z(e,t){e.querySelector(`#bgm-dp-collapse`)?.addEventListener(`click`,()=>{e.classList.add(`collapsed`),t.style.display=`flex`,I()}),t.addEventListener(`click`,()=>{e.classList.remove(`collapsed`),t.style.display=`none`,e.querySelector(`.bgm-dp-tab.active`)?.dataset.tab===`console`&&F(e)})}function B(){if(!s()||document.getElementById(`bgm-debug-panel-root`))return;let e=document.createElement(`style`);e.textContent=D,document.head.appendChild(e);let t=c(),n=document.createElement(`div`);n.id=`bgm-debug-panel-root`,n.className=`bgm-dp-root`,n.innerHTML=`
    ${u()}
    ${d(t)}
    ${f(0)}
    <div class="bgm-dp-body">
      ${p()}
      ${m()}
      ${h()}
      ${g()}
    </div>
  `,document.body.appendChild(n);let r=document.createElement(`div`);r.className=`bgm-dp-fab`,r.textContent=`🐛`,r.title=`展开调试面板`,r.style.display=`none`,document.body.appendChild(r),A(n),j(n),M(n),N(n),L(n),z(n,r),setTimeout(()=>{let e=c(),t=n.querySelector(`.bgm-dp-statusbar`);t&&(t.outerHTML=d(e));let r=n.querySelector(`[data-panel="modules"]`);r&&(r.outerHTML=p());let i=n.querySelector(`:scope .bgm-dp-tab[data-tab="modules"] .bgm-dp-tab-count`);i&&(i.textContent=String(e.length))},500);let i=setInterval(()=>{let e=c();e.filter(e=>e.loaded).length===e.length&&e.length>0&&clearInterval(i);let t=n.querySelector(`.bgm-dp-statusbar`);t&&(t.outerHTML=d(e));let r=n.querySelector(`.bgm-dp-panel.active[data-panel="modules"]`);r&&(r.outerHTML=p())},3e3)}typeof document<`u`&&(document.readyState===`loading`?document.addEventListener(`DOMContentLoaded`,B):B());