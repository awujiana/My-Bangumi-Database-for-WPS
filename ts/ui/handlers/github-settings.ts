/**
 * GitHub 配置表单（读写 / 防抖自动保存 / 数据源字段切换 / 数据分片多选）
 * @module ui/handlers/github-settings
 * @description 从 handlers/index.ts 抽出：配置输入框 ↔ PluginStorage 的双向同步、
 *              按同步源类型（GitHub / local / gist）切换可见字段，以及分片多选。
 */

import {
  LOG_LEVELS,
  bgmLog,
  getGithubConfig,
  setGithubConfig,
  getManualShards,
  setManualShards,
  getSyncStrategy,
  setSyncStrategy,
  getSyncSourceType,
  setSyncSourceType,
} from '../../index.js'
import type { SyncStrategy, SyncSourceType } from '../../index.js'
import { debounce } from '../../tools/debounce.js'
import { trackedAddEventListener } from './resource-tracking.js'

/**
 * 可手动选择的数据分片（顺序即界面展示顺序）
 *
 * 与数据仓库 `data/anime.manifest.json` 的 6 片一一对应。这里刻意用静态清单，
 * 而不是打开面板时去拉一次清单：拉清单会给「打开设置」引入网络失败面，而手动选片
 * 只是覆盖自动选片的兜底手段 —— 清单以后新增的分片在自动模式下仍会被正常选中。
 */
export const SHARD_OPTIONS: readonly { name: string; label: string }[] = [
  { name: 'base', label: '基础（SID/名称/时间）' },
  { name: 'meta', label: '资料（话数/导演等）' },
  { name: 'relations', label: '关联条目' },
  { name: 'stats', label: '评分/排名/标签' },
  { name: 'summary', label: '简介' },
  { name: 'infobox', label: 'infobox 原文' },
] as const

/**
 * 不可取消的必选分片
 *
 * SID / 名称 / 更新时间都只在 `base` 里，缺了它拼不出记录，所以固定勾选且禁用。
 */
const REQUIRED_SHARDS: readonly string[] = ['base'] as const

/**
 * 按 {@link SHARD_OPTIONS} 渲染分片复选框（幂等：重复调用先清空）
 */
export function renderShardOptions(): void {
  const list = document.getElementById('shardSelectList')
  if (!list) return

  list.textContent = ''
  for (const option of SHARD_OPTIONS) {
    const isRequired = REQUIRED_SHARDS.includes(option.name)
    const label = document.createElement('label')
    if (isRequired) label.classList.add('is-required')

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.dataset.shard = option.name
    input.checked = isRequired
    input.disabled = isRequired

    label.append(input, document.createTextNode(option.label))
    list.append(label)
  }
}

/**
 * 读取当前勾选的分片
 *
 * 必选片是 `disabled`，不计入用户选择；用户一个可选片都没勾时返回空数组，
 * 语义是「回到按表头自动选片」。
 *
 * @returns 分片名数组；空数组表示自动模式
 */
export function collectSelectedShards(): string[] {
  const list = document.getElementById('shardSelectList')
  if (!list) return []

  const optional: string[] = []
  for (const input of list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const name = input.dataset.shard
    if (name && input.checked && !REQUIRED_SHARDS.includes(name)) optional.push(name)
  }
  return optional.length > 0 ? [...REQUIRED_SHARDS, ...optional] : []
}

/**
 * 从 PluginStorage 回填分片勾选状态
 */
export function refreshShardSelection(): void {
  const list = document.getElementById('shardSelectList')
  if (!list) return

  const manual = new Set(getManualShards())
  for (const input of list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const name = input.dataset.shard
    if (name) {
      input.checked = REQUIRED_SHARDS.includes(name) || manual.has(name)
    }
  }
}

/**
 * 注册分片多选的变更监听（勾选即落盘）
 */
function bindShardSelection(list: HTMLElement): void {
  trackedAddEventListener(list, 'change', () => {
    const selected = collectSelectedShards()
    if (!setManualShards(selected)) {
      bgmLog(LOG_LEVELS.WARN, '[handlers] 数据分片选择保存失败')
      return
    }
    bgmLog(
      LOG_LEVELS.INFO,
      selected.length > 0
        ? `[handlers] 数据分片已手动指定: ${selected.join(', ')}`
        : '[handlers] 数据分片已恢复为按表头自动选择',
    )
  })
}

/**
 * 按同步源类型切换 UI 字段显示/隐藏
 *
 * - GitHub/GitLab/Gitee: 显示 owner/repo/branch/path（#remoteSourceFields）
 * - local: 显示本地文件路径输入框 + 选择按钮（#localFileFields）
 * - gist: 显示 gistId 输入框（#gistFields）
 *
 * 分片多选（#shardSelectFields）对 GitHub / GitLab / Gitee / local 都有效，
 * 只有 Gist 不支持（Gist API 只能读明文，读不了 gzip 分片），故一并隐藏。
 *
 * @param sourceType 同步源类型
 */
export function toggleSourceFields(sourceType: SyncSourceType): void {
  const remoteFields = document.getElementById('remoteSourceFields')
  const localFields = document.getElementById('localFileFields')
  const gistFields = document.getElementById('gistFields')
  const shardFields = document.getElementById('shardSelectFields')
  if (remoteFields) {
    remoteFields.style.display = sourceType === 'local' || sourceType === 'gist' ? 'none' : ''
  }
  if (localFields) {
    localFields.style.display = sourceType === 'local' ? '' : 'none'
  }
  if (gistFields) {
    gistFields.style.display = sourceType === 'gist' ? '' : 'none'
  }
  if (shardFields) {
    shardFields.style.display = sourceType === 'gist' ? 'none' : ''
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
    renderShardOptions()
    refreshShardSelection()
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
  // 渲染分片多选并回填勾选状态（清单里的分片以后可能增减，故每次打开都重建）
  renderShardOptions()
  refreshShardSelection()
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
  // 分片多选：勾选即落盘（不走防抖，勾选是明确的单次动作）
  const shardList = document.getElementById('shardSelectList')
  if (shardList) bindShardSelection(shardList)
  bgmLog(LOG_LEVELS.INFO, '[handlers] GitHub 配置输入框防抖自动保存监听器已注册')
}
