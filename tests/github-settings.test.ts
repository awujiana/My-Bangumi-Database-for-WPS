// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/github-settings.ts` 的单元测试。
 *
 * 该模块负责「GitHub 配置表单 ↔ PluginStorage」的双向同步，共 5 个导出：
 *  1. `toggleSourceFields` —— 按数据源类型切换三组字段的显隐；
 *  2. `saveGithubConfigFromDom` —— 从 DOM 读值 → 校验必填 → 落盘（三个 setter 全成功才记日志）；
 *  3. `debouncedSaveGithubConfig` —— 300ms 防抖包装，内部 try/catch 记 WARN；
 *  4. `refreshGithubConfigInputs` —— 重新读配置回填输入框（供导入配置后刷新）；
 *  5. `loadGithubConfigIntoForm` —— 首次回填 + 注册 8 个防抖监听器。
 *
 * ## 断言口径
 * - `debounce` 与 `trackedAddEventListener` 用**真实现**（前者配假定时器推进 300ms，
 *   后者真的 `addEventListener`），所以「输入 → 300ms 后落盘」是端到端可观察的，
 *   不是「断言 handler 被注册」这种弱断言。
 * - `select` 回填必须**预置同名 option**：jsdom 对无匹配 option 的 `select.value = 'x'`
 *   会静默丢弃赋值，直接断言 value 只会拿到 `''`（假失败）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  getGithubConfig: vi.fn(),
  setGithubConfig: vi.fn(),
  getSyncStrategy: vi.fn(),
  setSyncStrategy: vi.fn(),
  getSyncSourceType: vi.fn(),
  setSyncSourceType: vi.fn(),
}))

vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  bgmLog: stubs.bgmLog,
  getGithubConfig: stubs.getGithubConfig,
  setGithubConfig: stubs.setGithubConfig,
  getSyncStrategy: stubs.getSyncStrategy,
  setSyncStrategy: stubs.setSyncStrategy,
  getSyncSourceType: stubs.getSyncSourceType,
  setSyncSourceType: stubs.setSyncSourceType,
}))

// 只为收窄依赖图；resource-tracking 只在函数体内用 eventBus
vi.mock('../ts/tools/events.js', () => ({ eventBus: { on: vi.fn(), off: vi.fn() } }))

import {
  debouncedSaveGithubConfig,
  loadGithubConfigIntoForm,
  refreshGithubConfigInputs,
  saveGithubConfigFromDom,
  toggleSourceFields,
} from '../ts/ui/handlers/github-settings.js'

const EMPTY_CONFIG = {
  owner: '',
  repo: '',
  branch: 'main',
  path: '',
  sourceType: 'github' as const,
  gistId: undefined,
}

/** 建完整表单 DOM */
function mountForm(): void {
  document.body.innerHTML = `
    <div id="remoteSourceFields"></div>
    <div id="localFileFields"></div>
    <div id="gistFields"></div>
    <input id="githubOwner">
    <input id="githubRepo">
    <input id="githubBranch">
    <input id="githubPath">
    <input id="localFilePath">
    <input id="gistId">
    <select id="githubStrategy"></select>
    <select id="syncSourceType"></select>
  `
}

/** 给 select 预置 option 并赋值（jsdom 无匹配 option 会丢弃赋值） */
function selectValue(id: string, value: string): HTMLSelectElement {
  const select = document.getElementById(id) as HTMLSelectElement
  const option = document.createElement('option')
  option.value = value
  select.append(option)
  select.value = value
  return select
}

/** 设输入框的值 */
function setInput(id: string, value: string): HTMLInputElement {
  const input = document.getElementById(id) as HTMLInputElement
  input.value = value
  return input
}

/** 读输入框的值 */
function inputValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value
}

/** bgmLog 是否输出过包含某片段的日志 */
function hasLog(fragment: string): boolean {
  return stubs.bgmLog.mock.calls.some((call) => String(call[1]).includes(fragment))
}

