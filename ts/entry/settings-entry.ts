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

import { areNavIconsOnly } from '../tools/config.js'
import { initTheme } from '../tools/theme.js'
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
        isIncrementalSyncEnabled,
        isSkipConflictsEnabled,
        isSyncRecordEnabled,
        getConfig,
        areNavIconsOnly,
      }) => {
        // 设置复选框
        const chkIncremental = document.getElementById(
          'chkIncrementalSync',
        ) as HTMLInputElement | null
        if (chkIncremental) chkIncremental.checked = isIncrementalSyncEnabled(true)

        const chkSkip = document.getElementById('chkSkipConflicts') as HTMLInputElement | null
        if (chkSkip) chkSkip.checked = isSkipConflictsEnabled(true)

        const chkSyncRecord = document.getElementById(
          'chkEnableSyncRecord',
        ) as HTMLInputElement | null
        if (chkSyncRecord) chkSyncRecord.checked = isSyncRecordEnabled(true)

        const chkNavIcons = document.getElementById('chkNavIconsOnly') as HTMLInputElement | null
        if (chkNavIcons) chkNavIcons.checked = areNavIconsOnly(true)

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
      const config = getGithubConfig()
      const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
      if (ownerInput) ownerInput.value = config.owner || ''

      const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
      if (repoInput) repoInput.value = config.repo || ''

      const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
      if (branchInput) branchInput.value = config.branch || ''

      const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
      if (pathInput) pathInput.value = config.path || ''
    })
    .catch(() => {
      // 静默处理
    })
}

/**
 * 应用外观主题与导航显示模式，并初始化滚动高亮（scrollspy）。
 */
function applyAppearance(): void {
  if (typeof document === 'undefined') return
  // 主题：从配置读取并应用（含跟随系统监听）
  initTheme()
  // 导航仅图标模式
  if (areNavIconsOnly(true)) {
    document.body.classList.add('nav-icons-only')
  }
  // 滚动高亮：当前可视区段对应的导航项高亮
  const sections = Array.from(document.querySelectorAll<HTMLElement>('main .section[id]'))
  const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav a[href^="#"]'))
  if (sections.length === 0 || navLinks.length === 0) return
  if (typeof IntersectionObserver === 'undefined') return
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          navLinks.forEach((link) => {
            link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`)
          })
        }
      })
    },
    { rootMargin: '-20% 0px -70% 0px' },
  )
  sections.forEach((section) => {
    observer.observe(section)
  })
}

/**
 * 启动设置面板：执行 UI 事件处理初始化 + 设置页面初始化。
 * 完成后触发 bgm:modulesReady 事件，通知 panel/settingsBootstrap 入口启用按钮。
 */
export function startSettings(): void {
  applyAppearance()
  initHandlers()
  initSettingsPage()
  // 通知模块就绪，启用按钮（与 panelPage.ts 的 initPanelCore 对齐）。
  // 必须异步派发：本模块在 settingsBootstrap 的 import 阶段被求值，若同步派发，
  // settingsBootstrap 中注册的 bgm:modulesReady 监听器尚未挂载，按钮会一直禁用
  // 直到 5s 兜底超时。queueMicrotask 在模块求值完成后、settingsBootstrap 主体
  // 注册监听器之后再派发，保证按钮立即启用。
  if (typeof document !== 'undefined') {
    queueMicrotask(() => {
      document.dispatchEvent(new CustomEvent('bgm:modulesReady'))
      console.log('[BGM Settings] startSettings() 完成，bgm:modulesReady 已触发')
    })
  }
}

// 仅在浏览器上下文且当前页面为设置页面时自动启动
if (isSettingsContext()) {
  startSettings()
}
