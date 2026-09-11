/**
 * GitHub 配置表单（读写 / 防抖自动保存 / 数据源字段切换）
 * @module ui/handlers/github-settings
 * @description 从 handlers/index.ts 抽出：配置输入框 ↔ PluginStorage 的双向同步，
 *              以及按同步源类型（GitHub / local / gist）切换可见字段。
 */

import {
  LOG_LEVELS,
  bgmLog,
  getGithubConfig,
  setGithubConfig,
  getSyncStrategy,
  setSyncStrategy,
  getSyncSourceType,
  setSyncSourceType,
} from '../../index.js'
import type { SyncStrategy, SyncSourceType } from '../../index.js'
import { debounce } from '../../tools/debounce.js'
import { trackedAddEventListener } from './resource-tracking.js'

/**
 * 按同步源类型切换 UI 字段显示/隐藏
 *
 * - GitHub/GitLab/Gitee: 显示 owner/repo/branch/path（#remoteSourceFields）
 * - local: 显示本地文件路径输入框 + 选择按钮（#localFileFields）
 * - gist: 显示 gistId 输入框（#gistFields）
 *
 * @param sourceType 同步源类型
 */
export function toggleSourceFields(sourceType: SyncSourceType): void {
  const remoteFields = document.getElementById('remoteSourceFields')
  const localFields = document.getElementById('localFileFields')
  const gistFields = document.getElementById('gistFields')
  if (remoteFields) {
    remoteFields.style.display = sourceType === 'local' || sourceType === 'gist' ? 'none' : ''
  }
  if (localFields) {
    localFields.style.display = sourceType === 'local' ? '' : 'none'
  }
  if (gistFields) {
    gistFields.style.display = sourceType === 'gist' ? '' : 'none'
  }
}

/**
 * saveGithubConfigFromDom（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
export function saveGithubConfigFromDom() {
  const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
  const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
  const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
  const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
  const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
  const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
  const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
  const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null

  const owner = (ownerInput?.value ?? '').trim()
  const repo = (repoInput?.value ?? '').trim()
  const branch = (branchInput?.value ?? '').trim() || 'main'
  const strategy = (strategySelect?.value as SyncStrategy | undefined) ?? 'add-update'
  const sourceType = (sourceTypeSelect?.value as SyncSourceType | undefined) ?? 'github'

  // 按数据源类型读取对应字段值
  // - local: 复用 githubConfig.path 字段存储本地文件路径（与远程源 path 字段互斥复用）
  // - gist: 使用独立的 gistId 字段
  // - GitHub/GitLab/Gitee: 使用 owner/repo/branch/path
  const path =
    sourceType === 'local'
      ? (localFilePathInput?.value ?? '').trim()
      : (pathInput?.value ?? '').trim()
  let gistId: string | undefined
  if (sourceType === 'gist') {
    gistId = (gistIdInput?.value ?? '').trim() || undefined
  }

  // 必填项校验：用户可能正在输入，未完成时跳过自动保存
  if (sourceType === 'local') {
    if (!path) return
  } else if (sourceType === 'gist') {
    if (!gistId) return
  } else if (!owner || !repo || !path) return

  const isOkConfig = setGithubConfig({ owner, repo, branch, path, sourceType, gistId })
  const isOkStrategy = setSyncStrategy(strategy)
  const isOkSourceType = setSyncSourceType(sourceType)
  if (isOkConfig && isOkStrategy && isOkSourceType) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[handlers] GitHub 配置已自动保存: ${owner}/${repo}/${branch}/${path}, 策略: ${strategy}, 同步源: ${sourceType}${gistId ? `, gistId: ${gistId}` : ''}`,
    )
  }
}

/**
 * GitHub 配置输入框防抖自动保存（300ms）。
 * 每次从 DOM 实时读取值，避免闭包持有过时的元素引用。
 */
