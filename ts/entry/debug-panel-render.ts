/**
 * @fileoverview 调试面板渲染层：宿主全局读取、常量与 HTML 模板构建。
 * @module debugPanelRender
 * @description
 *   - 与 `debug-panel.ts`（交互 / 生命周期 / 自动启动）分离，本模块**无 import 时副作用**，可直接单测。
 *   - `window` 上的调试全局集中经 `getDebugGlobals()` 单点断言，避免 `as unknown as` 散布全文件。
 */

// ========== 类型定义 ==========

export interface ModuleStatus {
  src: string
  loaded: boolean
  critical: boolean
  error?: string
}

export interface RibbonButtonInfo {
  id: string
  label: string
  icon: string
}

/** 调试面板读取的宿主 window 全局（形状集中在此单点断言） */
export interface DebugGlobals {
  WpsInvoke?: unknown
  _bgmRibbonReady?: (onAddinLoad: unknown, onAction: unknown, getImage: unknown) => void
  _ribbonReady?: boolean
  OnAddinLoad?: unknown
  OnAction?: (control: { Id: string }) => boolean
  GetBangumiImage?: (control: { Id: string }) => string
  GetIncrementalSyncPressed?: unknown
  DOMPurify?: unknown
  z?: unknown
  __BGM_MODULE_STATUS__?: ModuleStatus[]
}

/** 单点完成 `window → 已知形状` 断言（本文件唯一的 cast） */
export function getDebugGlobals(): DebugGlobals {
  return window as unknown as DebugGlobals
}

// ========== 常量 ==========

/** ribbon.xml 中定义的所有按钮（与 ribbon.ts icons map 同步） */
export const RIBBON_BUTTONS: readonly RibbonButtonInfo[] = [
  { id: 'btnShowPanel', label: '打开同步面板', icon: '📋' },
  { id: 'btnSyncBangumi', label: '上传同步', icon: '🔄' },
  { id: 'btnSetToken', label: '设置 Token', icon: '🔑' },
  { id: 'btnTestToken', label: '测试 Token', icon: '🧪' },
  { id: 'btnCopyToken', label: '复制 Token', icon: '📋' },
  { id: 'btnSetUserId', label: '设置用户 ID', icon: '👤' },
  { id: 'btnOpenCollection', label: '打开收藏页', icon: '🔗' },
  { id: 'btnSyncFromGithub', label: '数据同步', icon: '📥' },
  { id: 'btnUndoLastSync', label: '撤销同步', icon: '↩️' },
] as const

/** 日志级别筛选选项 */
export const LOG_FILTERS: readonly { label: string; level: string | undefined }[] = [
  { label: '全部', level: undefined },
  { label: 'Info', level: 'INFO' },
  { label: 'Warn', level: 'WARN' },
  { label: 'Error', level: 'ERROR' },
] as const

// ========== 环境检测 / 状态读取 ==========

/** 检测是否为调试环境（无 WpsInvoke 即为开发服务器） */
export function isDebugEnvironment(): boolean {
  return getDebugGlobals().WpsInvoke === undefined
}

/** 从 window.__BGM_MODULE_STATUS__ 读取模块加载状态 */
export function getModuleStatuses(): ModuleStatus[] {
  return getDebugGlobals().__BGM_MODULE_STATUS__ ?? []
}

// ========== 工具函数 ==========

export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ========== HTML 模板 ==========

export function buildHeaderHTML(): string {
  return `
    <div class="bgm-dp-header">
      <div class="bgm-dp-header-left">
        <div class="bgm-dp-logo">BGM</div>
        <span class="bgm-dp-title">调试面板</span>
      </div>
      <button class="bgm-dp-toggle" id="bgm-dp-collapse" title="收起">▶</button>
    </div>
  `
}

export function buildStatusBarHTML(modules: ModuleStatus[]): string {
  const loaded = modules.filter((m) => m.loaded).length
  const failed = modules.filter((m) => !m.loaded)
  const failedCritical = failed.filter((m) => m.critical)

  const isRibbonReady = typeof getDebugGlobals()._bgmRibbonReady === 'function'
  const badges: string[] = [
    `<span class="bgm-dp-badge ${isRibbonReady ? 'bgm-dp-badge-ok' : 'bgm-dp-badge-err'}">${isRibbonReady ? '● Ribbon 就绪' : '○ Ribbon 未就绪'}</span>`,
  ]
  if (failed.length > 0) {
    badges.push(
      `<span class="bgm-dp-badge ${failedCritical.length > 0 ? 'bgm-dp-badge-err' : 'bgm-dp-badge-warn'}">${String(failed.length)} 模块失败</span>`,
    )
  }
  badges.push(
    `<span class="bgm-dp-badge bgm-dp-badge-muted">${String(loaded)}/${String(modules.length)} 已加载</span>`,
  )

  return `<div class="bgm-dp-statusbar">${badges.join('')}</div>`
}