/** 派发一个会冒泡的原生事件 */
function fire(element: Element, type: string): void {
  element.dispatchEvent(new Event(type, { bubbles: true }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mountForm()
  stubs.getGithubConfig.mockReturnValue({ ...EMPTY_CONFIG })
  stubs.setGithubConfig.mockReturnValue(true)
  stubs.setSyncStrategy.mockReturnValue(true)
  stubs.setSyncSourceType.mockReturnValue(true)
  stubs.getSyncStrategy.mockReturnValue('add-update')
  stubs.getSyncSourceType.mockReturnValue('github')
})

// ========== toggleSourceFields ==========

describe('toggleSourceFields', () => {
  it('github → 显示远程字段，隐藏本地 / Gist 字段', () => {
    toggleSourceFields('github')

    expect(document.getElementById('remoteSourceFields')?.style.display).toBe('')
    expect(document.getElementById('localFileFields')?.style.display).toBe('none')
    expect(document.getElementById('gistFields')?.style.display).toBe('none')
  })

  it('local → 只显示本地文件字段', () => {
    toggleSourceFields('local')

    expect(document.getElementById('remoteSourceFields')?.style.display).toBe('none')
    expect(document.getElementById('localFileFields')?.style.display).toBe('')
    expect(document.getElementById('gistFields')?.style.display).toBe('none')
  })

  it('gist → 只显示 Gist ID 字段', () => {
    toggleSourceFields('gist')

    expect(document.getElementById('remoteSourceFields')?.style.display).toBe('none')
    expect(document.getElementById('localFileFields')?.style.display).toBe('none')
    expect(document.getElementById('gistFields')?.style.display).toBe('')
  })

  it('三组容器都不存在时不抛错', () => {
    document.body.replaceChildren()

    expect(() => {
      toggleSourceFields('local')
    }).not.toThrow()
  })
})

// ========== saveGithubConfigFromDom ==========

describe('saveGithubConfigFromDom', () => {
  it('github 源：落盘 owner/repo/branch/path 并记录完整日志', () => {
    setInput('githubOwner', '  alice  ')
    setInput('githubRepo', ' repo ')
    setInput('githubBranch', 'dev')
    setInput('githubPath', ' data/a.jsonlines ')
    selectValue('githubStrategy', 'overwrite')
    selectValue('syncSourceType', 'github')

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).toHaveBeenCalledWith({
      owner: 'alice',
      repo: 'repo',
      branch: 'dev',
      path: 'data/a.jsonlines',
      sourceType: 'github',
      gistId: undefined,
    })
    expect(stubs.setSyncStrategy).toHaveBeenCalledWith('overwrite')
    expect(stubs.setSyncSourceType).toHaveBeenCalledWith('github')
    expect(hasLog('GitHub 配置已自动保存: alice/repo/dev/data/a.jsonlines, 策略: overwrite, 同步源: github')).toBe(
      true,
    )
  })

  it('分支为空时回退 main', () => {
    setInput('githubOwner', 'alice')
    setInput('githubRepo', 'repo')
    setInput('githubPath', 'a.jsonlines')

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).toHaveBeenCalledWith(expect.objectContaining({ branch: 'main' }))
  })

  it('两个 select 都不存在时回退默认策略与默认源类型', () => {
    document.getElementById('githubStrategy')?.remove()
    document.getElementById('syncSourceType')?.remove()
    setInput('githubOwner', 'alice')
    setInput('githubRepo', 'repo')
    setInput('githubPath', 'a.jsonlines')

    saveGithubConfigFromDom()

    expect(stubs.setSyncStrategy).toHaveBeenCalledWith('add-update')
    expect(stubs.setSyncSourceType).toHaveBeenCalledWith('github')
  })

  it('github 源缺少 owner/repo/path 任一 → 跳过保存（用户还在输入）', () => {
    setInput('githubOwner', 'alice')
    setInput('githubRepo', '')
    setInput('githubPath', 'a.jsonlines')

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).not.toHaveBeenCalled()
  })

  it('local 源：路径取 localFilePath 而非 githubPath', () => {
    setInput('githubPath', '不该被读的远程路径')
    setInput('localFilePath', ' D:/本地/数据表.xlsx ')
    selectValue('syncSourceType', 'local')

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'D:/本地/数据表.xlsx', sourceType: 'local' }),
    )
  })

  it('local 源缺少本地路径 → 跳过保存', () => {
    setInput('localFilePath', ' '.repeat(3))
    selectValue('syncSourceType', 'local')

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).not.toHaveBeenCalled()
  })

  it('gist 源：读取 gistId 并写进日志', () => {
    setInput('gistId', ' abc123 ')
    selectValue('syncSourceType', 'gist')

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).toHaveBeenCalledWith(
      expect.objectContaining({ gistId: 'abc123', sourceType: 'gist' }),
    )
    expect(hasLog(', gistId: abc123')).toBe(true)
  })

  it('gist 源缺少 gistId → 跳过保存', () => {
    setInput('gistId', '')
    selectValue('syncSourceType', 'gist')

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).not.toHaveBeenCalled()
  })

  it('三个 setter 有任一失败 → 不记录「已自动保存」日志', () => {
    setInput('githubOwner', 'alice')
    setInput('githubRepo', 'repo')
    setInput('githubPath', 'a.jsonlines')
    stubs.setSyncStrategy.mockReturnValue(false)

    saveGithubConfigFromDom()

    expect(stubs.setGithubConfig).toHaveBeenCalled()
    expect(hasLog('GitHub 配置已自动保存')).toBe(false)
  })
})

