// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/token.ts`（Token / 用户信息 UI 处理器）单元测试。
 *
 * 依赖形状：18 个符号全部来自**同一个 barrel**（`ts/index.js`），因此只需
 * `vi.mock` 这一个点即可接管；`_T` 文案表用**真实模块**（断言真实文案，不与实现脱节）。
 * `XMLHttpRequest` 换成可精确驱动的假实现，用来遍历 200 / 401 / 5xx / 网络错误 / 超时五条分支。
 *
 * 模块内含 `_lastUserIdSnapshot` 去重缓存，故每个用例 `vi.resetModules()` 后动态 import，
 * 拿到干净的模块实例 —— 否则上一条用例写入的快照会让「状态未变即跳过」静默吞掉断言。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  handleError: vi.fn(),
  loadBgToken: vi.fn(),
  storeBgToken: vi.fn(),
  storeTokenExpires: vi.fn(),
  loadTokenExpires: vi.fn(),
  clearTokenExpires: vi.fn(),
  getTokenRemainingTime: vi.fn(),
  getBgmUserId: vi.fn(),
  setBgmUserId: vi.fn(),
  getBgmUsername: vi.fn(),
  setBgmUsername: vi.fn(),
  getApp: vi.fn((): unknown => null),
  fetchBgmUserInfo: vi.fn(),
  showAlert: vi.fn(),
  showInput: vi.fn(),
  showError: vi.fn(),
  showToast: vi.fn(),
}))

const bgmCache = vi.hoisted(() => ({
  username: null as string | null,
  userId: null as string | null,
  avatarUrl: '',
}))

vi.mock('../ts/index.js', async (importOriginal) => {
  // `...await importOriginal()`：将来 barrel 新增导出不会在本 mock 里静默变 undefined
  const actual = await importOriginal<typeof import('../ts/index.js')>()
  const constants = await import('../ts/core/constants.js')
  return {
    ...actual,
    LOG_LEVELS: constants.LOG_LEVELS,
    bgmLog: m.bgmLog,
    BGM: {
      cache: bgmCache,
      handleError: m.handleError,
      ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
    },
    loadBgToken: m.loadBgToken,
    storeBgToken: m.storeBgToken,
    storeTokenExpires: m.storeTokenExpires,
    loadTokenExpires: m.loadTokenExpires,
    clearTokenExpires: m.clearTokenExpires,
    getTokenRemainingTime: m.getTokenRemainingTime,
    _getBgmUserId: m.getBgmUserId,
    _setBgmUserId: m.setBgmUserId,
    _getBgmUsername: m.getBgmUsername,
    _setBgmUsername: m.setBgmUsername,
    getApp: m.getApp,
    fetchBgmUserInfo: m.fetchBgmUserInfo,
    showAlert: m.showAlert,
    showInput: m.showInput,
    showError: m.showError,
    showToast: m.showToast,
  }
})

import { _T } from '../ts/ui/handlers/_constants.js'

type TokenModule = typeof import('../ts/ui/handlers/token.js')
let token: TokenModule

// ========== 假 XMLHttpRequest ==========

/**
 * 假 XHR：只实现被测代码真正用到的那一面，且**不自动完成请求** ——
 * 由用例显式 `emit('load' | 'error')` 或 `fireTimeout()` 驱动，
 * 这样 200 / 401 / 400 / 5xx / 解析失败 / 网络错误 / 超时才能各自精确触发。
 */
class FakeXhr {
  static readonly instances: FakeXhr[] = []

  private readonly listeners = new Map<string, (() => void)[]>()

  status = 200

  statusText = 'OK'

  readyState = 4

  responseText = '{}'

  responseHeaders = ''

  timeout = 0

  method = ''

  url = ''

  body: unknown = null

  headers: Record<string, string> = {}

  ontimeout: (() => void) | null = null

  open(method: string, url: string, _isAsync?: boolean): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value
  }

  addEventListener(type: string, handler: () => void): void {
    const existing = this.listeners.get(type)
    if (existing) {
      existing.push(handler)
    } else {
      this.listeners.set(type, [handler])
    }
  }

  getAllResponseHeaders(): string {
    return this.responseHeaders
  }

  send(body?: unknown): void {
    this.body = body
    FakeXhr.instances.push(this)
  }

  emit(type: string): void {
    const handlers = this.listeners.get(type)
    if (!handlers) return
    for (const handler of handlers) handler()
  }

  fireTimeout(): void {
    this.ontimeout?.()
  }
}

/** 取本次调用创建的唯一 XHR；不唯一即说明实现发起了非预期请求 */
function lastRequest(): FakeXhr {
  const xhr = FakeXhr.instances.at(-1)
  if (!xhr) throw new Error('未发起请求')
  return xhr
}

/** 等待 fire-and-forget 的异步 IIFE（后台静默查询）跑完 */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

