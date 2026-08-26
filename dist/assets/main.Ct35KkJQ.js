(function(){const o=document.createElement("link").relList;if(o&&o.supports&&o.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))d(n);new MutationObserver(n=>{for(const a of n)if(a.type==="childList")for(const r of a.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&d(r)}).observe(document,{childList:!0,subtree:!0});function t(n){const a={};return n.integrity&&(a.integrity=n.integrity),n.referrerPolicy&&(a.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?a.credentials="include":n.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function d(n){if(n.ep)return;n.ep=!0;const a=t(n);fetch(n.href,a)}})();const M=[{src:"dist-ts/index.js",type:"module",critical:!0},{src:"dist-ts/tools/config.js",type:"module",critical:!0},{src:"dist-ts/tools/util.js",type:"module",critical:!0},{src:"dist-ts/core/result.js",type:"module",critical:!0},{src:"dist-ts/core/constants.js",type:"module",critical:!0},{src:"dist-ts/core/crypto.js",type:"module",critical:!0},{src:"dist-ts/tools/events.js",type:"module",critical:!0},{src:"dist-ts/tools/wps.js",type:"module",critical:!0},{src:"dist-ts/tools/http.js",type:"module"},{src:"dist-ts/ui/dialog.js",type:"module"},{src:"dist-ts/ui/message.js",type:"module"},{src:"dist-ts/ui/preview.js",type:"module"},{src:"dist-ts/sync/syncRecord.js",type:"module"},{src:"dist-ts/sync/scraping.js",type:"module"},{src:"dist-ts/sync/exceltobangumi.js",type:"module"},{src:"dist-ts/sync/githubSyncDiff.js",type:"module"},{src:"dist-ts/sync/githubConfig.js",type:"module"},{src:"dist-ts/sync/githubSync.js",type:"module"},{src:"dist-ts/services/ribbonService.js",type:"module"},{src:"dist-ts/entry/ribbon-entry.js",type:"module",critical:!0},{src:"dist-ts/ui/handlers.js",type:"module",critical:!0},{src:"dist-ts/panel/panelPage.js",type:"module",critical:!0}];window.__BGM_MODULE_STATUS__=M.map(function(e){return{src:e.src,loaded:!1,critical:e.critical||!1,error:void 0}});function j(e,o){return new Promise((t,d)=>{const n=document.createElement("script");n.src=e,o==="module"&&(n.type="module"),n.onload=()=>{console.log("[BGM] Loaded: "+e);var a=window.__BGM_MODULE_STATUS__,r=a.find(function(l){return l.src===e});r&&(r.loaded=!0),t()},n.onerror=a=>{console.error("[BGM] Failed to load: "+e,a);var r=window.__BGM_MODULE_STATUS__,l=r.find(function(i){return i.src===e});l&&(l.loaded=!1,l.error="Failed to load"),d(new Error("Failed to load script: "+e))},document.head.appendChild(n)})}async function S(){console.log("[BGM] Starting module loading...");for(const e of M)try{await j(e.src,e.type)}catch(o){if(console.error("[BGM] Module loading failed:",o),e.critical){document.body.innerHTML=`<div style="color:red;padding:20px;font-size:16px;">
                    <h3>核心模块加载失败</h3>
                    <p>模块: ${e.src}</p>
                    <p>${o.message}</p>
                    <p>请检查网络或文件完整性，然后重新加载。</p>
                </div>`;return}}console.log("[BGM] Module loading complete")}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",S):S();const P="modulepreload",A=function(e,o){return new URL(e,o).href},E={},C=function(o,t,d){let n=Promise.resolve();if(t&&t.length>0){let r=function(s){return Promise.all(s.map(b=>Promise.resolve(b).then(m=>({status:"fulfilled",value:m}),m=>({status:"rejected",reason:m}))))};const l=document.getElementsByTagName("link"),i=document.querySelector("meta[property=csp-nonce]"),c=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));n=r(t.map(s=>{if(s=A(s,d),s in E)return;E[s]=!0;const b=s.endsWith(".css"),m=b?'[rel="stylesheet"]':"";if(!!d)for(let u=l.length-1;u>=0;u--){const f=l[u];if(f.href===s&&(!b||f.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${s}"]${m}`))return;const p=document.createElement("link");if(p.rel=b?"stylesheet":P,b||(p.as="script"),p.crossOrigin="",p.href=s,c&&p.setAttribute("nonce",c),document.head.appendChild(p),b)return new Promise((u,f)=>{p.addEventListener("load",u),p.addEventListener("error",()=>f(new Error(`Unable to preload CSS for ${s}`)))})}))}function a(r){const l=new Event("vite:preloadError",{cancelable:!0});if(l.payload=r,window.dispatchEvent(l),!l.defaultPrevented)throw r}return n.then(r=>{for(const l of r||[])l.status==="rejected"&&a(l.reason);return o().catch(a)})},T=[{id:"btnShowPanel",label:"打开同步面板",icon:"📋"},{id:"btnSyncBangumi",label:"上传同步",icon:"🔄"},{id:"btnSetToken",label:"设置 Token",icon:"🔑"},{id:"btnTestToken",label:"测试 Token",icon:"🧪"},{id:"btnCopyToken",label:"复制 Token",icon:"📋"},{id:"btnSetUserId",label:"设置用户 ID",icon:"👤"},{id:"btnOpenCollection",label:"打开收藏页",icon:"🔗"},{id:"btnSyncFromGithub",label:"数据同步",icon:"📥"},{id:"btnUndoLastSync",label:"撤销同步",icon:"↩️"}],z=[{label:"全部",level:void 0},{label:"Info",level:"INFO"},{label:"Warn",level:"WARN"},{label:"Error",level:"ERROR"}];function q(){return typeof window.WpsInvoke>"u"}function g(){return window.__BGM_MODULE_STATUS__??[]}let v=null;async function L(){if(v)return v;try{return v=await C(()=>import("./logger.brLqLACF.js"),[],import.meta.url),v}catch{return null}}const G=`
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
`;function U(){return`
    <div class="bgm-dp-header">
      <div class="bgm-dp-header-left">
        <div class="bgm-dp-logo">BGM</div>
        <span class="bgm-dp-title">调试面板</span>
      </div>
      <button class="bgm-dp-toggle" id="bgm-dp-collapse" title="收起">▶</button>
    </div>
  `}function h(e){const o=e.filter(r=>r.loaded).length,t=e.filter(r=>!r.loaded),d=t.filter(r=>r.critical),n=typeof window._bgmRibbonReady=="function",a=[];return a.push(`<span class="bgm-dp-badge ${n?"bgm-dp-badge-ok":"bgm-dp-badge-err"}">${n?"● Ribbon 就绪":"○ Ribbon 未就绪"}</span>`),t.length>0&&a.push(`<span class="bgm-dp-badge ${d.length>0?"bgm-dp-badge-err":"bgm-dp-badge-warn"}">${t.length} 模块失败</span>`),a.push(`<span class="bgm-dp-badge bgm-dp-badge-muted">${o}/${e.length} 已加载</span>`),`<div class="bgm-dp-statusbar">${a.join("")}</div>`}function B(e){return`
    <div class="bgm-dp-tabs">
      <button class="bgm-dp-tab active" data-tab="modules">模块状态<span class="bgm-dp-tab-count">${g().length}</span></button>
      <button class="bgm-dp-tab" data-tab="ribbon">Ribbon 测试<span class="bgm-dp-tab-count">${T.length}</span></button>
      <button class="bgm-dp-tab" data-tab="console">控制台日志<span class="bgm-dp-tab-count">${e}</span></button>
      <button class="bgm-dp-tab" data-tab="env">环境信息</button>
    </div>
  `}function w(){const e=g();return e.length===0?'<div class="bgm-dp-panel active" data-panel="modules"><p style="color:#64748b;text-align:center;padding:20px;">等待模块加载...</p></div>':`<div class="bgm-dp-panel active" data-panel="modules"><div class="bgm-dp-mod-grid">${e.map(t=>`
      <div class="bgm-dp-mod-item">
        <span class="bgm-dp-mod-dot ${t.loaded?"bgm-dp-mod-dot-ok":"bgm-dp-mod-dot-err"}"></span>
        <span class="bgm-dp-mod-name">${t.src}${t.error?" — "+t.error:""}</span>
        ${t.critical?'<span class="bgm-dp-mod-tag bgm-dp-mod-tag-critical">critical</span>':""}
      </div>
    `).join("")}</div></div>`}function D(){return`<div class="bgm-dp-panel" data-panel="ribbon"><div class="bgm-dp-ribbon-grid">${T.map(o=>`
    <div class="bgm-dp-ribbon-card" data-btn="${o.id}">
      <div class="bgm-dp-ribbon-icon">${o.icon}</div>
      <div class="bgm-dp-ribbon-label">${o.label}</div>
      <div class="bgm-dp-ribbon-id">${o.id}</div>
      <div class="bgm-dp-ribbon-result" data-result="${o.id}">—</div>
      <div class="bgm-dp-ribbon-imgurl" data-imgurl="${o.id}"></div>
    </div>
  `).join("")}</div></div>`}function H(){return`
    <div class="bgm-dp-panel" data-panel="console">
      <div class="bgm-dp-log-filter">
        ${z.map((o,t)=>`<button class="bgm-dp-filter-btn ${t===0?"active":""}" data-level="${o.level??"all"}">${o.label}</button>`).join("")}
        <div class="bgm-dp-log-actions">
          <button class="bgm-dp-log-btn" id="bgm-dp-log-clear">清空</button>
          <button class="bgm-dp-log-btn bgm-dp-log-btn-primary" id="bgm-dp-log-export">导出</button>
        </div>
      </div>
      <div class="bgm-dp-console" id="bgm-dp-console-box">
        <div class="bgm-dp-log-empty">加载中...</div>
      </div>
    </div>
  `}function O(){const e=window;return`
    <div class="bgm-dp-panel" data-panel="env">
      <div class="bgm-dp-env-grid">${[{label:"页面 URL",value:e.location.href,cls:""},{label:"WpsInvoke",value:typeof e.WpsInvoke>"u"?"undefined (开发模式)":"available",cls:typeof e.WpsInvoke>"u"?"bgm-dp-env-value-warn":"bgm-dp-env-value-ok"},{label:"Ribbon 就绪 (_ribbonReady)",value:String(e._ribbonReady??!1),cls:e._ribbonReady?"bgm-dp-env-value-ok":"bgm-dp-env-value-err"},{label:"OnAddinLoad",value:typeof e.OnAddinLoad,cls:typeof e.OnAddinLoad=="function"?"bgm-dp-env-value-ok":"bgm-dp-env-value-err"},{label:"OnAction",value:typeof e.OnAction,cls:typeof e.OnAction=="function"?"bgm-dp-env-value-ok":"bgm-dp-env-value-err"},{label:"GetBangumiImage",value:typeof e.GetBangumiImage,cls:typeof e.GetBangumiImage=="function"?"bgm-dp-env-value-ok":"bgm-dp-env-value-err"},{label:"GetIncrementalSyncPressed",value:typeof e.GetIncrementalSyncPressed,cls:typeof e.GetIncrementalSyncPressed=="function"?"bgm-dp-env-value-ok":"bgm-dp-env-value-err"},{label:"DOMPurify (window)",value:typeof e.DOMPurify,cls:typeof e.DOMPurify=="object"?"bgm-dp-env-value-ok":"bgm-dp-env-value-warn"},{label:"Zod (window.z)",value:typeof e.z,cls:typeof e.z=="object"?"bgm-dp-env-value-ok":"bgm-dp-env-value-warn"}].map(d=>`
      <div class="bgm-dp-env-card">
        <div class="bgm-dp-env-label">${d.label}</div>
        <div class="bgm-dp-env-value ${d.cls}">${d.value}</div>
      </div>
    `).join("")}</div>
      <div class="bgm-dp-env-actions">
        <button class="bgm-dp-action-btn" id="bgm-dp-refresh">🔄 刷新页面</button>
        <button class="bgm-dp-action-btn" id="bgm-dp-clear-cache">🧹 清除缓存并刷新</button>
        <button class="bgm-dp-action-btn" id="bgm-dp-export-report">📥 导出诊断报告</button>
        <button class="bgm-dp-action-btn bgm-dp-action-btn-primary" id="bgm-dp-reload-modules">▶ 重新加载所有模块</button>
      </div>
    </div>
  `}let _,y=null;function F(e){const o=e.querySelectorAll(".bgm-dp-tab"),t=e.querySelectorAll(".bgm-dp-panel");o.forEach(d=>{d.addEventListener("click",()=>{o.forEach(r=>r.classList.remove("active")),t.forEach(r=>r.classList.remove("active")),d.classList.add("active");const n=d.dataset.tab,a=e.querySelector(`[data-panel="${n}"]`);if(a&&a.classList.add("active"),n==="console"?I(e):k(),n==="env"){const r=e.querySelector('[data-panel="env"]');if(r){r.outerHTML=O();const l=e.querySelector('[data-panel="env"]');l&&l.classList.add("active"),R(e)}}})})}function N(e){e.querySelectorAll(".bgm-dp-ribbon-card").forEach(t=>{t.addEventListener("click",()=>{const d=t.dataset.btn;if(!d)return;const n=e.querySelector(`[data-result="${d}"]`),a=e.querySelector(`[data-imgurl="${d}"]`);if(n){n.textContent="▶ 调用中...",n.style.color="#64748b";try{const r=window;if(typeof r.GetBangumiImage=="function"){const l=r.GetBangumiImage({Id:d});a&&(a.textContent=l,a.title=l)}}catch{}setTimeout(()=>{const r=window;if(typeof r.OnAction=="function")try{r.OnAction({Id:d}),n.textContent="✅ 已调用",n.style.color="#16a34a"}catch(l){const i=l instanceof Error?l.message:String(l);n.textContent="❌ "+i,n.style.color="#dc2626"}else n.textContent="⚠️ OnAction 未定义",n.style.color="#d97706"},100)}})})}function W(e){const o=e.querySelectorAll(".bgm-dp-filter-btn");o.forEach(t=>{t.addEventListener("click",()=>{o.forEach(n=>n.classList.remove("active")),t.classList.add("active");const d=t.dataset.level;_=d==="all"?void 0:d,x(e)})})}function J(e){const o=e.querySelector("#bgm-dp-log-clear");o==null||o.addEventListener("click",async()=>{const d=await L();d&&(d.clearLogs(),x(e))});const t=e.querySelector("#bgm-dp-log-export");t==null||t.addEventListener("click",async()=>{const d=await L();d&&d.exportLogsToFile()})}async function x(e){const o=e.querySelector("#bgm-dp-console-box");if(!o)return;const t=await L();if(!t){o.innerHTML='<div class="bgm-dp-log-empty">logger 模块未加载</div>';return}const d=t.getRecentLogs(_,200);if(d.length===0){o.innerHTML='<div class="bgm-dp-log-empty">暂无日志</div>';return}const n=d.map(r=>{const l=new Date(r.timestamp),i=`${String(l.getMinutes()).padStart(2,"0")}:${String(l.getSeconds()).padStart(2,"0")}.${String(l.getMilliseconds()).padStart(3,"0").slice(0,2)}`,c=r.level.toUpperCase();return`<div class="bgm-dp-log-line">
        <span class="bgm-dp-log-time">${i}</span>
        <span class="bgm-dp-log-level bgm-dp-log-level-${c}">${c}</span>
        <span class="bgm-dp-log-msg">${X(r.message)}</span>
      </div>`}).join("");o.innerHTML=n,o.scrollTop=o.scrollHeight;const a=e.querySelector('.bgm-dp-tab[data-tab="console"] .bgm-dp-tab-count');if(a){const r=t.getRecentLogs(void 0,1e3);a.textContent=String(r.length)}}function I(e){k(),x(e),y=setInterval(()=>{x(e)},2e3)}function k(){y&&(clearInterval(y),y=null)}function R(e){const o=e.querySelector("#bgm-dp-refresh");o==null||o.addEventListener("click",()=>{window.location.reload()});const t=e.querySelector("#bgm-dp-clear-cache");t==null||t.addEventListener("click",()=>{window.location.href=window.location.origin+window.location.pathname+"?bust="+Date.now()});const d=e.querySelector("#bgm-dp-export-report");d==null||d.addEventListener("click",()=>{K()});const n=e.querySelector("#bgm-dp-reload-modules");n==null||n.addEventListener("click",()=>{window.location.reload()})}function K(){const e=window,o=g(),t={timestamp:new Date().toISOString(),url:e.location.href,userAgent:navigator.userAgent,wpsInvoke:typeof e.WpsInvoke,ribbonReady:e._ribbonReady??!1,callbacks:{OnAddinLoad:typeof e.OnAddinLoad,OnAction:typeof e.OnAction,GetBangumiImage:typeof e.GetBangumiImage,GetIncrementalSyncPressed:typeof e.GetIncrementalSyncPressed},domPurify:typeof e.DOMPurify,zod:typeof e.z,moduleStatuses:o},d=new Blob([JSON.stringify(t,null,2)],{type:"application/json;charset=utf-8"}),n=URL.createObjectURL(d),a=document.createElement("a");a.href=n,a.download=`bgm-diagnostic-${Date.now()}.json`,document.body.appendChild(a),a.click(),document.body.removeChild(a),URL.revokeObjectURL(n)}function V(e,o){const t=e.querySelector("#bgm-dp-collapse");t==null||t.addEventListener("click",()=>{e.classList.add("collapsed"),o.style.display="flex",k()}),o.addEventListener("click",()=>{e.classList.remove("collapsed"),o.style.display="none";const d=e.querySelector(".bgm-dp-tab.active");(d==null?void 0:d.dataset.tab)==="console"&&I(e)})}function X(e){const o=document.createElement("div");return o.textContent=e,o.innerHTML}function $(){if(!q()||document.getElementById("bgm-debug-panel-root"))return;const e=document.createElement("style");e.textContent=G,document.head.appendChild(e);const o=g(),t=document.createElement("div");t.id="bgm-debug-panel-root",t.className="bgm-dp-root",t.innerHTML=`
    ${U()}
    ${h(o)}
    ${B(0)}
    <div class="bgm-dp-body">
      ${w()}
      ${D()}
      ${H()}
      ${O()}
    </div>
  `,document.body.appendChild(t);const d=document.createElement("div");d.className="bgm-dp-fab",d.textContent="🐛",d.title="展开调试面板",d.style.display="none",document.body.appendChild(d),F(t),N(t),W(t),J(t),R(t),V(t,d),setTimeout(()=>{const a=g(),r=t.querySelector(".bgm-dp-statusbar");r&&(r.outerHTML=h(a));const l=t.querySelector('[data-panel="modules"]');l&&(l.outerHTML=w());const i=t.querySelector('.bgm-dp-tab[data-tab="modules"] .bgm-dp-tab-count');i&&(i.textContent=String(a.length))},500);const n=setInterval(()=>{const a=g();a.filter(s=>s.loaded).length===a.length&&a.length>0&&clearInterval(n);const i=t.querySelector(".bgm-dp-statusbar");i&&(i.outerHTML=h(a));const c=t.querySelector('.bgm-dp-panel.active[data-panel="modules"]');c&&(c.outerHTML=w())},3e3)}typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",$):$());