// ========== debouncedSaveGithubConfig ==========

describe('debouncedSaveGithubConfig', () => {
  it('调用后 300ms 才落盘', () => {
    setInput('githubOwner', 'alice')
    setInput('githubRepo', 'repo')
    setInput('githubPath', 'a.jsonlines')

    debouncedSaveGithubConfig()
    expect(stubs.setGithubConfig).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(stubs.setGithubConfig).toHaveBeenCalledTimes(1)
  })

  it('连续调用只执行最后一次（防抖）', () => {
    setInput('githubOwner', 'alice')
    setInput('githubRepo', 'repo')
    setInput('githubPath', 'a.jsonlines')

    debouncedSaveGithubConfig()
    vi.advanceTimersByTime(200)
    debouncedSaveGithubConfig()
    vi.advanceTimersByTime(299)
    expect(stubs.setGithubConfig).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(stubs.setGithubConfig).toHaveBeenCalledTimes(1)
  })

  it('保存过程抛错 → 记 WARN 而不向上抛（自动保存不能打断输入）', () => {
    stubs.setGithubConfig.mockImplementation(() => {
      throw new Error('storage 写失败')
    })
    setInput('githubOwner', 'alice')
    setInput('githubRepo', 'repo')
    setInput('githubPath', 'a.jsonlines')

    debouncedSaveGithubConfig()
    expect(() => {
      vi.advanceTimersByTime(300)
    }).not.toThrow()

    expect(hasLog('[handlers] GitHub 配置自动保存失败: storage 写失败')).toBe(true)
  })
})

// ========== refreshGithubConfigInputs ==========

describe('refreshGithubConfigInputs', () => {
  it('把配置与策略 / 源类型回填到表单并切换字段显隐', () => {
    stubs.getGithubConfig.mockReturnValue({
      owner: 'alice',
      repo: 'repo',
      branch: 'dev',
      path: 'a.jsonlines',
      sourceType: 'gist',
      gistId: 'g1',
    })
    stubs.getSyncStrategy.mockReturnValue('overwrite')
    stubs.getSyncSourceType.mockReturnValue('gist')
    selectValue('githubStrategy', 'overwrite')
    selectValue('syncSourceType', 'gist')

    refreshGithubConfigInputs()

    expect(inputValue('githubOwner')).toBe('alice')
    expect(inputValue('githubRepo')).toBe('repo')
    expect(inputValue('githubBranch')).toBe('dev')
    expect(inputValue('githubPath')).toBe('a.jsonlines')
    // 本地路径输入框复用 config.path
    expect(inputValue('localFilePath')).toBe('a.jsonlines')
    expect(inputValue('gistId')).toBe('g1')
    expect((document.getElementById('githubStrategy') as HTMLSelectElement).value).toBe('overwrite')
    expect((document.getElementById('syncSourceType') as HTMLSelectElement).value).toBe('gist')
    expect(document.getElementById('gistFields')?.style.display).toBe('')
    expect(hasLog('[refreshGithubConfigInputs] 已刷新 GitHub 配置输入框: alice/repo/dev/a.jsonlines')).toBe(
      true,
    )
  })

  it('配置没有 gistId 时不覆盖 gistId 输入框', () => {
    setInput('gistId', '保留原值')

    refreshGithubConfigInputs()

    expect(inputValue('gistId')).toBe('保留原值')
  })

  it('控件缺失时不抛错', () => {
    document.body.replaceChildren()

    expect(() => {
      refreshGithubConfigInputs()
    }).not.toThrow()
  })

  it('读取配置抛错 → 记 WARN', () => {
    stubs.getGithubConfig.mockImplementation(() => {
      throw new Error('读配置失败')
    })

    expect(() => {
      refreshGithubConfigInputs()
    }).not.toThrow()

    expect(hasLog('[refreshGithubConfigInputs] 刷新 GitHub 配置输入框失败: 读配置失败')).toBe(true)
  })
})

