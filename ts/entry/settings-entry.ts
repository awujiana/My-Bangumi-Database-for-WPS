/**
 * Settings 显式入口模块
 * @module entry/settings-entry
 * @description 设置面板的统一启动入口。
 *
 * 职责：
 *  1. 显式调用 initHandlers()，复用已有的事件处理逻辑。
 *  2. 调用 initSettingsPage() 加载已保存的配置到表单。
 *  3. 仅在浏览器上下文且当前页面为 settings.html 时自动启动。
 */

import { initHandlers } from '../ui/handlers/index.js'

/**
 * 判断当前是否为设置页面上下文（宽松匹配）。
 * 覆盖 WPS Task Pane 中可能的 URL 格式：
 *   - wps-local://.../settings.html
 *   - file:///.../settings.html
 *   - http://localhost/settings.html
 * 以及 document.title 包含 "设置" 的情况。
 */
function isSettingsContext(): boolean {
  if (typeof window === 'undefined') return false
  const loc = window.location
  if (loc.pathname.includes('settings.html')) return true
  if (loc.href.includes('settings.html')) return true
  if (document.title.includes('设置')) return true
  return false
}

/**
 * 设置页面初始化：加载已保存的配置到表单元素。
 *  - Token 状态（updateTokenStatus）
 *  - 用户信息（updateUserIdStatus）
 *  - 同步偏好（增量同步、跳过冲突、启用同步记录）
 *  - GitHub 配置（owner/repo/branch/path/strategy）
 */
function initSettingsPage(): void {
  // 1. 加载 Token 和用户信息状态
  // 这些函数使用 DOM ID 查找元素，settings.html 已使用与 panel.html 相同的 ID
  import('../ui/handlers/token.js')
    .then(({ updateTokenStatus, updateUserIdStatus }) => {
      updateTokenStatus()
      updateUserIdStatus()
    })
    .catch(() => {
      // 静默处理，token 状态在 initHandlers 中也会初始化
    })

  // 2. 加载同步偏好设置
  import('../tools/config.js')
    .then(
      ({
        getIncrementalSync,
        getSkipConflicts,
        getSyncRecordEnabled,
        getConfig,
        getNavIconsOnly,
      }) => {
        // 设置复选框
        const chkIncremental = document.getElementById(
          'chkIncrementalSync',
        ) as HTMLInputElement | null
        if (chkIncremental) chkIncremental.checked = getIncrementalSync(true)

        const chkSkip = document.getElementById('chkSkipConflicts') as HTMLInputElement | null
        if (chkSkip) chkSkip.checked = getSkipConflicts(true)

        const chkSyncRecord = document.getElementById(
          'chkEnableSyncRecord',
        ) as HTMLInputElement | null
        if (chkSyncRecord) chkSyncRecord.checked = getSyncRecordEnabled(true)

        const chkNavIcons = document.getElementById('chkNavIconsOnly') as HTMLInputElement | null
        if (chkNavIcons) chkNavIcons.checked = getNavIconsOnly(true)

        // 设置冲突策略下拉
        const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
        if (strategySelect) {
          const savedStrategy = getConfig('bgm_conflict_strategy', 'skip', true)
          strategySelect.value = savedStrategy
        }
      },
    )
    .catch(() => {
      // 静默处理
    })

  // 3. 加载 GitHub 配置
  import('../index.js')
    .then(({ getGithubConfig }) => {
      const cfg = getGithubConfig()
      const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
      if (ownerInput) ownerInput.value = cfg.owner || ''

      const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
      if (repoInput) repoInput.value = cfg.repo || ''

      const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
      if (branchInput) branchInput.value = cfg.branch || ''

      const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
      if (pathInput) pathInput.value = cfg.path || ''
    })
    .catch(() => {
      // 静默处理
    })
}

/**
 * 启动设置面板：执行 UI 事件处理初始化 + 设置页面初始化。
 * 完成后触发 bgm:modulesReady 事件，通知 panel/settingsBootstrap 入口启用按钮。
 */
export function startSettings(): void {
  initHandlers()
  initSettingsPage()
  // 通知模块就绪，启用按钮（与 panelPage.ts 的 initPanelCore 对齐）
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'))
    console.log('[BGM Settings] startSettings() 完成，bgm:modulesReady 已触发')
  }
}

// 仅在浏览器上下文且当前页面为设置页面时自动启动
if (isSettingsContext()) {
  startSettings()
}
