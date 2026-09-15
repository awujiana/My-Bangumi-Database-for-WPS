// @vitest-environment jsdom
/**
 * @fileoverview `ts/sync/exceltobangumi/api.ts`（Bangumi API 请求层）单元测试。
 *
 * 依赖形状：只有 3 个导入点 —— `core/constants.js`（**真实常量**，断言真实 API 路由）、
 * `tools/util/index.js`（**单一 barrel**，单点 mock 即可接管）、`core/ui-bridge.js`（通知桥，单点 mock）。
 * 没有任何 COM 依赖：`testTokenValidityForRibbon` / `bgmRequestSync` 合计 258 行全部走
 * `XMLHttpRequest`，所以把 `XMLHttpRequest` 换成**不自动完成**的假实现、由用例显式
 * `emit('load' | 'error')` / `fireTimeout()` 驱动，即可精确遍历
 * 200 / 401 / 429 / 5xx / 网络错误 / 超时 / abort 各条分支 —— 不需要真网络。
 *
 * `mockReset` 而非 `mockClear`：`clearAllMocks` **不清实现**，本文件多条用例会覆写
 * `getApp` / `setBgmUserId` 的实现（抛错分支），务必在 `beforeEach` 统一重锚，
 * 否则上一条用例的「必然抛错」会泄漏到下一条，静默改变断言含义。
 *
 * 实测：**100% lines / 100% funcs / 100% stmts**（branch 92.2%）。残余分支全是
 * `error instanceof Error ? error.message : String(error)` 的**后半侧** —— 只有刻意让
 * 被依赖方抛「非 Error 值」才可达，属于造人工输入换数字，按既有判据不追。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: unknown, message: string) => void>(),
  getApp: vi.fn((): unknown => null),
  loadBgToken: vi.fn((): string | null => null),
  storeBgToken: vi.fn(),
  setBgmUserId: vi.fn(),
  setBgmUsername: vi.fn(),
  handleError: vi.fn(),
}))

/** 真实实现里会被直接赋值的缓存对象，用同一份引用断言 */
const bgmCache = vi.hoisted(() => ({
  username: null as string | null,
  userId: null as string | null,
}))

const notifyApi = vi.hoisted(() => ({
  alert: vi.fn<(message: string, title?: string) => void>(),
  error: vi.fn<(message: string, title?: string) => void>(),
  success: vi.fn<(message: string, title?: string) => void>(),
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  getApp: m.getApp,
  loadBgToken: m.loadBgToken,
  storeBgToken: m.storeBgToken,
  _setBgmUserId: m.setBgmUserId,
  _setBgmUsername: m.setBgmUsername,
  BGM: {
    cache: bgmCache,
    handleError: m.handleError,
  },
}))

vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => notifyApi,
}))

import {
  bgmRequestSync,
  extractResponseMessage,
  notifyUserInfoUpdated,
  openBangumiTokenPage,
  parseErrorResponse,
  setBangumiToken,
  testTokenValidityForRibbon,
} from '../ts/sync/exceltobangumi/api.js'
import { BGM_CONFIG, LOG_LEVELS } from '../ts/core/constants.js'

// ========== 假 XMLHttpRequest ==========

/**
 * 假 XHR：只实现被测代码真正用到的那一面，且**不自动完成请求** ——
 * 由用例显式 `emit('load' | 'error')` 或 `fireTimeout()` 驱动，
 * 这样 200 / 401 / 429 / 5xx / 解析失败 / 网络错误 / 超时 / abort 才能各自精确触发。
 */
class FakeXhr {
  static readonly instances: FakeXhr[] = []

  /** 让 `open` 可控抛错，覆盖实现里 Promise 执行器异常 → 外层 catch 的兜底路径 */
  static throwOnOpen = false

  private readonly listeners = new Map<string, (() => void)[]>()

  status = 200

  statusText = 'OK'

  responseText = '{}'

  responseHeaders = ''

  timeout = 0

  method = ''

  url = ''

  isAsync = false

  body: unknown = null

