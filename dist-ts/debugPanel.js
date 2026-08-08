/**
 * @fileoverview 调试面板 - 仅在开发服务器环境显示
 * @module debugPanel
 * @description
 *   - 环境检测：typeof WpsInvoke === 'undefined' 时激活
 *   - 四个功能区：模块状态、Ribbon 测试、控制台日志、环境信息
 *   - 无侵入：不修改现有模块逻辑，仅读取状态
 */
// ========== 常量 ==========
/** ribbon.xml 中定义的所有按钮（与 ribbon.ts icons map 同步） */
const RIBBON_BUTTONS = [
    { id: 'btnShowPanel', label: '打开同步面板', icon: '📋' },
    { id: 'btnSyncBangumi', label: '上传同步', icon: '🔄' },
    { id: 'btnSetToken', label: '设置 Token', icon: '🔑' },
    { id: 'btnTestToken', label: '测试 Token', icon: '🧪' },
    { id: 'btnCopyToken', label: '复制 Token', icon: '📋' },
    { id: 'btnSetUserId', label: '设置用户 ID', icon: '👤' },
    { id: 'btnOpenCollection', label: '打开收藏页', icon: '🔗' },
    { id: 'btnSyncFromGithub', label: '数据同步', icon: '📥' },
    { id: 'btnUndoLastSync', label: '撤销同步', icon: '↩️' },
];
/** 日志级别筛选选项 */
const LOG_FILTERS = [
    { label: '全部', level: undefined },
    { label: 'Info', level: 'INFO' },
    { label: 'Warn', level: 'WARN' },
    { label: 'Error', level: 'ERROR' },
];
// ========== 环境检测 ==========
/** 检测是否为调试环境（无 WpsInvoke 即为开发服务器） */
function isDebugEnvironment() {
    return typeof window.WpsInvoke === 'undefined';
}
// ========== 状态读取 ==========
/** 从 window.__BGM_MODULE_STATUS__ 读取模块加载状态 */
function getModuleStatuses() {
    const raw = window
        .__BGM_MODULE_STATUS__;
    return raw ?? [];
}
/** 动态加载 logger 模块并获取引用 */
let _logger = null;
async function getLogger() {
    if (_logger)
        return _logger;
    try {
        const mod = await import('./tools/logger.js');
        _logger = mod;
        return _logger;
    }
    catch {
        return null;
    }
}
// ========== 样式 ==========
const PANEL_CSS = `
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
`;
// ========== HTML 模板 ==========
function buildHeaderHTML() {
    return `
    <div class="bgm-dp-header">
      <div class="bgm-dp-header-left">
        <div class="bgm-dp-logo">BGM</div>
        <span class="bgm-dp-title">调试面板</span>
      </div>
      <button class="bgm-dp-toggle" id="bgm-dp-collapse" title="收起">▶</button>
    </div>
  `;
}
function buildStatusBarHTML(modules) {
    const loaded = modules.filter((m) => m.loaded).length;
    const failed = modules.filter((m) => !m.loaded);
    const failedCritical = failed.filter((m) => m.critical);
    const ribbonReady = typeof window._bgmRibbonReady === 'function';
    const badges = [];
    badges.push(`<span class="bgm-dp-badge ${ribbonReady ? 'bgm-dp-badge-ok' : 'bgm-dp-badge-err'}">${ribbonReady ? '● Ribbon 就绪' : '○ Ribbon 未就绪'}</span>`);
    if (failed.length > 0) {
        badges.push(`<span class="bgm-dp-badge ${failedCritical.length > 0 ? 'bgm-dp-badge-err' : 'bgm-dp-badge-warn'}">${failed.length} 模块失败</span>`);
    }
    badges.push(`<span class="bgm-dp-badge bgm-dp-badge-muted">${loaded}/${modules.length} 已加载</span>`);
    return `<div class="bgm-dp-statusbar">${badges.join('')}</div>`;
}
function buildTabsHTML(logCount) {
    const modules = getModuleStatuses();
    return `
    <div class="bgm-dp-tabs">
      <button class="bgm-dp-tab active" data-tab="modules">模块状态<span class="bgm-dp-tab-count">${modules.length}</span></button>
      <button class="bgm-dp-tab" data-tab="ribbon">Ribbon 测试<span class="bgm-dp-tab-count">${RIBBON_BUTTONS.length}</span></button>
      <button class="bgm-dp-tab" data-tab="console">控制台日志<span class="bgm-dp-tab-count">${logCount}</span></button>
      <button class="bgm-dp-tab" data-tab="env">环境信息</button>
    </div>
  `;
}
function buildModulesPanelHTML() {
    const modules = getModuleStatuses();
    if (modules.length === 0) {
        return `<div class="bgm-dp-panel active" data-panel="modules"><p style="color:#64748b;text-align:center;padding:20px;">等待模块加载...</p></div>`;
    }
    const items = modules
        .map((m) => `
      <div class="bgm-dp-mod-item">
        <span class="bgm-dp-mod-dot ${m.loaded ? 'bgm-dp-mod-dot-ok' : 'bgm-dp-mod-dot-err'}"></span>
        <span class="bgm-dp-mod-name">${m.src}${m.error ? ' — ' + m.error : ''}</span>
        ${m.critical ? '<span class="bgm-dp-mod-tag bgm-dp-mod-tag-critical">critical</span>' : ''}
      </div>
    `)
        .join('');
    return `<div class="bgm-dp-panel active" data-panel="modules"><div class="bgm-dp-mod-grid">${items}</div></div>`;
}
function buildRibbonPanelHTML() {
    const cards = RIBBON_BUTTONS.map((btn) => `
    <div class="bgm-dp-ribbon-card" data-btn="${btn.id}">
      <div class="bgm-dp-ribbon-icon">${btn.icon}</div>
      <div class="bgm-dp-ribbon-label">${btn.label}</div>
      <div class="bgm-dp-ribbon-id">${btn.id}</div>
      <div class="bgm-dp-ribbon-result" data-result="${btn.id}">—</div>
      <div class="bgm-dp-ribbon-imgurl" data-imgurl="${btn.id}"></div>
    </div>
  `).join('');
    return `<div class="bgm-dp-panel" data-panel="ribbon"><div class="bgm-dp-ribbon-grid">${cards}</div></div>`;
}
function buildConsolePanelHTML() {
    const filters = LOG_FILTERS.map((f, i) => `<button class="bgm-dp-filter-btn ${i === 0 ? 'active' : ''}" data-level="${f.level ?? 'all'}">${f.label}</button>`).join('');
    return `
    <div class="bgm-dp-panel" data-panel="console">
      <div class="bgm-dp-log-filter">
        ${filters}
        <div class="bgm-dp-log-actions">
          <button class="bgm-dp-log-btn" id="bgm-dp-log-clear">清空</button>
          <button class="bgm-dp-log-btn bgm-dp-log-btn-primary" id="bgm-dp-log-export">导出</button>
        </div>
      </div>
      <div class="bgm-dp-console" id="bgm-dp-console-box">
        <div class="bgm-dp-log-empty">加载中...</div>
      </div>
    </div>
  `;
}
function buildEnvPanelHTML() {
    const w = window;
    const envItems = [
        { label: '页面 URL', value: w.location.href, cls: '' },
        {
            label: 'WpsInvoke',
            value: typeof w.WpsInvoke === 'undefined'
                ? 'undefined (开发模式)'
                : 'available',
            cls: typeof w.WpsInvoke === 'undefined'
                ? 'bgm-dp-env-value-warn'
                : 'bgm-dp-env-value-ok',
        },
        {
            label: 'Ribbon 就绪 (_ribbonReady)',
            value: String(w._ribbonReady ?? false),
            cls: w._ribbonReady
                ? 'bgm-dp-env-value-ok'
                : 'bgm-dp-env-value-err',
        },
        {
            label: 'OnAddinLoad',
            value: typeof w.OnAddinLoad,
            cls: typeof w.OnAddinLoad === 'function'
                ? 'bgm-dp-env-value-ok'
                : 'bgm-dp-env-value-err',
        },
        {
            label: 'OnAction',
            value: typeof w.OnAction,
            cls: typeof w.OnAction === 'function'
                ? 'bgm-dp-env-value-ok'
                : 'bgm-dp-env-value-err',
        },
        {
            label: 'GetBangumiImage',
            value: typeof w.GetBangumiImage,
            cls: typeof w.GetBangumiImage === 'function'
                ? 'bgm-dp-env-value-ok'
                : 'bgm-dp-env-value-err',
        },
        {
            label: 'GetIncrementalSyncPressed',
            value: typeof w
                .GetIncrementalSyncPressed,
            cls: typeof w
                .GetIncrementalSyncPressed === 'function'
                ? 'bgm-dp-env-value-ok'
                : 'bgm-dp-env-value-err',
        },
        {
            label: 'DOMPurify (window)',
            value: typeof w.DOMPurify,
            cls: typeof w.DOMPurify === 'object'
                ? 'bgm-dp-env-value-ok'
                : 'bgm-dp-env-value-warn',
        },
        {
            label: 'Zod (window.z)',
            value: typeof w.z,
            cls: typeof w.z === 'object'
                ? 'bgm-dp-env-value-ok'
                : 'bgm-dp-env-value-warn',
        },
    ];
    const cards = envItems
        .map((item) => `
      <div class="bgm-dp-env-card">
        <div class="bgm-dp-env-label">${item.label}</div>
        <div class="bgm-dp-env-value ${item.cls}">${item.value}</div>
      </div>
    `)
        .join('');
    return `
    <div class="bgm-dp-panel" data-panel="env">
      <div class="bgm-dp-env-grid">${cards}</div>
      <div class="bgm-dp-env-actions">
        <button class="bgm-dp-action-btn" id="bgm-dp-refresh">🔄 刷新页面</button>
        <button class="bgm-dp-action-btn" id="bgm-dp-clear-cache">🧹 清除缓存并刷新</button>
        <button class="bgm-dp-action-btn" id="bgm-dp-export-report">📥 导出诊断报告</button>
        <button class="bgm-dp-action-btn bgm-dp-action-btn-primary" id="bgm-dp-reload-modules">▶ 重新加载所有模块</button>
      </div>
    </div>
  `;
}
// ========== 交互逻辑 ==========
/** 当前日志筛选级别 */
let _currentLogLevel = undefined;
/** 日志轮询定时器 */
let _logInterval = null;
/** 切换 Tab */
function bindTabs(root) {
    const tabs = root.querySelectorAll('.bgm-dp-tab');
    const panels = root.querySelectorAll('.bgm-dp-panel');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.remove('active'));
            panels.forEach((p) => p.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            const panel = root.querySelector(`[data-panel="${target}"]`);
            if (panel)
                panel.classList.add('active');
            // 启动/停止日志轮询
            if (target === 'console') {
                startLogPolling(root);
            }
            else {
                stopLogPolling();
            }
            // 环境信息 Tab 切换时刷新内容（反映最新状态）
            if (target === 'env') {
                const envPanel = root.querySelector('[data-panel="env"]');
                if (envPanel) {
                    envPanel.outerHTML = buildEnvPanelHTML();
                    // outerHTML 替换后重新获取元素并标记 active
                    const newEnvPanel = root.querySelector('[data-panel="env"]');
                    if (newEnvPanel) {
                        newEnvPanel.classList.add('active');
                    }
                    // 重新绑定环境信息按钮事件
                    bindEnvActions(root);
                }
            }
        });
    });
}
/** Ribbon 按钮点击测试 */
function bindRibbonCards(root) {
    const cards = root.querySelectorAll('.bgm-dp-ribbon-card');
    cards.forEach((card) => {
        card.addEventListener('click', () => {
            const btnId = card.dataset.btn;
            if (!btnId)
                return;
            const resultEl = root.querySelector(`[data-result="${btnId}"]`);
            const imgUrlEl = root.querySelector(`[data-imgurl="${btnId}"]`);
            if (!resultEl)
                return;
            resultEl.textContent = '▶ 调用中...';
            resultEl.style.color = '#64748b';
            // 测试 GetBangumiImage
            try {
                const w = window;
                if (typeof w.GetBangumiImage === 'function') {
                    const imgUrl = w.GetBangumiImage({ Id: btnId });
                    if (imgUrlEl) {
                        imgUrlEl.textContent = imgUrl;
                        imgUrlEl.title = imgUrl;
                    }
                }
            }
            catch {
                // ignore
            }
            // 测试 OnAction
            setTimeout(() => {
                const w2 = window;
                if (typeof w2.OnAction === 'function') {
                    try {
                        w2.OnAction({ Id: btnId });
                        resultEl.textContent = '✅ 已调用';
                        resultEl.style.color = '#16a34a';
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        resultEl.textContent = '❌ ' + msg;
                        resultEl.style.color = '#dc2626';
                    }
                }
                else {
                    resultEl.textContent = '⚠️ OnAction 未定义';
                    resultEl.style.color = '#d97706';
                }
            }, 100);
        });
    });
}
/** 日志筛选 */
function bindLogFilters(root) {
    const filters = root.querySelectorAll('.bgm-dp-filter-btn');
    filters.forEach((btn) => {
        btn.addEventListener('click', () => {
            filters.forEach((f) => f.classList.remove('active'));
            btn.classList.add('active');
            const level = btn.dataset.level;
            _currentLogLevel = level === 'all' ? undefined : level;
            refreshLogs(root);
        });
    });
}
/** 日志清空和导出 */
function bindLogActions(root) {
    const clearBtn = root.querySelector('#bgm-dp-log-clear');
    clearBtn?.addEventListener('click', async () => {
        const logger = await getLogger();
        if (logger) {
            logger.clearLogs();
            refreshLogs(root);
        }
    });
    const exportBtn = root.querySelector('#bgm-dp-log-export');
    exportBtn?.addEventListener('click', async () => {
        const logger = await getLogger();
        if (logger) {
            logger.exportLogsToFile();
        }
    });
}
/** 刷新日志显示 */
async function refreshLogs(root) {
    const box = root.querySelector('#bgm-dp-console-box');
    if (!box)
        return;
    const logger = await getLogger();
    if (!logger) {
        box.innerHTML = '<div class="bgm-dp-log-empty">logger 模块未加载</div>';
        return;
    }
    const logs = logger.getRecentLogs(_currentLogLevel, 200);
    if (logs.length === 0) {
        box.innerHTML = '<div class="bgm-dp-log-empty">暂无日志</div>';
        return;
    }
    const lines = logs
        .map((log) => {
        const time = new Date(log.timestamp);
        const ts = `${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}.${String(time.getMilliseconds()).padStart(3, '0').slice(0, 2)}`;
        const level = log.level.toUpperCase();
        return `<div class="bgm-dp-log-line">
        <span class="bgm-dp-log-time">${ts}</span>
        <span class="bgm-dp-log-level bgm-dp-log-level-${level}">${level}</span>
        <span class="bgm-dp-log-msg">${escapeHtml(log.message)}</span>
      </div>`;
    })
        .join('');
    box.innerHTML = lines;
    // 自动滚动到底部
    box.scrollTop = box.scrollHeight;
    // 更新 Tab 计数
    const tabCount = root.querySelector('.bgm-dp-tab[data-tab="console"] .bgm-dp-tab-count');
    if (tabCount) {
        const allLogs = logger.getRecentLogs(undefined, 1000);
        tabCount.textContent = String(allLogs.length);
    }
}
/** 启动日志轮询 */
function startLogPolling(root) {
    stopLogPolling();
    refreshLogs(root);
    _logInterval = setInterval(() => {
        refreshLogs(root);
    }, 2000);
}
/** 停止日志轮询 */
function stopLogPolling() {
    if (_logInterval) {
        clearInterval(_logInterval);
        _logInterval = null;
    }
}
/** 环境信息操作按钮 */
function bindEnvActions(root) {
    const refreshBtn = root.querySelector('#bgm-dp-refresh');
    refreshBtn?.addEventListener('click', () => {
        window.location.reload();
    });
    const clearCacheBtn = root.querySelector('#bgm-dp-clear-cache');
    clearCacheBtn?.addEventListener('click', () => {
        // 添加 cache-busting 参数强制刷新
        window.location.href = window.location.origin + window.location.pathname + '?bust=' + Date.now();
    });
    const exportReportBtn = root.querySelector('#bgm-dp-export-report');
    exportReportBtn?.addEventListener('click', () => {
        exportDiagnosticReport();
    });
    const reloadBtn = root.querySelector('#bgm-dp-reload-modules');
    reloadBtn?.addEventListener('click', () => {
        window.location.reload();
    });
}
/** 导出诊断报告（JSON 文件下载） */
function exportDiagnosticReport() {
    const w = window;
    const modules = getModuleStatuses();
    const report = {
        timestamp: new Date().toISOString(),
        url: w.location.href,
        userAgent: navigator.userAgent,
        wpsInvoke: typeof w.WpsInvoke,
        ribbonReady: w._ribbonReady ?? false,
        callbacks: {
            OnAddinLoad: typeof w.OnAddinLoad,
            OnAction: typeof w.OnAction,
            GetBangumiImage: typeof w.GetBangumiImage,
            GetIncrementalSyncPressed: typeof w.GetIncrementalSyncPressed,
        },
        domPurify: typeof w.DOMPurify,
        zod: typeof w.z,
        moduleStatuses: modules,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bgm-diagnostic-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
/** 折叠/展开 */
function bindCollapse(root, fab) {
    const collapseBtn = root.querySelector('#bgm-dp-collapse');
    collapseBtn?.addEventListener('click', () => {
        root.classList.add('collapsed');
        fab.style.display = 'flex';
        stopLogPolling();
    });
    fab.addEventListener('click', () => {
        root.classList.remove('collapsed');
        fab.style.display = 'none';
        // 如果当前在 console tab，恢复轮询
        const activeTab = root.querySelector('.bgm-dp-tab.active');
        if (activeTab?.dataset.tab === 'console') {
            startLogPolling(root);
        }
    });
}
// ========== 工具函数 ==========
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
// ========== 主入口 ==========
export function initDebugPanel() {
    if (!isDebugEnvironment())
        return;
    if (document.getElementById('bgm-debug-panel-root'))
        return;
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    const modules = getModuleStatuses();
    const root = document.createElement('div');
    root.id = 'bgm-debug-panel-root';
    root.className = 'bgm-dp-root';
    root.innerHTML = `
    ${buildHeaderHTML()}
    ${buildStatusBarHTML(modules)}
    ${buildTabsHTML(0)}
    <div class="bgm-dp-body">
      ${buildModulesPanelHTML()}
      ${buildRibbonPanelHTML()}
      ${buildConsolePanelHTML()}
      ${buildEnvPanelHTML()}
    </div>
  `;
    document.body.appendChild(root);
    // 折叠态浮动按钮
    const fab = document.createElement('div');
    fab.className = 'bgm-dp-fab';
    fab.textContent = '🐛';
    fab.title = '展开调试面板';
    fab.style.display = 'none';
    document.body.appendChild(fab);
    // 绑定交互
    bindTabs(root);
    bindRibbonCards(root);
    bindLogFilters(root);
    bindLogActions(root);
    bindEnvActions(root);
    bindCollapse(root, fab);
    // 延迟刷新模块状态（等 main.js 写入状态）
    setTimeout(() => {
        const newModules = getModuleStatuses();
        const statusbar = root.querySelector('.bgm-dp-statusbar');
        if (statusbar) {
            statusbar.outerHTML = buildStatusBarHTML(newModules);
        }
        const modPanel = root.querySelector('[data-panel="modules"]');
        if (modPanel) {
            modPanel.outerHTML = buildModulesPanelHTML();
        }
        // 更新 Tab 计数
        const modTabCount = root.querySelector('.bgm-dp-tab[data-tab="modules"] .bgm-dp-tab-count');
        if (modTabCount) {
            modTabCount.textContent = String(newModules.length);
        }
    }, 500);
    // 定期刷新状态栏（每 3 秒，反映模块加载进度）
    const statusInterval = setInterval(() => {
        const newModules = getModuleStatuses();
        const loaded = newModules.filter((m) => m.loaded).length;
        const allLoaded = loaded === newModules.length && newModules.length > 0;
        if (allLoaded) {
            clearInterval(statusInterval);
        }
        // 刷新状态栏
        const newStatusbar = root.querySelector('.bgm-dp-statusbar');
        if (newStatusbar) {
            newStatusbar.outerHTML = buildStatusBarHTML(newModules);
        }
        // 刷新模块面板（如果当前可见）
        const modPanelActive = root.querySelector('.bgm-dp-panel.active[data-panel="modules"]');
        if (modPanelActive) {
            modPanelActive.outerHTML = buildModulesPanelHTML();
        }
    }, 3000);
}
// ========== 自动启动 ==========
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDebugPanel);
    }
    else {
        initDebugPanel();
    }
}