// ========== loadGithubConfigIntoForm ==========

describe('loadGithubConfigIntoForm', () => {
  it('回填表单、切换显隐并注册防抖监听器', () => {
    stubs.getGithubConfig.mockReturnValue({
      owner: 'alice',
      repo: 'repo',
      branch: 'dev',
      path: 'a.jsonlines',
      sourceType: 'github',
      gistId: 'g1',
    })
    stubs.getSyncStrategy.mockReturnValue('overwrite')
    stubs.getSyncSourceType.mockReturnValue('github')
    selectValue('githubStrategy', 'overwrite')
    selectValue('syncSourceType', 'github')

    loadGithubConfigIntoForm()

    expect(inputValue('githubOwner')).toBe('alice')
    expect(inputValue('githubBranch')).toBe('dev')
    expect(inputValue('localFilePath')).toBe('a.jsonlines')
    expect(inputValue('gistId')).toBe('g1')
    expect((document.getElementById('githubStrategy') as HTMLSelectElement).value).toBe('overwrite')
    expect(document.getElementById('localFileFields')?.style.display).toBe('none')
    expect(
      hasLog('[handlers] GitHub 配置已加载: alice/repo/dev/a.jsonlines, 策略: overwrite, 同步源: github'),
    ).toBe(true)
    expect(hasLog('[handlers] GitHub 配置输入框防抖自动保存监听器已注册')).toBe(true)
  })

  it('配置全空时不打印「已加载」日志（仍然注册监听器）', () => {
    loadGithubConfigIntoForm()

    expect(hasLog('GitHub 配置已加载')).toBe(false)
    expect(hasLog('[handlers] GitHub 配置输入框防抖自动保存监听器已注册')).toBe(true)
  })

  it('在 owner 输入框输入 → 300ms 后自动保存', () => {
    loadGithubConfigIntoForm()
    setInput('githubOwner', 'alice')
    setInput('githubRepo', 'repo')
    setInput('githubPath', 'a.jsonlines')

    fire(document.getElementById('githubOwner')!, 'input')
    expect(stubs.setGithubConfig).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(stubs.setGithubConfig).toHaveBeenCalledTimes(1)
  })

  it('切换数据源类型 → 立刻切换显隐，并触发防抖保存', () => {
    loadGithubConfigIntoForm()
    setInput('gistId', 'abc')
    const select = selectValue('syncSourceType', 'gist')

    fire(select, 'change')

    // 显隐是同步的（用户要立刻看到字段变化）
    expect(document.getElementById('gistFields')?.style.display).toBe('')
    expect(document.getElementById('remoteSourceFields')?.style.display).toBe('none')
    // 保存是防抖的
    expect(stubs.setGithubConfig).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(stubs.setGithubConfig).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'gist', gistId: 'abc' }),
    )
  })

  it('控件缺失时不抛错（旧版 HTML 缺字段也能启动）', () => {
    document.body.replaceChildren()

    expect(() => {
      loadGithubConfigIntoForm()
    }).not.toThrow()
    expect(hasLog('[handlers] GitHub 配置输入框防抖自动保存监听器已注册')).toBe(true)
  })
})