export function buildTabsHTML(logCount: number): string {
  const modules = getModuleStatuses()
  return `
    <div class="bgm-dp-tabs">
      <button class="bgm-dp-tab active" data-tab="modules">模块状态<span class="bgm-dp-tab-count">${String(modules.length)}</span></button>
      <button class="bgm-dp-tab" data-tab="ribbon">Ribbon 测试<span class="bgm-dp-tab-count">${String(RIBBON_BUTTONS.length)}</span></button>
      <button class="bgm-dp-tab" data-tab="console">控制台日志<span class="bgm-dp-tab-count">${String(logCount)}</span></button>
      <button class="bgm-dp-tab" data-tab="env">环境信息</button>
    </div>
  `
}

export function buildModulesPanelHTML(): string {
  const modules = getModuleStatuses()
  if (modules.length === 0) {
    return `<div class="bgm-dp-panel active" data-panel="modules"><p style="color:#64748b;text-align:center;padding:20px;">等待模块加载...</p></div>`
  }
  const items = modules
    .map(
      (m) => `
      <div class="bgm-dp-mod-item">
        <span class="bgm-dp-mod-dot ${m.loaded ? 'bgm-dp-mod-dot-ok' : 'bgm-dp-mod-dot-err'}"></span>
        <span class="bgm-dp-mod-name">${m.src}${m.error ? ` — ${m.error}` : ''}</span>
        ${m.critical ? '<span class="bgm-dp-mod-tag bgm-dp-mod-tag-critical">critical</span>' : ''}
      </div>
    `,
    )
    .join('')
  return `<div class="bgm-dp-panel active" data-panel="modules"><div class="bgm-dp-mod-grid">${items}</div></div>`
}

export function buildRibbonPanelHTML(): string {
  const cards = RIBBON_BUTTONS.map(
    (button) => `
    <div class="bgm-dp-ribbon-card" data-btn="${button.id}">
      <div class="bgm-dp-ribbon-icon">${button.icon}</div>
      <div class="bgm-dp-ribbon-label">${button.label}</div>
      <div class="bgm-dp-ribbon-id">${button.id}</div>
      <div class="bgm-dp-ribbon-result" data-result="${button.id}">—</div>
      <div class="bgm-dp-ribbon-imgurl" data-imgurl="${button.id}"></div>
    </div>
  `,
  ).join('')
  return `<div class="bgm-dp-panel" data-panel="ribbon"><div class="bgm-dp-ribbon-grid">${cards}</div></div>`
}

export function buildConsolePanelHTML(): string {
  const filters = LOG_FILTERS.map(
    (f, index) =>
      `<button class="bgm-dp-filter-btn ${index === 0 ? 'active' : ''}" data-level="${f.level ?? 'all'}">${f.label}</button>`,
  ).join('')
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
  `
}

export function buildEnvironmentPanelHTML(): string {
  const g = getDebugGlobals()
  const environmentItems: { label: string; value: string; cls: string }[] = [
    { label: '页面 URL', value: window.location.href, cls: '' },
    {
      label: 'WpsInvoke',
      value: g.WpsInvoke === undefined ? 'undefined (开发模式)' : 'available',
      cls: g.WpsInvoke === undefined ? 'bgm-dp-env-value-warn' : 'bgm-dp-env-value-ok',
    },
    {
      label: 'Ribbon 就绪 (_ribbonReady)',
      value: String(g._ribbonReady ?? false),
      cls: g._ribbonReady ? 'bgm-dp-env-value-ok' : 'bgm-dp-env-value-err',
    },
    {
      label: 'OnAddinLoad',
      value: typeof g.OnAddinLoad,
      cls: typeof g.OnAddinLoad === 'function' ? 'bgm-dp-env-value-ok' : 'bgm-dp-env-value-err',
    },
    {
      label: 'OnAction',
      value: typeof g.OnAction,
      cls: typeof g.OnAction === 'function' ? 'bgm-dp-env-value-ok' : 'bgm-dp-env-value-err',
    },
    {
      label: 'GetBangumiImage',
      value: typeof g.GetBangumiImage,
      cls:
        typeof g.GetBangumiImage === 'function' ? 'bgm-dp-env-value-ok' : 'bgm-dp-env-value-err',
    },
    {
      label: 'GetIncrementalSyncPressed',
      value: typeof g.GetIncrementalSyncPressed,
      cls:
        typeof g.GetIncrementalSyncPressed === 'function'
          ? 'bgm-dp-env-value-ok'
          : 'bgm-dp-env-value-err',
    },
    {
      label: 'DOMPurify (window)',
      value: typeof g.DOMPurify,
      cls: typeof g.DOMPurify === 'object' ? 'bgm-dp-env-value-ok' : 'bgm-dp-env-value-warn',
    },
    {
      label: 'Zod (window.z)',
      value: typeof g.z,
      cls: typeof g.z === 'object' ? 'bgm-dp-env-value-ok' : 'bgm-dp-env-value-warn',
    },
  ]

  const cards = environmentItems
    .map(
      (item) => `
      <div class="bgm-dp-env-card">
        <div class="bgm-dp-env-label">${item.label}</div>
        <div class="bgm-dp-env-value ${item.cls}">${item.value}</div>
      </div>
    `,
    )
    .join('')

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
  `
}