// ========== DOM 与查询 ==========

function mountElement(id: string, tag = 'div'): HTMLElement {
  const element = document.createElement(tag)
  element.id = id
  document.body.append(element)
  return element
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`元素未挂载: ${id}`)
  return element
}

/** 取出 showInput 最后一次调用的回调并触发（确认按钮） */
function confirmInput(value?: string): void {
  const call = m.showInput.mock.calls.at(-1)
  if (!call) throw new Error('showInput 未被调用')
  const callback = call[3] as ((value?: string) => void) | undefined
  if (!callback) throw new Error('showInput 未收到回调')
  callback(value)
}

function mountExpiryElements(): void {
  mountElement('tokenExpiresDisplay')
  mountElement('tokenStatus')
  mountElement('profileExpiresDisplay')
}

/** 装一个「能持久化」的宿主，用于验证头像 URL 落盘 */
function mountAppWithStorage(): { setItem: ReturnType<typeof vi.fn> } {
  const storage = { setItem: vi.fn() }
  m.getApp.mockReturnValue({ PluginStorage: storage })
  return storage
}

beforeEach(async () => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  bgmCache.username = null
  bgmCache.userId = null
  bgmCache.avatarUrl = ''
  // 默认值集中锚定：clearAllMocks 只清调用记录、不清实现，被用例覆写过的一定要在这里复位
  m.loadBgToken.mockReturnValue(null)
  m.loadTokenExpires.mockReturnValue(null)
  m.getTokenRemainingTime.mockReturnValue({ label: '剩余 30 天', status: 'normal' })
  m.getBgmUserId.mockReturnValue(null)
  m.getBgmUsername.mockReturnValue(null)
  m.getApp.mockReturnValue(null)
  m.fetchBgmUserInfo.mockResolvedValue({ userInfo: null, errorType: 'none' })
  FakeXhr.instances.length = 0
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  vi.resetModules()
  token = await import('../ts/ui/handlers/token.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ========== showTokenDialog ==========

describe('token · showTokenDialog', () => {
  it('确认非空 Token → 落盘、清过期信息、刷新状态并提示成功', () => {
    mountElement('tokenStatus')

    token.showTokenDialog()
    confirmInput('abc123')

    expect(m.storeBgToken).toHaveBeenCalledWith('abc123')
    expect(m.clearTokenExpires).toHaveBeenCalled()
    expect(m.showToast).toHaveBeenCalledWith(_T.tokenSaved, 'success')
    // updateTokenStatus 被调用过 → tokenStatus 元素已按「未设置」刷新
    expect(getElement('tokenStatus').textContent).toBe(_T.notSet)
  })

  it('传入 currentToken 时优先预填（不经 loadBgToken）', () => {
    token.showTokenDialog('from-parameter')

    expect(m.showInput).toHaveBeenCalledWith(
      _T.setBgmToken,
      _T.inputToken,
      'from-parameter',
      expect.any(Function),
    )
  })

  it('未传 currentToken 时回退到已存 Token', () => {
    m.loadBgToken.mockReturnValue('stored-token')

    token.showTokenDialog()

    expect(m.showInput).toHaveBeenCalledWith(
      _T.setBgmToken,
      _T.inputToken,
      'stored-token',
      expect.any(Function),
    )
  })

  it('空串 currentToken 视为未设置，仍回退到已存 Token', () => {
    m.loadBgToken.mockReturnValue('stored-token')

    token.showTokenDialog('')

    expect(m.showInput.mock.calls.at(-1)?.[2]).toBe('stored-token')
  })

  it('确认空值 → 不落盘，提示 Token 不能为空', () => {
    token.showTokenDialog()
    confirmInput('')

    expect(m.storeBgToken).not.toHaveBeenCalled()
    expect(m.showToast).toHaveBeenCalledWith('Token 不能为空', 'warn')
  })

  it('回调收到 undefined（取消）→ 同样按空值处理', () => {
    token.showTokenDialog()
    confirmInput()

    expect(m.storeBgToken).not.toHaveBeenCalled()
    expect(m.showToast).toHaveBeenCalledWith('Token 不能为空', 'warn')
  })
})

// ========== showUserIdDialog ==========

describe('token · showUserIdDialog', () => {
  it('确认时去除首尾空白后落盘并刷新状态', () => {
    mountElement('userIdStatus')
    m.getBgmUserId.mockReturnValue('100')

    token.showUserIdDialog()
    confirmInput('  200  ')

    expect(m.setBgmUserId).toHaveBeenCalledWith('200')
    expect(m.showToast).toHaveBeenCalledWith(_T.userIdSaved, 'success')
  })

  it('纯空白输入 → 不落盘，提示不能为空', () => {
    token.showUserIdDialog()
    confirmInput(' '.repeat(3))

    expect(m.setBgmUserId).not.toHaveBeenCalled()
    expect(m.showToast).toHaveBeenCalledWith('用户 ID 不能为空', 'warn')
  })

  it('无已存 ID 时以空串预填', () => {
    m.getBgmUserId.mockReturnValue(null)

    token.showUserIdDialog()

    expect(m.showInput.mock.calls.at(-1)?.[2]).toBe('')
  })
})

// ========== updateTokenStatus ==========

describe('token · updateTokenStatus', () => {
  it('缺 #tokenStatus 元素 → 直接返回（不抛错）', () => {
    m.loadBgToken.mockReturnValue('a-very-long-token')

    expect(() => token.updateTokenStatus()).not.toThrow()
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('Token 缺失或过短 → 显示未设置、清缓存并隐藏资料区', () => {
    mountElement('tokenStatus')
    m.loadBgToken.mockReturnValue('short')

    token.updateTokenStatus()

    const status = getElement('tokenStatus')
    expect(status.textContent).toBe(_T.notSet)
    expect(status.style.color).toBe('rgb(244, 67, 54)')
    expect(bgmCache.userId).toBeNull()
    expect(bgmCache.username).toBeNull()
    expect(m.clearTokenExpires).toHaveBeenCalled()
  })

  it('已有用户名缓存 → 直接显示用户名并后台静默查询状态', async () => {
    mountElement('tokenStatus')
    mountElement('userProfile')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    bgmCache.username = 'momo'

    token.updateTokenStatus()

    expect(getElement('tokenStatus').textContent).toBe(`${_T.set}: momo`)
    await settle()
    // 后台静默查询真的发出了请求（token_status 走 POST）
    expect(lastRequest().method).toBe('POST')
  })

  it('后台静默查询失败 → 不冒泡（主流程不受影响）', async () => {
    mountElement('tokenStatus')
    mountElement('userProfile')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    bgmCache.username = 'momo'

    token.updateTokenStatus()
    await settle()
    lastRequest().emit('error')
    await settle()

    expect(m.handleError).not.toHaveBeenCalled()
  })

  it('无用户名缓存但拉取成功 → 写入展示、刷新用户 ID 区、显示资料区', async () => {
    mountElement('tokenStatus')
    mountElement('userProfile')
    mountElement('userIdStatus')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    // 真实 fetchBgmUserInfo 成功时会顺带写入 BGM.cache；只 mock 返回值的话，
    // 紧随其后的 showUserProfile 会读到空缓存而走「隐藏资料区」分支
    m.fetchBgmUserInfo.mockImplementation(async () => {
      bgmCache.username = 'fetched-user'
      bgmCache.userId = '100'
      return { userInfo: { username: 'fetched-user' }, errorType: 'none' }
    })
    m.getBgmUserId.mockReturnValue('100')
    m.getBgmUsername.mockReturnValue('fetched-user')

    token.updateTokenStatus()
    await settle()

    expect(getElement('tokenStatus').textContent).toBe(`${_T.set}: fetched-user`)
    expect(getElement('userIdStatus').textContent).toBe(`${_T.set}: fetched-user (100)`)
    expect(getElement('userProfile').style.display).toBe('flex')
  })

  it('网络错误 → 橙色警示、提示被墙/断网，并回显本地缓存的过期信息', async () => {
    mountElement('tokenStatus')
    mountElement('tokenExpiresDisplay')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    m.fetchBgmUserInfo.mockResolvedValue({ userInfo: null, errorType: 'network' })
    m.loadTokenExpires.mockReturnValue(1_800_000_000)

    token.updateTokenStatus()
    await settle()

    const status = getElement('tokenStatus')
    expect(status.textContent).toContain('⚠ 网络无法连接')
    expect(m.showToast).toHaveBeenCalledWith(
      expect.stringContaining('无法连接到 Bangumi API'),
      'warn',
    )
    expect(getElement('tokenExpiresDisplay').textContent).toContain(_T.tokenExpiresLabel)
  })

  it('网络错误且无本地缓存 → 不退化为显示过期信息', async () => {
    mountElement('tokenStatus')
    mountElement('tokenExpiresDisplay')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    m.fetchBgmUserInfo.mockResolvedValue({ userInfo: null, errorType: 'network' })
    m.loadTokenExpires.mockReturnValue(null)

    token.updateTokenStatus()
    await settle()

    // 无缓存 → 不会被 showTokenExpiryInfo 重刷，网络告警的橙色得以保留
    expect(getElement('tokenStatus').style.color).toBe('rgb(255, 152, 0)')
    expect(getElement('tokenExpiresDisplay').textContent).toBe('')
  })

  it('HTTP 错误 → 按「Token 可能失效」提示', async () => {
    mountElement('tokenStatus')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    m.fetchBgmUserInfo.mockResolvedValue({ userInfo: null, errorType: 'http' })

    token.updateTokenStatus()
    await settle()

    expect(getElement('tokenStatus').textContent).toContain('Token 可能失效')
    expect(getElement('tokenStatus').style.color).toBe('rgb(244, 67, 54)')
  })

  it('解析错误 → 保持原显示（不改文案）', async () => {
    mountElement('tokenStatus')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    m.fetchBgmUserInfo.mockResolvedValue({ userInfo: null, errorType: 'parse' })

    token.updateTokenStatus()
    const before = getElement('tokenStatus').textContent
    await settle()

    expect(getElement('tokenStatus').textContent).toBe(before)
    expect(getElement('tokenStatus').textContent).toContain('a-ve...')
  })

  it('拉取用户信息抛异常 → 记录错误并交给 handleError', async () => {
    mountElement('tokenStatus')
    m.loadBgToken.mockReturnValue('a-very-long-token')
    m.fetchBgmUserInfo.mockRejectedValue(new Error('boom'))

    token.updateTokenStatus()
    await settle()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('updateTokenStatus 获取用户信息失败: boom'),
    )
    expect(m.handleError).toHaveBeenCalled()
  })
})

// ========== updateUserIdStatus ==========

describe('token · updateUserIdStatus', () => {
  it('缺元素 → 直接返回', () => {
    expect(() => token.updateUserIdStatus()).not.toThrow()
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('同时更新顶栏与用户区两个同名 id 元素（querySelector 只能命中第一个）', () => {
    mountElement('userIdStatus')
    mountElement('userIdStatus')
    m.getBgmUserId.mockReturnValue('100')
    m.getBgmUsername.mockReturnValue('momo')

    token.updateUserIdStatus()

    const elements = document.querySelectorAll<HTMLElement>('[id="userIdStatus"]')
    expect(elements).toHaveLength(2)
    for (const element of elements) {
      expect(element.textContent).toBe(`${_T.set}: momo (100)`)
      expect(element.style.color).toBe('rgb(76, 175, 80)')
    }
  })

  it('只有 ID 没有用户名 → 仅显示 ID', () => {
    mountElement('userIdStatus')
    m.getBgmUserId.mockReturnValue('100')
    m.getBgmUsername.mockReturnValue(null)

    token.updateUserIdStatus()

    expect(getElement('userIdStatus').textContent).toBe(`${_T.set}: 100`)
  })

  it('无 ID → 显示未设置并着红', () => {
    mountElement('userIdStatus')
    m.getBgmUserId.mockReturnValue(null)

    token.updateUserIdStatus()

    expect(getElement('userIdStatus').textContent).toBe(_T.notSet)
    expect(getElement('userIdStatus').style.color).toBe('rgb(244, 67, 54)')
  })

  it('状态未变化 → 跳过重复的 DOM 写入（内部快照去重）', () => {
    mountElement('userIdStatus')
    m.getBgmUserId.mockReturnValue('100')
    token.updateUserIdStatus()
    const logCalls = m.bgmLog.mock.calls.length
    const element = getElement('userIdStatus')
    element.textContent = '被外部改动'

    token.updateUserIdStatus()

    expect(m.bgmLog.mock.calls).toHaveLength(logCalls)
    expect(element.textContent).toBe('被外部改动')
  })
})

// ========== openUserCollection ==========

describe('token · openUserCollection', () => {
  it('未设置用户 ID → 提示先设置，且不打开新标签页', () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    m.getBgmUserId.mockReturnValue(null)

    token.openUserCollection()

    expect(m.showAlert).toHaveBeenCalledWith(_T.pleaseSetUserIdFirst)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('已设置用户 ID → 按用户 ID 拼装收藏页 URL 并新开标签页', () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    m.getBgmUserId.mockReturnValue('momo')

    token.openUserCollection()

    expect(openSpy).toHaveBeenCalledWith('https://bgm.tv/user/momo/collection', '_blank')
  })
})

// ========== testTokenValidity ==========

describe('token · testTokenValidity', () => {
  it('未设置 Token → 提示先设置，且不发起请求', () => {
    m.loadBgToken.mockReturnValue(null)

    token.testTokenValidity()

    expect(m.showAlert).toHaveBeenCalledWith(_T.pleaseSetTokenFirst)
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('请求装配：GET /v0/me、15s 超时、凭据只记录长度不记录内容', () => {
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()

    const xhr = lastRequest()
    expect(xhr.method).toBe('GET')
    expect(xhr.url).toBe('https://api.bgm.tv/v0/me')
    expect(xhr.timeout).toBe(15_000)
    expect(xhr.headers.Authorization).toBe('Bearer secret-token-value')
    // 日志脱敏：不得出现凭据片段
    const logged = m.bgmLog.mock.calls.map((call) => String(call[1])).join('\n')
    expect(logged).not.toContain('secret-token-value')
    expect(logged).toContain(`长度 ${String('secret-token-value'.length)}`)
  })

  it('200 且响应合法 → 写入用户信息、持久化头像并提示剩余天数', async () => {
    mountElement('userIdStatus')
    mountElement('userProfile')
    mountElement('tokenExpiresDisplay')
    mountElement('tokenStatus')
    const storage = mountAppWithStorage()
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    const xhr = lastRequest()
    xhr.responseText = JSON.stringify({
      nickname: 'momo',
      id: 100,
      avatar: { large: 'https://img.example/a.png' },
    })
    xhr.emit('load')
    await settle()

    // 后台的 token_status 请求（第二个 XHR）也要完成，成功提示才带上剩余天数
    const statusXhr = lastRequest()
    statusXhr.responseText = JSON.stringify({ expires: 1_800_000_000, user_id: 100 })
    statusXhr.emit('load')
    await settle()

    expect(m.setBgmUserId).toHaveBeenCalledWith('100')
    expect(m.setBgmUsername).toHaveBeenCalledWith('momo')
    expect(bgmCache.avatarUrl).toBe('https://img.example/a.png')
    expect(storage.setItem).toHaveBeenCalledWith('bgm_avatar_url', 'https://img.example/a.png')
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('✅ Token 有效'), 'success')
    expect(m.showToast).toHaveBeenCalledWith(expect.stringContaining('剩余 30 天'), 'success')
  })

  it('200 但有效期查询失败 → 提示仍为成功，只是不带剩余天数', async () => {
    mountElement('userIdStatus')
    mountElement('userProfile')
    mountElement('tokenStatus')
    mountAppWithStorage()
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().responseText = JSON.stringify({ nickname: 'momo', id: 100 })
    lastRequest().emit('load')
    await settle()
    // 后台的 token_status 请求失败
    lastRequest().emit('error')
    await settle()

    expect(m.showToast).toHaveBeenCalledWith(`✅ Token 有效 | 用户: momo`, 'success')
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Token 状态查询失败，不影响主流程'),
    )
  })

  it('昵称字段回退：nickname 空串 → username → 未知用户占位', async () => {
    mountElement('userIdStatus')
    mountElement('userProfile')
    mountElement('tokenStatus')
    mountElement('tokenExpiresDisplay')
    mountAppWithStorage()
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().responseText = JSON.stringify({ nickname: '', username: 'fallback' })
    lastRequest().emit('load')
    await settle()
    expect(m.setBgmUsername).toHaveBeenCalledWith('fallback')

    m.setBgmUsername.mockClear()
    FakeXhr.instances.length = 0
    token.testTokenValidity()
    lastRequest().responseText = JSON.stringify({})
    lastRequest().emit('load')
    await settle()
    expect(m.setBgmUsername).toHaveBeenCalledWith(_T.unknownUser)
  })

  it('头像字段回退到 medium/small，并剥离反引号包裹', async () => {
    mountElement('userIdStatus')
    mountElement('userProfile')
    mountElement('tokenStatus')
    mountElement('tokenExpiresDisplay')
    mountAppWithStorage()
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().responseText = JSON.stringify({
      nickname: 'momo',
      id: 1,
      avatar: { medium: '`https://img.example/medium.png`' },
    })
    lastRequest().emit('load')
    await settle()

    expect(bgmCache.avatarUrl).toBe('https://img.example/medium.png')
  })

  it('响应无头像 → 不改动头像缓存', async () => {
    mountElement('userIdStatus')
    mountElement('userProfile')
    mountElement('tokenStatus')
    mountElement('tokenExpiresDisplay')
    mountAppWithStorage()
    bgmCache.avatarUrl = 'https://img.example/old.png'
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().responseText = JSON.stringify({ nickname: 'momo', id: 1 })
    lastRequest().emit('load')
    await settle()

    expect(bgmCache.avatarUrl).toBe('https://img.example/old.png')
  })

  it('无宿主（getApp 为 null）→ 跳过头像持久化但不报错', async () => {
    mountElement('userIdStatus')
    mountElement('userProfile')
    mountElement('tokenStatus')
    mountElement('tokenExpiresDisplay')
    m.getApp.mockReturnValue(null)
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().responseText = JSON.stringify({
      nickname: 'momo',
      id: 1,
      avatar: { large: 'https://img.example/a.png' },
    })
    expect(() => {
      lastRequest().emit('load')
    }).not.toThrow()
    await settle()

    expect(bgmCache.avatarUrl).toBe('https://img.example/a.png')
  })

  it('宿主持久化抛错 → 静默降级，不影响头像显示', async () => {
    mountElement('userIdStatus')
    mountElement('userProfile')
    mountElement('tokenStatus')
    mountElement('tokenExpiresDisplay')
    m.getApp.mockReturnValue({
      PluginStorage: {
        setItem: vi.fn(() => {
          throw new Error('storage 不可用')
        }),
      },
    })
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().responseText = JSON.stringify({
      nickname: 'momo',
      id: 1,
      avatar: { large: 'https://img.example/a.png' },
    })
    expect(() => {
      lastRequest().emit('load')
    }).not.toThrow()
  })

  it('响应不是 JSON → 提示解析失败并降级交给 handleError', () => {
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().responseText = 'not json'
    lastRequest().emit('load')

    expect(m.showError).toHaveBeenCalledWith(_T.parseFailed, _T.cannotParseResponse)
    expect(m.handleError).toHaveBeenCalledWith(expect.anything(), {
      showAlert: false,
      level: 1,
      context: 'testTokenValidity',
    })
  })

  it('401 → 提示 Token 失效并隐藏资料区', () => {
    mountElement('userProfile')
    mountElement('tokenStatus')
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    const xhr = lastRequest()
    xhr.status = 401
    xhr.emit('load')

    expect(m.showError).toHaveBeenCalledWith(_T.tokenInvalid, _T.tokenExpired)
    expect(getElement('userProfile').style.display).toBe('none')
  })

  it('其它 HTTP 状态码 → 提示带状态码的失败信息', () => {
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    const xhr = lastRequest()
    xhr.status = 500
    xhr.emit('load')

    expect(m.showError).toHaveBeenCalledWith('错误', 'Token验证失败 (HTTP 500)')
  })

  it('网络错误 → 提示无法连接 Bangumi', () => {
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().emit('error')

    expect(m.showError).toHaveBeenCalledWith(_T.networkError, _T.cannotConnectBgm)
  })

  it('超时 → 提示网络超时（15s 上限生效）', () => {
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    lastRequest().fireTimeout()

    expect(m.showError).toHaveBeenCalledWith('网络超时，请重试', '超时')
  })

  it('响应头非空 → 一并记录到日志', () => {
    m.loadBgToken.mockReturnValue('secret-token-value')

    token.testTokenValidity()
    const xhr = lastRequest()
    xhr.responseHeaders = 'x-ratelimit-remaining: 100'
    xhr.emit('load')

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('x-ratelimit-remaining'),
    )
  })
})

// ========== testDebugConnection ==========

describe('token · testDebugConnection', () => {
  it('宿主不可用 → 提示连接失败', () => {
    m.getApp.mockReturnValue(null)

    token.testDebugConnection()

    expect(m.showToast).toHaveBeenCalledWith(_T.debugConnFail, 'error')
  })

  it('宿主可用 → 提示连接正常', () => {
    m.getApp.mockReturnValue({ Name: 'WPS' })

    token.testDebugConnection()

    expect(m.showToast).toHaveBeenCalledWith(_T.debugConnOk, 'success')
  })
})

// ========== queryTokenStatus ==========

describe('token · queryTokenStatus', () => {
  it('请求装配：POST /oauth/token_status、form-urlencoded、token 编码进请求体', () => {
    void token.queryTokenStatus('a b&c')

    const xhr = lastRequest()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('https://bgm.tv/oauth/token_status')
    expect(xhr.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(xhr.body).toBe(`access_token=${encodeURIComponent('a b&c')}`)
  })

  it('200 且 expires 有效 → 落盘过期时间、刷新过期显示并 resolve', async () => {
    mountExpiryElements()
    const promise = token.queryTokenStatus('t0ken')

    const xhr = lastRequest()
    xhr.responseText = JSON.stringify({ expires: 1_800_000_000, user_id: 100 })
    xhr.emit('load')

    await expect(promise).resolves.toEqual({ expires: 1_800_000_000, userId: '100' })
    expect(m.storeTokenExpires).toHaveBeenCalledWith(1_800_000_000)
    expect(getElement('tokenExpiresDisplay').textContent).toContain(_T.tokenExpiresLabel)
  })

  it('200 但 expires 缺失/非正数 → reject 且不落盘', async () => {
    const promise = token.queryTokenStatus('t0ken')

    const xhr = lastRequest()
    xhr.responseText = JSON.stringify({ expires: 0 })
    xhr.emit('load')

    await expect(promise).rejects.toThrow('missing expires field')
    expect(m.storeTokenExpires).not.toHaveBeenCalled()
  })

  it('200 但响应不是 JSON → reject 解析失败', async () => {
    const promise = token.queryTokenStatus('t0ken')

    const xhr = lastRequest()
    xhr.responseText = 'plain text'
    xhr.emit('load')

    await expect(promise).rejects.toThrow('Failed to parse token status response')
  })

  it('400 → reject（Token 可能已失效）', async () => {
    const promise = token.queryTokenStatus('t0ken')

    const xhr = lastRequest()
    xhr.status = 400
    xhr.emit('load')

    await expect(promise).rejects.toThrow('Token invalid or expired (HTTP 400)')
  })

  it('401 → reject', async () => {
    const promise = token.queryTokenStatus('t0ken')

    const xhr = lastRequest()
    xhr.status = 401
    xhr.emit('load')

    await expect(promise).rejects.toThrow('HTTP 401')
  })

  it('5xx → reject', async () => {
    const promise = token.queryTokenStatus('t0ken')

    const xhr = lastRequest()
    xhr.status = 502
    xhr.emit('load')

    await expect(promise).rejects.toThrow('HTTP 502')
  })

  it('网络错误 → reject', async () => {
    const promise = token.queryTokenStatus('t0ken')

    lastRequest().emit('error')

    await expect(promise).rejects.toThrow('Network error')
  })

  it('超时 → reject', async () => {
    const promise = token.queryTokenStatus('t0ken')

    lastRequest().fireTimeout()

    await expect(promise).rejects.toThrow('Request timeout')
  })

  it('凭据不进日志（只记录长度）', () => {
    void token.queryTokenStatus('super-secret')

    const logged = m.bgmLog.mock.calls.map((call) => String(call[1])).join('\n')
    expect(logged).not.toContain('super-secret')
    expect(logged).toContain(`长度 ${String('super-secret'.length)}`)
  })
})

// ========== showTokenExpiryInfo ==========

describe('token · showTokenExpiryInfo', () => {
  it.each([
    ['normal', 'rgb(76, 175, 80)', '✅'],
    ['warning', 'rgb(255, 193, 7)', '⚠️'],
    ['danger', 'rgb(255, 152, 0)', '🔴'],
    ['expired', 'rgb(244, 67, 54)', '⛔'],
  ])('状态 %s → 三处元素同步换色/换图标', (status, color, icon) => {
    mountExpiryElements()
    m.getTokenRemainingTime.mockReturnValue({ label: '剩余 3 天', status })

    token.showTokenExpiryInfo(1_800_000_000)

    const expires = getElement('tokenExpiresDisplay')
    expect(expires.textContent).toBe(`${_T.tokenExpiresLabel}: 剩余 3 天`)
    expect(expires.style.color).toBe(color)
    expect(expires.style.display).toBe('')
    expect(getElement('tokenStatus').style.color).toBe(color)
    const profile = getElement('profileExpiresDisplay')
    expect(profile.textContent).toBe(`${icon} 剩余 3 天`)
    expect(profile.style.color).toBe(color)
  })

  it('三处元素全缺失 → 不抛错', () => {
    expect(() => token.showTokenExpiryInfo(1_800_000_000)).not.toThrow()
  })
})

// ========== checkTokenExpiryWarning ==========

describe('token · checkTokenExpiryWarning', () => {
  it('已过期 → 红色提示', () => {
    m.getTokenRemainingTime.mockReturnValue({ label: '已过期', status: 'expired' })

    token.checkTokenExpiryWarning(1)

    expect(m.showToast).toHaveBeenCalledWith(_T.tokenExpiredWarning, 'error')
  })

  it('临期（danger）→ 红色提示并填入剩余天数', () => {
    m.getTokenRemainingTime.mockReturnValue({ label: '2 天', status: 'danger' })

    token.checkTokenExpiryWarning(1)

    const expected = _T.tokenExpiringCritical.split('{}').join('2 天')
    expect(m.showToast).toHaveBeenCalledWith(expected, 'error')
  })

  it('即将过期（warning）→ 黄色提示并填入剩余天数', () => {
    m.getTokenRemainingTime.mockReturnValue({ label: '6 天', status: 'warning' })

    token.checkTokenExpiryWarning(1)

    const expected = _T.tokenExpiringSoon.split('{}').join('6 天')
    expect(m.showToast).toHaveBeenCalledWith(expected, 'warn')
  })

  it('正常状态 → 不打扰用户', () => {
    m.getTokenRemainingTime.mockReturnValue({ label: '剩余 30 天', status: 'normal' })

    token.checkTokenExpiryWarning(1)

    expect(m.showToast).not.toHaveBeenCalled()
  })
})

// ========== showUserProfile ==========

describe('token · showUserProfile', () => {
  it('同时点亮顶栏头像、Token 区右侧与资料区，并回显缓存的过期信息', () => {
    mountElement('userProfile')
    mountElement('userAvatar', 'img')
    mountElement('topbarAvatar')
    mountElement('topbarAvatarImg', 'img')
    mountElement('tokenStatusRight')
    mountElement('tokenUserName')
    mountElement('tokenUserId')
    mountElement('tokenAvatarImg', 'img')
    mountElement('userNameDisplay')
    mountElement('userIdDisplay')
    mountElement('userIdStatus')
    mountExpiryElements()
    bgmCache.avatarUrl = 'https://img.example/a.png'
    bgmCache.username = 'momo'
    bgmCache.userId = '100'
    m.getBgmUserId.mockReturnValue('100')
    m.getBgmUsername.mockReturnValue('momo')
    m.loadTokenExpires.mockReturnValue(1_800_000_000)

    token.showUserProfile()

    expect(getElement('userProfile').style.display).toBe('flex')
    expect(getElement('userAvatar').getAttribute('src')).toBe('https://img.example/a.png')
    expect(getElement('userAvatar').getAttribute('alt')).toBe('momo')
    expect(getElement('topbarAvatar').style.display).toBe('')
    expect(getElement('topbarAvatar').getAttribute('aria-label')).toBe('momo')
    expect(getElement('tokenStatusRight').style.display).toBe('flex')
    expect(getElement('tokenUserName').textContent).toBe('momo')
    expect(getElement('tokenUserId').textContent).toBe('ID: 100')
    expect(getElement('userNameDisplay').textContent).toBe('momo')
    expect(getElement('userIdDisplay').textContent).toBe('ID: 100')
    expect(getElement('tokenExpiresDisplay').textContent).toContain(_T.tokenExpiresLabel)
  })

  it('只有用户名无头像 → 头像位隐藏、资料区仍展示', () => {
    mountElement('userProfile')
    mountElement('userAvatar', 'img')
    mountElement('tokenStatusRight')
    mountElement('tokenAvatarImg', 'img')
    mountElement('userIdStatus')
    bgmCache.username = 'momo'
    bgmCache.avatarUrl = ''

    token.showUserProfile()

    expect(getElement('userProfile').style.display).toBe('flex')
    expect(getElement('userAvatar').style.display).toBe('none')
    expect(getElement('tokenAvatarImg').style.display).toBe('none')
  })

  it('用户名与头像都空 → 隐藏资料区、顶栏头像与 Token 区右侧', () => {
    mountElement('userProfile')
    mountElement('topbarAvatar')
    mountElement('tokenStatusRight')
    mountElement('userIdStatus')

    token.showUserProfile()

    expect(getElement('userProfile').style.display).toBe('none')
    expect(getElement('topbarAvatar').style.display).toBe('none')
    expect(getElement('tokenStatusRight').style.display).toBe('none')
  })

  it('头像加载失败 → 隐藏该头像并记录告警（三处各自挂监听）', () => {
    mountElement('userProfile')
    mountElement('userAvatar', 'img')
    mountElement('topbarAvatar')
    mountElement('topbarAvatarImg', 'img')
    mountElement('tokenStatusRight')
    mountElement('tokenAvatarImg', 'img')
    mountElement('userIdStatus')
    bgmCache.avatarUrl = 'https://img.example/broken.png'
    bgmCache.username = 'momo'

    token.showUserProfile()
    for (const id of ['userAvatar', 'topbarAvatarImg', 'tokenAvatarImg']) {
      getElement(id).dispatchEvent(new Event('error'))
    }

    expect(getElement('userAvatar').style.display).toBe('none')
    expect(getElement('topbarAvatar').style.display).toBe('none')
    expect(getElement('tokenAvatarImg').style.display).toBe('none')
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('头像加载失败'),
    )
  })

  it('元素全缺失 → 不抛错', () => {
    bgmCache.username = 'momo'

    expect(() => token.showUserProfile()).not.toThrow()
  })
})

// ========== hideUserProfile ==========

describe('token · hideUserProfile', () => {
  it('隐藏三处容器并同时清空过期信息文案', () => {
    mountElement('userProfile')
    mountElement('topbarAvatar')
    mountElement('tokenStatusRight')
    mountElement('userIdStatus')
    const expires = mountElement('tokenExpiresDisplay')
    const profileExpires = mountElement('profileExpiresDisplay')
    expires.textContent = '旧内容'
    profileExpires.textContent = '旧内容'

    token.hideUserProfile()

    expect(getElement('userProfile').style.display).toBe('none')
    expect(getElement('topbarAvatar').style.display).toBe('none')
    expect(getElement('tokenStatusRight').style.display).toBe('none')
    expect(expires.style.display).toBe('none')
    expect(expires.textContent).toBe('')
    expect(profileExpires.style.display).toBe('none')
    expect(profileExpires.textContent).toBe('')
  })

  it('元素全缺失 → 不抛错', () => {
    expect(() => token.hideUserProfile()).not.toThrow()
  })
})

// ========== renewToken ==========

describe('token · renewToken', () => {
  it('委托给 testTokenValidity（未设置 Token 时表现一致）', () => {
    m.loadBgToken.mockReturnValue(null)

    // 刻意覆盖：验证 deprecated 兼容入口仍可用（生产已无 UI 触发）
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    token.renewToken()

    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('已合并到 testTokenValidity'),
    )
    expect(m.showAlert).toHaveBeenCalledWith(_T.pleaseSetTokenFirst)
  })
})