export const debouncedSaveGithubConfig = debounce((): void => {
  try {
    saveGithubConfigFromDom()
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[handlers] GitHub 配置自动保存失败: ${(error as Error).message}`)
  }
}, 300)

/**
 * 从 PluginStorage 重新读取 GitHub 配置并填充到面板输入框
 * 用于配置导入后刷新 UI 显示
 */
export function refreshGithubConfigInputs(): void {
  try {
    const config = getGithubConfig()
    const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
    const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
    const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
    const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
    const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
    const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
    const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
    const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null
    if (ownerInput) ownerInput.value = config.owner
    if (repoInput) repoInput.value = config.repo
    if (branchInput) branchInput.value = config.branch
    if (pathInput) pathInput.value = config.path
    if (localFilePathInput) localFilePathInput.value = config.path
    if (gistIdInput && config.gistId) gistIdInput.value = config.gistId
    if (strategySelect) strategySelect.value = getSyncStrategy()
    const sourceType = getSyncSourceType()
    if (sourceTypeSelect) sourceTypeSelect.value = sourceType
    toggleSourceFields(sourceType)
    bgmLog(
      LOG_LEVELS.INFO,
      `[refreshGithubConfigInputs] 已刷新 GitHub 配置输入框: ${config.owner}/${config.repo}/${config.branch}/${config.path}`,
    )
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[refreshGithubConfigInputs] 刷新 GitHub 配置输入框失败: ${(error as Error).message}`,
    )
  }
}

/**
 * loadGithubConfigIntoForm（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
export function loadGithubConfigIntoForm() {
  const config = getGithubConfig()
  const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
  const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
  const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
  const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
  const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
  const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
  const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
  const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null
  if (ownerInput) ownerInput.value = config.owner
  if (repoInput) repoInput.value = config.repo
  if (branchInput) branchInput.value = config.branch
  if (pathInput) pathInput.value = config.path
  // 本地文件路径复用 githubConfig.path 字段，回填到独立输入框
  if (localFilePathInput) localFilePathInput.value = config.path
  // Gist ID 回填
  if (gistIdInput && config.gistId) gistIdInput.value = config.gistId
  // 回填策略
  const savedStrategy = getSyncStrategy()
  if (strategySelect) strategySelect.value = savedStrategy
  // 回填同步源类型，并触发字段显示/隐藏切换
  const savedSourceType = getSyncSourceType()
  if (sourceTypeSelect) sourceTypeSelect.value = savedSourceType
  toggleSourceFields(savedSourceType)
  if (config.owner || config.repo || config.path) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[handlers] GitHub 配置已加载: ${config.owner}/${config.repo}/${config.branch}/${config.path}, 策略: ${savedStrategy}, 同步源: ${savedSourceType}`,
    )
  }

  // 为 GitHub 配置输入框添加防抖自动保存（300ms），
  // 用户输入时静默保存，避免每次按键都触发 PluginStorage 写入。
  // 注意：按钮点击 "保存配置"（saveGithubConfig action）不走此路径，
  // 仍保留同步保存 + Toast 反馈，确保用户主动保存的即时确认体验。
  if (ownerInput) trackedAddEventListener(ownerInput, 'input', debouncedSaveGithubConfig)
  if (repoInput) trackedAddEventListener(repoInput, 'input', debouncedSaveGithubConfig)
  if (branchInput) trackedAddEventListener(branchInput, 'input', debouncedSaveGithubConfig)
  if (pathInput) trackedAddEventListener(pathInput, 'input', debouncedSaveGithubConfig)
  if (localFilePathInput)
    trackedAddEventListener(localFilePathInput, 'input', debouncedSaveGithubConfig)
  if (gistIdInput) trackedAddEventListener(gistIdInput, 'input', debouncedSaveGithubConfig)
  if (strategySelect) trackedAddEventListener(strategySelect, 'change', debouncedSaveGithubConfig)
  if (sourceTypeSelect) {
    // sourceType 切换时：1) 触发字段显示/隐藏；2) 触发防抖保存
    trackedAddEventListener(sourceTypeSelect, 'change', () => {
      const selectedSourceType = (sourceTypeSelect.value as SyncSourceType | undefined) ?? 'github'
      toggleSourceFields(selectedSourceType)
      debouncedSaveGithubConfig()
    })
  }
  bgmLog(LOG_LEVELS.INFO, '[handlers] GitHub 配置输入框防抖自动保存监听器已注册')
}
