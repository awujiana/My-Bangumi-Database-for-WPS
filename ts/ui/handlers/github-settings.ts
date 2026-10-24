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
 *
 * `detail` 是该片的完整字段清单与取舍说明，给「📋 分片清单」浮窗用：
 * 复选框上那一两个词（「资料」「关联条目」）装不下这些细节，而用户需要
 * 知道勾下去到底拖哪些字段下来（momo：选项太笼统，要完整写在分片清单里）。
 */
export const SHARD_OPTIONS: readonly { name: string; label: string; detail: string }[] = [
  {
    name: 'base',
    label: '基础（SID/名称/时间）',
    detail:
      '字段：subjectId / name / name_original / updatedAt / date / meta_tags / nsfw。\n' +
      '写入 Excel：SID、名称、别名、更新时间、播出日期、标签、NSFW 标记。\n' +
      'SID 是各片的连接键，名称与更新时间是同步筛选的依据 —— 所以本片固定勾选、不可取消。',
  },
  {
    name: 'meta',
    label: '资料（话数/导演等）',
    detail:
      'infobox 解析出的 19 个中文列：话数、片长、动画制作公司、导演、音乐、声优阵容、' +
      'OP / ED、制片国家、语言、类型、上映日期等，各写对应标准列。\n' +
      '本地列名与标准列不一致时（如「动画制作公司」 vs 「制作公司」）按别名匹配，见同步前的列映射确认框。',
  },
  {
    name: 'relations',
    label: '关联条目',
    detail:
      '两个容易混的列，区别在「被关联条目的类型」：\n' +
      '· 关联条目ID —— subject-relations 的全部关联条目 ID，不分类型（电影 / 小说 / 游戏 / 音乐都算）。\n' +
      '· 关联的动漫ID —— 同一批关联条目里只挑 type=2（动画）的那部分。\n' +
      '例：一部剧场版关联「原作小说 + 前作 TV」：前两行都在「关联条目ID」里，只有前作 TV 进「关联的动漫ID」。',
  },
  {
    name: 'stats',
    label: '评分/排名/标签',
    detail:
      '字段：platform / series / score / rank / score_details / favorite / tags。\n' +
      '写入 Excel：播放平台、系列、Bangumi 站评分、排名、评分分布、收藏数、标签。\n' +
      '注意「评分 / 排名」是站内公开数据，与你个人主观「打分」不是一回事。',
  },
  {
    name: 'summary',
    label: '简介',
    detail: '字段：简介（剧情简介全文）。约占数据体积 29% —— 表里没有简介列时没必要下载它。',
  },
  {
    name: 'infobox',
    label: 'infobox 原文',
    detail:
      '字段：infobox 原文（未解析的原始文本，含全部制作人员明细）。约占数据体积 48%，' +
      '是六片里最大的一片 —— 只在需要原文留档时才勾。',
  },
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

// ===== 分片清单浮窗 =====

/**
 * 渲染清单正文：每片一节（标题 + 完整字段细节）
 *
 * 细节文本按 `\n` 分段渲染（pre-line 交给 CSS），保持「一行一个要点」的可读性。
 */
function renderShardListBody(): void {
  const body = document.getElementById('shardListBody')
  if (!body) return
  body.textContent = ''
  for (const option of SHARD_OPTIONS) {
    const isRequired = REQUIRED_SHARDS.includes(option.name)
    const item = document.createElement('div')
    item.className = isRequired ? 'shard-list-item is-required' : 'shard-list-item'
    const heading = document.createElement('h4')
    heading.textContent = `${option.label}${isRequired ? '（必选）' : ''}`
    const detail = document.createElement('p')
    detail.textContent = option.detail
    item.append(heading, detail)
    body.append(item)
  }
}

/**
 * 打开「分片清单」浮窗（独立模态框）
 *
 * 为什么独立浮窗而不是塞进 hint：每片要写清完整字段清单（含「关联条目ID vs
 * 关联的动漫ID」的区别、各片体积占比），hint 放不下（momo：选项太笼统）。
 *
 * 遮罩用 `absolute` + JS 写 `top = scrollY` 锚定**当前可见区**：WPS 任务窗格里
 * `fixed` 会因 iframe 视口=内容高而飘到可见区外（detachable-panel 同款修法）。
 */
export function openShardListModal(): void {
  const modal = document.getElementById('shardListModal')
  if (!modal) return
  renderShardListBody()
  modal.style.setProperty('top', `${String(window.scrollY)}px`)
  modal.style.display = 'flex'
}

/** 关闭「分片清单」浮窗 */
export function closeShardListModal(): void {
  const modal = document.getElementById('shardListModal')
  if (modal) modal.style.display = 'none'
}

/**
 * 注册分片清单浮窗的入口与关闭路径
 *
 * 按钮 / 关闭叉 / 点遮罩 / Esc 四条路都关。Esc 监听常驻但不抢事件：
 * 浮窗没开（display:none）就直接放行，让页面其它 Esc 处理器（关弹窗那批）照常工作。
 */
export function bindShardListModal(): void {
  const openButton = document.getElementById('shardListBtn')
  const closeButton = document.getElementById('shardListCloseBtn')
  const modal = document.getElementById('shardListModal')
  if (!openButton || !closeButton || !modal) return
  // DOM 标记幂等：loadGithubConfigIntoForm 可能被重复调用（面板重加载），
  // trackedAddEventListener 不去重，重复绑会让「点一次开两次」。
  // 标记挂在按钮上：任务窗格整体刷新时 DOM 重建，标记随之消失、自然重绑。
  if (openButton.dataset.shardListBound === 'true') return
  openButton.dataset.shardListBound = 'true'

  trackedAddEventListener(openButton, 'click', () => {
    openShardListModal()
  })
  trackedAddEventListener(closeButton, 'click', () => {
    closeShardListModal()
  })
  trackedAddEventListener(modal, 'click', (event: Event) => {
    if (event.target === modal) closeShardListModal()
  })
  trackedAddEventListener(document, 'keydown', (event: Event) => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.key !== 'Escape') return
    // 只在浮窗开着时接管 Esc：没开就让给页面其它处理器
    if (modal.style.display === 'none') return
    closeShardListModal()
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
 * 从配置表单读到的原始值（**未做必填校验**，空串原样保留）
 */
export interface GithubConfigForm {
  owner: string
  repo: string
  branch: string
  path: string
  sourceType: SyncSourceType
  strategy: SyncStrategy
  // 显式带 `| undefined`：exactOptionalPropertyTypes 下 `gistId?: string` 不允许赋 undefined，
  // 而 gist 源未填时正是 undefined（下游 setGithubConfig 亦按可选字段处理）
  gistId?: string | undefined
}

/**
 * 缺失的必填项；齐全时为 `null`。
 *
 * 返回**具体缺哪一项**而不是 boolean：手动保存要给「本地文件路径 / Gist ID /
 * owner+repo+path」三种不同提示，而防抖自动保存只关心「要不要跳过」。
 */
export type GithubConfigMissingField = 'path' | 'gistId' | 'ownerRepoPath' | null

/**
 * 从 DOM 实时读取配置表单（不持有元素引用，避免闭包拿到过时节点）
 *
 * `saveGithubConfigFromDom`（防抖自动保存）与 `action-handlers` 的
 * `saveGithubConfig`（手动保存）此前各写一份逐字相同的读取逻辑，收敛于此。
 */
export function readGithubConfigForm(): GithubConfigForm {
  const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
  const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
  const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
  const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
  const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
  const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
  const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
  const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null

  const sourceType = (sourceTypeSelect?.value as SyncSourceType | undefined) ?? 'github'
  const form: GithubConfigForm = {
    owner: (ownerInput?.value ?? '').trim(),
    repo: (repoInput?.value ?? '').trim(),
    // 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
    branch: (branchInput?.value ?? '').trim() || 'main',
    // 按数据源类型读取对应字段值：
    // - local: 复用 githubConfig.path 字段存储本地文件路径（与远程源 path 字段互斥复用）
    // - GitHub/GitLab/Gitee: 使用 owner/repo/branch/path
    path:
      sourceType === 'local'
        ? (localFilePathInput?.value ?? '').trim()
        : (pathInput?.value ?? '').trim(),
    sourceType,
    strategy: (strategySelect?.value as SyncStrategy | undefined) ?? 'add-update',
  }
  // gist: 使用独立的 gistId 字段
  if (sourceType === 'gist') {
    form.gistId = (gistIdInput?.value ?? '').trim() || undefined
  }
  return form
}

/** 按同步源类型找出缺失的必填项；齐全时返回 `null` */
export function findMissingConfigField(form: GithubConfigForm): GithubConfigMissingField {
  if (form.sourceType === 'local') {
    return form.path ? null : 'path'
  }
  if (form.sourceType === 'gist') {
    return form.gistId ? null : 'gistId'
  }
  return form.owner && form.repo && form.path ? null : 'ownerRepoPath'
}

/**
 * saveGithubConfigFromDom（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
export function saveGithubConfigFromDom() {
  const form = readGithubConfigForm()
  // 必填项校验：用户可能正在输入，未完成时跳过自动保存
  if (findMissingConfigField(form) !== null) return

  const isOkConfig = setGithubConfig({
    owner: form.owner,
    repo: form.repo,
    branch: form.branch,
    path: form.path,
    sourceType: form.sourceType,
    gistId: form.gistId,
  })
  const isOkStrategy = setSyncStrategy(form.strategy)
  const isOkSourceType = setSyncSourceType(form.sourceType)
  if (isOkConfig && isOkStrategy && isOkSourceType) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[handlers] GitHub 配置已自动保存: ${form.owner}/${form.repo}/${form.branch}/${form.path}, 策略: ${form.strategy}, 同步源: ${form.sourceType}${form.gistId ? `, gistId: ${form.gistId}` : ''}`,
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
  // 分片清单浮窗：入口按钮 + 关闭路径（幂等，重复加载不重复绑）
  bindShardListModal()
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