  headers: Record<string, string> = {}

  abortCount = 0

  ontimeout: (() => void) | null = null

  open(method: string, url: string, isAsync?: boolean): void {
    if (FakeXhr.throwOnOpen) throw new Error('open 失败')
    this.method = method
    this.url = url
    this.isAsync = isAsync ?? false
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

  /**
   * WPS WebView 下 `abort()` 会走到 `error` 回调 —— `api.ts:369` 的防御性归类
   * （`signal?.aborted ? '请求被取消' : 'Network error'`）正是按此假设写的，
   * 因此这里用 `error` 事件模拟，才能覆盖「abort 被归类为取消」这条分支。
   */
  abort(): void {
    this.abortCount += 1
    this.emit('error')
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

/** 取本次调用创建的唯一 XHR；不存在即说明实现没发请求（或测试没接上） */
function lastXhr(): FakeXhr {
  const xhr = FakeXhr.instances.at(-1)
  if (!xhr) throw new Error('未发起请求')
  return xhr
}

/**
 * 取全部日志消息体。`LOG_LEVELS.INFO` 是**数字**而非字符串，
 * 首参不能用 `expect.any(String)` 匹配，因此统一取第二个参数。
 */
function logMessages(): string[] {
  return m.bgmLog.mock.calls.map((call) => call[1])
}

function hasLog(fragment: string): boolean {
  return logMessages().some((message) => message.includes(fragment))
}

/** 构造一个只满足 `parseErrorResponse` 读取面的 XHR 桩 */
function xhrLike(partial: {
  status: number
  statusText: string
  responseText: string
}): XMLHttpRequest {
  return partial as unknown as XMLHttpRequest
}

/** 构造已 aborted 的 signal（不依赖 `AbortSignal.abort()` 静态方法是否存在） */
function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

/** 装配一个「带 PluginStorage + GetTaskPane」的宿主，用于验证面板刷新通知 */
function mountAppWithTaskPane(options: {
  paneId?: string | null
  refreshPanelUI?: (() => void) | null
  throwOnGetTaskPane?: boolean
}): { getPane: ReturnType<typeof vi.fn> } {
  const getPane = vi.fn(() => {
    if (options.throwOnGetTaskPane) throw new Error('GetTaskPane 不可用')
    const contentWindow = options.refreshPanelUI ? { refreshPanelUI: options.refreshPanelUI } : {}
    return { contentWindow }
  })
  m.getApp.mockReturnValue({
    PluginStorage: { getItem: () => options.paneId ?? null },
    GetTaskPane: getPane,
  })
  return { getPane }
}

beforeEach(() => {
  vi.resetAllMocks()
  bgmCache.username = null
  bgmCache.userId = null
  // 默认值集中锚定：resetAllMocks 清掉了实现，这里把基线重新压回去
  m.getApp.mockReturnValue(null)
  m.loadBgToken.mockReturnValue(null)
  FakeXhr.instances.length = 0
  FakeXhr.throwOnOpen = false
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ========== extractResponseMessage ==========

describe('extractResponseMessage', () => {
  it('msg 优先级最高', () => {
    expect(extractResponseMessage({ msg: 'A', message: 'B', error: 'C' })).toBe('A')
  })

  it('msg 为空串时退到 message（`||` 而非 `??`）', () => {
    expect(extractResponseMessage({ msg: '', message: 'B' })).toBe('B')
  })

  it('message / error / description 依次兜底', () => {
    expect(extractResponseMessage({ message: 'M' })).toBe('M')
    expect(extractResponseMessage({ error: 'E' })).toBe('E')
    expect(extractResponseMessage({ description: 'D' })).toBe('D')
  })

  it('字段全缺 → success', () => {
    expect(extractResponseMessage({})).toBe('success')
  })

  it('非对象输入 → success', () => {
    expect(extractResponseMessage(null)).toBe('success')
    expect(extractResponseMessage(undefined)).toBe('success')
    expect(extractResponseMessage('boom')).toBe('success')
    expect(extractResponseMessage(500)).toBe('success')
  })
})

// ========== parseErrorResponse ==========

describe('parseErrorResponse', () => {
  it('JSON 体带 error → 用 error', () => {
    const xhr = xhrLike({ status: 401, statusText: 'Unauthorized', responseText: '{"error":"凭据无效"}' })
    expect(parseErrorResponse(xhr)).toBe('凭据无效')
  })

  it('error 为空串时退到 description', () => {
    const xhr = xhrLike({
      status: 400,
      statusText: 'Bad Request',
      responseText: JSON.stringify({ error: '', description: '请求参数有误' }),
    })
    expect(parseErrorResponse(xhr)).toBe('请求参数有误')
  })

  it('JSON 体无字段 → 回退到 HTTP 状态码', () => {
    const xhr = xhrLike({ status: 500, statusText: 'Server Error', responseText: '{}' })
    expect(parseErrorResponse(xhr)).toBe('HTTP 500')
  })

  it('响应体非 JSON → 用 statusText', () => {
    const xhr = xhrLike({ status: 502, statusText: 'Bad Gateway', responseText: '<html>502</html>' })
    expect(parseErrorResponse(xhr)).toBe('Bad Gateway')
  })

  it('响应体非 JSON 且 statusText 也为空 → 回退到 HTTP 状态码', () => {
    const xhr = xhrLike({ status: 0, statusText: '', responseText: '' })
    expect(parseErrorResponse(xhr)).toBe('HTTP 0')
  })
})

// ========== openBangumiTokenPage ==========

describe('openBangumiTokenPage', () => {
  it('宿主支持 OAAssist.ShellExecute → 走宿主打开，不碰 window.open', () => {
    const shellExecute = vi.fn()
    m.getApp.mockReturnValue({ OAAssist: { ShellExecute: shellExecute } })

    openBangumiTokenPage()

    expect(shellExecute).toHaveBeenCalledWith('https://next.bgm.tv/demo/access-token')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('无宿主 → 回退 window.open', () => {
    openBangumiTokenPage()

    expect(window.open).toHaveBeenCalledWith('https://next.bgm.tv/demo/access-token', '_blank')
  })

  it('宿主存在但缺 OAAssist → 回退 window.open', () => {
    m.getApp.mockReturnValue({})

    openBangumiTokenPage()

    expect(window.open).toHaveBeenCalledTimes(1)
  })
})

// ========== testTokenValidityForRibbon ==========

describe('testTokenValidityForRibbon · 前置校验与请求装配', () => {
  it('既无入参 Token 也无本地 Token → 提示先设置，且不发请求', () => {
    testTokenValidityForRibbon()

    expect(notifyApi.alert).toHaveBeenCalledWith('请先设置 Token！', '提示')
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('入参 Token 为空串时回退到本地已存 Token（`||` 而非 `??`）', () => {
    m.loadBgToken.mockReturnValue('stored-token')

    testTokenValidityForRibbon('')

    expect(lastXhr().headers.Authorization).toBe('Bearer stored-token')
  })

  it('signal 已 aborted → 立即返回并记日志，不发请求', () => {
    testTokenValidityForRibbon('tok', abortedSignal())

    expect(FakeXhr.instances).toHaveLength(0)
    expect(hasLog('请求被取消（signal 已 aborted）')).toBe(true)
  })

  it('请求装配：GET /v0/me、30s 超时、两个请求头，且日志只打 Token 长度不打明文', () => {
    testTokenValidityForRibbon('secret-token')

    const xhr = lastXhr()
    expect(xhr.method).toBe('GET')
    expect(xhr.url).toBe(`${BGM_CONFIG.API_BASE}/v0/me`)
    expect(xhr.isAsync).toBe(true)
    expect(xhr.timeout).toBe(30_000)
    expect(xhr.headers.Authorization).toBe('Bearer secret-token')
    expect(xhr.headers['Content-Type']).toBe('application/json')
    expect(xhr.body).toBeUndefined()
    expect(hasLog(`长度 ${String('secret-token'.length)}`)).toBe(true)
    expect(logMessages().join('\n')).not.toContain('secret-token')
  })
})

describe('testTokenValidityForRibbon · 响应分支', () => {
  it('200 → 提示成功、回填用户信息缓存并打印响应头', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.status = 200
    xhr.statusText = 'OK'
    xhr.responseText = JSON.stringify({ nickname: 'momo', id: 42 })
    xhr.responseHeaders = 'content-type: application/json'

    xhr.emit('load')

    expect(notifyApi.success).toHaveBeenCalledWith('Token有效！\n\n用户名: momo\n用户ID: 42', '验证成功')
    expect(m.setBgmUserId).toHaveBeenCalledWith('42')
    expect(m.setBgmUsername).toHaveBeenCalledWith('momo')
    expect(bgmCache.userId).toBe('42')
    expect(bgmCache.username).toBe('momo')
    expect(hasLog('HTTP 状态码: 200 (OK)')).toBe(true)
    expect(hasLog('响应头: content-type: application/json')).toBe(true)
    // 短响应体不截断
    expect(
      logMessages().some(
        (message) => message.includes('响应数据:') && message.endsWith('...'),
      ),
    ).toBe(false)
  })

  it('200 但响应头为空 → 跳过响应头日志', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.responseText = '{"nickname":"momo","id":1}'

    xhr.emit('load')

    expect(hasLog('响应头:')).toBe(false)
  })

  it('200 但字段缺失 → 落到「未知用户 / 未知ID」占位', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.responseText = '{}'

    xhr.emit('load')

    expect(notifyApi.success).toHaveBeenCalledWith('Token有效！\n\n用户名: 未知用户\n用户ID: 未知ID', '验证成功')
  })

  it('200 且 username 存在但 nickname 缺失 → 用 username 兜底', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.responseText = JSON.stringify({ username: 'fallback-user', id: 'u-1' })

    xhr.emit('load')

    expect(notifyApi.success).toHaveBeenCalledWith(
      'Token有效！\n\n用户名: fallback-user\n用户ID: u-1',
      '验证成功',
    )
  })

  it('200 且响应体超 300 字符 → 日志截断并加省略号', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.responseText = JSON.stringify({ nickname: 'x'.repeat(400), id: 1 })

    xhr.emit('load')

    // 载荷被截到 300 字符 + '...'，与实现里的 substring(0, 300) 严格对齐
    const payload = logMessages()
      .find((message) => message.includes('响应数据:'))
      ?.split('响应数据: ', 2)[1]
    expect(payload?.endsWith('...')).toBe(true)
    expect(payload?.length).toBe(303)
  })

  it('200 但响应体非 JSON → 走 handleError 兜底并提示解析失败', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.responseText = 'not-json'

    xhr.emit('load')

    expect(notifyApi.error).toHaveBeenCalledWith('Token有效，但解析响应失败', '错误')
    expect(m.handleError.mock.calls[0]?.[1]).toEqual({
      context: 'testTokenValidityForRibbon',
      showAlert: false,
    })
  })

  it('401 → 提示 Token 无效或已过期', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.status = 401
    xhr.statusText = 'Unauthorized'

    xhr.emit('load')

    expect(notifyApi.error).toHaveBeenCalledWith('Token无效或已过期，请重新获取', '验证失败')
    expect(notifyApi.success).not.toHaveBeenCalled()
  })

  it('其他非 2xx → 提示状态码并打印响应内容', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.status = 503
    xhr.statusText = 'Service Unavailable'
    xhr.responseText = 'upstream down'

    xhr.emit('load')

    expect(notifyApi.error).toHaveBeenCalledWith('Token验证失败 (HTTP 503)', '错误')
    expect(hasLog('响应内容: upstream down')).toBe(true)
  })

  it('网络错误事件 → 给出 GFW / 断网排查提示', () => {
    testTokenValidityForRibbon('tok')

    lastXhr().emit('error')

    const call = notifyApi.error.mock.calls[0]
    expect(call?.[1]).toBe('网络错误')
    expect(call?.[0]).toContain('网络被墙（GFW）')
  })

  it('超时 → 提示 30s 超时且点明 Token 可能有效', () => {
    testTokenValidityForRibbon('tok')

    lastXhr().fireTimeout()

    expect(notifyApi.error).toHaveBeenCalledWith(
      '请求超时（30s）\n\n可能网络受限或被墙，Token 本身可能有效',
      '超时',
    )
    expect(hasLog('请求超时，耗时')).toBe(true)
  })
})

describe('testTokenValidityForRibbon · AbortSignal 生命周期', () => {
  it('请求中 abort → 调用 xhr.abort()，且完成后监听器已移除不再重复中止', () => {
    const controller = new AbortController()
    testTokenValidityForRibbon('tok', controller.signal)
    const xhr = lastXhr()

    controller.abort()
    expect(xhr.abortCount).toBe(1)

    xhr.responseText = '{"nickname":"momo","id":1}'
    xhr.emit('load')
    expect(notifyApi.success).toHaveBeenCalledTimes(1)

    // load 里 removeAbortHandler 已摘掉监听：再次 abort 不应再打 xhr.abort()
    controller.abort()
    expect(xhr.abortCount).toBe(1)
  })

  it('未传 signal 时 load 分支不抛错（removeAbortHandler 提前返回）', () => {
    testTokenValidityForRibbon('tok')

    expect(() => {
      lastXhr().emit('load')
    }).not.toThrow()
  })
})

// ========== notifyUserInfoUpdated ==========

describe('notifyUserInfoUpdated', () => {
  it('写入缓存 + 持久化 + 通过 GetTaskPane 通知面板刷新', () => {
    const refreshPanelUI = vi.fn()
    mountAppWithTaskPane({ paneId: 'pane-1', refreshPanelUI })

    notifyUserInfoUpdated('momo', '42')

    expect(m.setBgmUserId).toHaveBeenCalledWith('42')
    expect(m.setBgmUsername).toHaveBeenCalledWith('momo')
    expect(bgmCache.username).toBe('momo')
    expect(bgmCache.userId).toBe('42')
    expect(refreshPanelUI).toHaveBeenCalledTimes(1)
    expect(hasLog('已通过 GetTaskPane 通知 Panel 刷新')).toBe(true)
  })

  it('无宿主（getApp 返回 null）→ 只写缓存，不通知面板', () => {
    expect(() => {
      notifyUserInfoUpdated('momo', '42')
    }).not.toThrow()

    expect(bgmCache.username).toBe('momo')
    expect(hasLog('已通过 GetTaskPane 通知 Panel 刷新')).toBe(false)
  })

  it('PluginStorage 里没有 panel_id → 跳过 GetTaskPane', () => {
    const { getPane } = mountAppWithTaskPane({ paneId: null })

    notifyUserInfoUpdated('momo', '42')

    expect(getPane).not.toHaveBeenCalled()
  })

  it('pane 存在但缺 contentWindow.refreshPanelUI → 静默跳过', () => {
    mountAppWithTaskPane({ paneId: 'pane-1', refreshPanelUI: null })

    expect(() => {
      notifyUserInfoUpdated('momo', '42')
    }).not.toThrow()

    expect(hasLog('已通过 GetTaskPane 通知 Panel 刷新')).toBe(false)
  })

  it('GetTaskPane 抛错 → 降级为轮询兜底并记 warn', () => {
    mountAppWithTaskPane({ paneId: 'pane-1', throwOnGetTaskPane: true })

    notifyUserInfoUpdated('momo', '42')

    expect(hasLog('GetTaskPane 通知失败（轮询兜底）: GetTaskPane 不可用')).toBe(true)
  })

  it('持久化本身抛错 → 走外层 catch，不向上抛', () => {
    m.setBgmUserId.mockImplementation(() => {
      throw new Error('PluginStorage 已满')
    })

    expect(() => {
      notifyUserInfoUpdated('momo', '42')
    }).not.toThrow()

    expect(hasLog('通知用户信息更新失败: PluginStorage 已满')).toBe(true)
  })
})

// ========== bgmRequestSync ==========

describe('bgmRequestSync · 成功与消息提取', () => {
  it('方法大写化、URL 拼接、请求体透传，200 时返回 API 消息', async () => {
    const promise = bgmRequestSync('post', '/v0/users/momo/collections', '{"x":1}', 'tok')

    const xhr = lastXhr()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe(`${BGM_CONFIG.API_BASE}/v0/users/momo/collections`)
    expect(xhr.isAsync).toBe(true)
    expect(xhr.timeout).toBe(30_000)
    expect(xhr.body).toBe('{"x":1}')
    expect(xhr.headers.Authorization).toBe('Bearer tok')
    expect(xhr.headers['Content-Type']).toBe('application/json')

    xhr.status = 200
    xhr.responseText = JSON.stringify({ msg: '成功了' })
    xhr.emit('load')

    await expect(promise).resolves.toEqual({ code: 200, message: '成功了' })
  })

  it('请求体长度写进日志', async () => {
    const promise = bgmRequestSync('POST', '/v0/x', '{"y":1}', 'tok')
    expect(hasLog('请求体长度: 7')).toBe(true)

    lastXhr().emit('load')
    await promise
  })

  it('2xx 且响应体为空 → message 保持 success', async () => {
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok')
    const xhr = lastXhr()
    xhr.status = 201
    xhr.responseText = ''

    xhr.emit('load')

    await expect(promise).resolves.toEqual({ code: 201, message: 'success' })
  })

  it('2xx 但响应体非 JSON → 记 warn 并保持 success', async () => {
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok')
    const xhr = lastXhr()
    xhr.status = 200
    xhr.responseText = 'ok-but-not-json'

    xhr.emit('load')

    await expect(promise).resolves.toEqual({ code: 200, message: 'success' })
    expect(hasLog('bgmRequestSync 解析响应 JSON 失败')).toBe(true)
  })

  it('2xx 但 JSON 无消息字段 → success', async () => {
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok')
    const xhr = lastXhr()
    xhr.status = 200
    xhr.responseText = '{}'

    xhr.emit('load')

    await expect(promise).resolves.toEqual({ code: 200, message: 'success' })
  })
})

describe('bgmRequestSync · 失败分支', () => {
  it('429 → Rate limited（不走 parseErrorResponse）', async () => {
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok')
    const xhr = lastXhr()
    xhr.status = 429
    xhr.statusText = 'Too Many Requests'
    xhr.responseText = JSON.stringify({ error: '应被忽略' })

    xhr.emit('load')

    await expect(promise).resolves.toEqual({ code: 429, message: 'Rate limited' })
  })

  it('4xx 带 JSON 错误体 → 用 error 字段', async () => {
    const promise = bgmRequestSync('PUT', '/v0/x', '{}', 'tok')
    const xhr = lastXhr()
    xhr.status = 400
    xhr.statusText = 'Bad Request'
    xhr.responseText = JSON.stringify({ error: '参数不合法' })

    xhr.emit('load')

    await expect(promise).resolves.toEqual({ code: 400, message: '参数不合法' })
  })

  it('5xx 非 JSON 体 → 回退 statusText', async () => {
    const promise = bgmRequestSync('DELETE', '/v0/x', '{}', 'tok')
    const xhr = lastXhr()
    xhr.status = 500
    xhr.statusText = 'Server Error'
    xhr.responseText = 'boom'

    xhr.emit('load')

    await expect(promise).resolves.toEqual({ code: 500, message: 'Server Error' })
  })

  it('网络错误且未 abort → Network error', async () => {
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok')

    lastXhr().emit('error')

    await expect(promise).resolves.toEqual({ code: 0, message: 'Network error' })
  })

  it('超时 → Request timeout', async () => {
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok')

    lastXhr().fireTimeout()

    await expect(promise).resolves.toEqual({ code: 0, message: 'Request timeout' })
  })

  it('调用时 signal 已 aborted → 立即返回「请求被取消」，不发请求', async () => {
    await expect(
      bgmRequestSync('POST', '/v0/x', '{}', 'tok', abortedSignal()),
    ).resolves.toEqual({ code: 0, message: '请求被取消' })
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('请求中 abort → 归类为「请求被取消」而非 Network error', async () => {
    const controller = new AbortController()
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok', controller.signal)
    const xhr = lastXhr()

    controller.abort()

    expect(xhr.abortCount).toBe(1)
    await expect(promise).resolves.toEqual({ code: 0, message: '请求被取消' })
  })

  it('完成后再 abort 不再重复中止（监听器已移除）', async () => {
    const controller = new AbortController()
    const promise = bgmRequestSync('POST', '/v0/x', '{}', 'tok', controller.signal)
    const xhr = lastXhr()
    xhr.status = 200
    xhr.responseText = '{}'
    xhr.emit('load')
    await promise

    controller.abort()

    expect(xhr.abortCount).toBe(0)
  })

  it('XHR 装配阶段抛错 → 外层 catch 兜底，返回错误消息', async () => {
    FakeXhr.throwOnOpen = true

    await expect(bgmRequestSync('POST', '/v0/x', '{}', 'tok')).resolves.toEqual({
      code: 0,
      message: 'open 失败',
    })
    expect(hasLog('bgmRequestSync] 异常: open 失败')).toBe(true)
  })
})

// ========== setBangumiToken ==========

describe('setBangumiToken', () => {
  it('空串 → 返回 false 且不落盘', () => {
    expect(setBangumiToken('')).toBe(false)
    expect(m.storeBgToken).not.toHaveBeenCalled()
  })

  it('正常 Token → 落盘、记日志并返回 true', () => {
    expect(setBangumiToken('tok-123')).toBe(true)

    expect(m.storeBgToken).toHaveBeenCalledWith('tok-123')
    expect(hasLog('Token已保存')).toBe(true)
  })

  it('落盘抛错 → 走 handleError 并返回 false', () => {
    m.storeBgToken.mockImplementation(() => {
      throw new Error('存储不可写')
    })

    expect(setBangumiToken('tok-123')).toBe(false)
    expect(m.handleError.mock.calls[0]?.[1]).toEqual({
      context: 'setBangumiToken',
      showAlert: false,
    })
  })
})

// ========== 日志级别用法 ==========

describe('日志级别用法', () => {
  it('200 成功路径全部落 INFO', () => {
    testTokenValidityForRibbon('tok')
    const xhr = lastXhr()
    xhr.status = 200
    xhr.responseText = '{"nickname":"momo","id":1}'
    xhr.emit('load')

    const levels = new Set(m.bgmLog.mock.calls.map((call) => call[0]))
    expect(levels).toEqual(new Set([LOG_LEVELS.INFO]))
  })

  it('401 落 WARN、其他非 2xx 落 ERROR', () => {
    testTokenValidityForRibbon('tok')
    const unauthorized = lastXhr()
    unauthorized.status = 401
    unauthorized.emit('load')

    expect(
      m.bgmLog.mock.calls.some(
        (call) => call[0] === LOG_LEVELS.WARN && call[1].includes('Token 无效或已过期'),
      ),
    ).toBe(true)

    m.bgmLog.mockClear()
    testTokenValidityForRibbon('tok')
    const failure = lastXhr()
    failure.status = 502
    failure.emit('load')

    expect(
      m.bgmLog.mock.calls.some(
        (call) => call[0] === LOG_LEVELS.ERROR && call[1].includes('Token验证失败，HTTP 状态码: 502'),
      ),
    ).toBe(true)
  })

  it('请求超时落 WARN', () => {
    testTokenValidityForRibbon('tok')

    lastXhr().fireTimeout()

    expect(
      m.bgmLog.mock.calls.some(
        (call) => call[0] === LOG_LEVELS.WARN && call[1].includes('请求超时，耗时'),
      ),
    ).toBe(true)
  })
})
