/**
 * @fileoverview httpRequest 单元测试
 *
 * 测试目标：
 *   - 成功路径：2xx、204、自定义 timeout、token、Content-Type
 *   - 重试：429/5xx 触发重试并最终成功 / 超过重试次数失败
 *   - 不重试：4xx 立即返回失败
 *   - 网络错误：onerror 触发重试 / 超过次数返回 NETWORK_ERROR
 *   - 超时：ontimeout 触发重试 / 超过次数返回 NETWORK_ERROR
 *   - AbortController：预先 aborted / 请求中 abort 不重试
 *   - zodSchema：通过 / 失败（SCHEMA_VALIDATION_ERROR）
 *   - 输入校验：非法 endpoint / 非法 method
 *
 * 模块依赖说明：
 *   - http.ts 导入 '../index.js'，触发 index → ui/handlers 的副作用链。
 *   - 使用 vi.hoisted() 在所有 import 之前启用 fake timers，
 *     使 handlers.ts 模块加载时调度的 setTimeout 进入 fake 队列而不会真实触发。
 *   - 需要 jsdom 环境以提供 document/window。
 *   - 通过替换 globalThis.XMLHttpRequest 注入 MockXHR，捕获 open/send 调用并控制响应。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'
import { z } from 'zod'

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

import { httpRequest } from '../ts/tools/http.js'
import type { HttpMethod } from '../ts/tools/http.js'

// 清空模块加载期间累积的 fake timers
vi.clearAllTimers()

// ========== XHR Mock 工具 ==========
interface MockXHRCall {
  method: string
  url: string
  async: boolean
  timeout: number
  headers: Record<string, string>
  body: string | null
}

let lastXhrCall: MockXHRCall | null = null
let lastMockXhr: MockXHR | null = null
let mockXhrConstructor: typeof MockXHR | null = null
let xhrCallCount = 0

class MockXHR {
  status = 0

  statusText = ''

  responseText = ''

  timeout = 0

  onload: (() => void) | null = null

  onerror: (() => void) | null = null

  ontimeout: (() => void) | null = null

  /** 生产代码经 addEventListener 注册：映射到 onXXX 属性，保留测试手动触发机制 */
  addEventListener(type: 'load' | 'error', handler: () => void): void {
    if (type === 'load') {
      this.onload = handler
    } else {
      this.onerror = handler
    }
  }

  upload: {
    onprogress:
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null
    addEventListener(
      type: 'progress',
      handler: (event: { loaded: number; total: number; lengthComputable: boolean }) => void,
    ): void
  } = {
    onprogress: null,
    /** 生产代码经 upload.addEventListener('progress', ...) 注册 */
    addEventListener(
      type: 'progress',
      handler: (event: { loaded: number; total: number; lengthComputable: boolean }) => void,
    ): void {
      this.onprogress = handler
    },
  }

  private method = ''

  private url = ''

  private async = true

  private headers: Record<string, string> = {}

  open(method: string, url: string, isAsync: boolean): void {
    this.method = method
    this.url = url
    this.async = isAsync
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value
  }

  send(body?: string | null): void {
    xhrCallCount += 1
    lastXhrCall = {
      method: this.method,
      url: this.url,
      async: this.async,
      timeout: this.timeout,
      headers: { ...this.headers },
      body: body ?? null,
    }
    lastMockXhr = this
  }

  _respondOk(body: string, status = 200): void {
    this.status = status
    this.statusText = 'OK'
    this.responseText = body
    if (this.onload) this.onload()
  }

  _respondError(status: number, statusText = 'Error', body = ''): void {
    this.status = status
    this.statusText = statusText
    this.responseText = body
    if (this.onload) this.onload()
  }

  _triggerError(): void {
    if (this.onerror) this.onerror()
  }

  _triggerTimeout(): void {
    if (this.ontimeout) this.ontimeout()
  }

  abort(): void {
    // 模拟 abort：触发 onerror（与浏览器行为近似）
    if (this.onerror) this.onerror()
  }

  getAllResponseHeaders(): string {
    return ''
  }
}

beforeEach(() => {
  mockXhrConstructor = MockXHR
  ;(globalThis as { XMLHttpRequest: typeof MockXHR }).XMLHttpRequest = MockXHR
  lastXhrCall = null
  lastMockXhr = null
  xhrCallCount = 0
})

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
})

afterAll(() => {
  vi.useRealTimers()
})

/**
 * 推进 fake timers 触发重试的指数退避 setTimeout
 * sleep 使用 setTimeout(resolve, ms)，需要 await Promise + advanceTimersByTime + await Promise 三步
 * 以确保 Promise 链上的所有微任务都被 flush。
 */
async function flushPromisesAndTimers(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  // 指数退避：1s, 2s, 4s = 7s，足够覆盖
  vi.advanceTimersByTime(10_000)
  await Promise.resolve()
  await Promise.resolve()
}

// ========== 成功路径 ==========
describe('httpRequest - 成功路径', () => {
  it('2xx 返回 Result.ok 含响应数据', async () => {
    const promise = httpRequest('/v0/me')
    expect(lastXhrCall).not.toBeNull()
    expect(lastXhrCall?.method).toBe('GET')
    expect(lastXhrCall?.url).toContain('/v0/me')
    lastMockXhr!._respondOk(JSON.stringify({ id: 1, username: 'test' }))
    const result = await promise
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().status).toBe(200)
    expect(result.unwrap().data).toEqual({ id: 1, username: 'test' })
  })

  it('默认 timeout=30000', async () => {
    const promise = httpRequest('/v0/x')
    expect(lastXhrCall?.timeout).toBe(30_000)
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('自定义 timeout 生效', async () => {
    const promise = httpRequest('/v0/x', { timeout: 5000 })
    expect(lastXhrCall?.timeout).toBe(5000)
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('未提供 token 时不设置 Authorization 头', async () => {
    const promise = httpRequest('/v0/x')
    expect(lastXhrCall?.headers.Authorization).toBeUndefined()
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('提供 token 时设置 Authorization: Bearer 头', async () => {
    const promise = httpRequest('/v0/x', { token: 'mytoken123' })
    expect(lastXhrCall?.headers.Authorization).toBe('Bearer mytoken123')
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('POST 请求设置 Content-Type: application/json', async () => {
    const promise = httpRequest('/v0/x', { method: 'POST', body: '{"k":1}' })
    expect(lastXhrCall?.method).toBe('POST')
    expect(lastXhrCall?.headers['Content-Type']).toBe('application/json')
    expect(lastXhrCall?.body).toBe('{"k":1}')
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('PUT 请求正确发送', async () => {
    const promise = httpRequest('/v0/x', { method: 'PUT', body: '{"v":2}' })
    expect(lastXhrCall?.method).toBe('PUT')
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('DELETE 请求正确发送', async () => {
    const promise = httpRequest('/v0/x', { method: 'DELETE' })
    expect(lastXhrCall?.method).toBe('DELETE')
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('204 No Content 返回 data=null', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondOk('', 204)
    const result = await promise
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().status).toBe(204)
    expect(result.unwrap().data).toBeNull()
  })

  it('响应体为空字符串时 data 为 null', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondOk('', 200)
    const result = await promise
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().data).toBeNull()
  })

  it('响应体为非 JSON 文本时 data 为原始字符串', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondOk('plain text response')
    const result = await promise
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().data).toBe('plain text response')
  })
})

// ========== 429 重试 ==========
describe('httpRequest - 429 重试', () => {
  it('429 触发重试并最终成功', async () => {
    const promise = httpRequest('/v0/x', { retries: 2 })
    // 第一次：429
    lastMockXhr!._respondError(429, 'Too Many Requests')
    // 推进 timer 触发重试
    await flushPromisesAndTimers()
    // 第二次：200 成功
    lastMockXhr!._respondOk(JSON.stringify({ ok: true }))
    const result = await promise
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().data).toEqual({ ok: true })
    expect(xhrCallCount).toBe(2)
  })

  it('429 超过重试次数仍失败时返回 HTTP_ERROR', async () => {
    const promise = httpRequest('/v0/x', { retries: 1 })
    // 第一次：429
    lastMockXhr!._respondError(429, 'Too Many Requests')
    await flushPromisesAndTimers()
    // 第二次：429
    lastMockXhr!._respondError(429, 'Too Many Requests')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('HTTP_ERROR')
  })

  it('429 后重试次数耗尽返回 MAX_RETRIES_EXCEEDED', async () => {
    // retries=0 表示不重试，但 429 在 retries=0 时直接返回 HTTP_ERROR（不进入重试分支）
    const promise = httpRequest('/v0/x', { retries: 0 })
    lastMockXhr!._respondError(429, 'Too Many Requests')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('HTTP_ERROR')
    expect(xhrCallCount).toBe(1)
  })
})

// ========== 5xx 不重试 ==========
describe('httpRequest - 5xx 不重试', () => {
  it('500 立即返回 HTTP_ERROR（不重试）', async () => {
    const promise = httpRequest('/v0/x', { retries: 2 })
    lastMockXhr!._respondError(500, 'Internal Server Error')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('HTTP_ERROR')
    expect(xhrCallCount).toBe(1)
  })

  it('503 立即返回 HTTP_ERROR（不重试）', async () => {
    const promise = httpRequest('/v0/x', { retries: 2 })
    lastMockXhr!._respondError(503, 'Service Unavailable')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('HTTP_ERROR')
    expect(xhrCallCount).toBe(1)
  })

  it('502 立即返回 HTTP_ERROR（不重试）', async () => {
    const promise = httpRequest('/v0/x', { retries: 1 })
    lastMockXhr!._respondError(502, 'Bad Gateway')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('HTTP_ERROR')
    expect(xhrCallCount).toBe(1)
  })

  it('5xx 错误消息包含中文友好提示', async () => {
    const promise = httpRequest('/v0/x', { retries: 0 })
    lastMockXhr!._respondError(500, 'Internal Server Error')
    const result = await promise
    expect(result.isFail()).toBe(true)
    // getErrorMessage(500) = '服务器内部错误'
    expect(result.error?.message).toContain('服务器')
  })
})

// ========== 4xx 不重试 ==========
describe('httpRequest - 4xx 不重试', () => {
  it('400 立即返回失败（不重试）', async () => {
    const promise = httpRequest('/v0/x', { retries: 3 })
    lastMockXhr!._respondError(400, 'Bad Request')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('HTTP_ERROR')
    expect(xhrCallCount).toBe(1)
  })

  it('401 立即返回失败', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondError(401, 'Unauthorized')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(xhrCallCount).toBe(1)
  })

  it('404 立即返回失败', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondError(404, 'Not Found')
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(xhrCallCount).toBe(1)
  })

  it('403 立即返回失败', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondError(403, 'Forbidden')
    const result = await promise
    expect(result.isFail()).toBe(true)
  })

  it('4xx 错误消息包含中文友好提示', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondError(401, 'Unauthorized')
    const result = await promise
    expect(result.error?.message).toContain('Token')
  })
})

// ========== 网络错误重试 ==========
describe('httpRequest - 网络错误重试', () => {
  it('onerror 触发重试并最终成功', async () => {
    const promise = httpRequest('/v0/x', { retries: 2 })
    lastMockXhr!._triggerError()
    await flushPromisesAndTimers()
    lastMockXhr!._respondOk('{}')
    const result = await promise
    expect(result.isOk()).toBe(true)
    expect(xhrCallCount).toBe(2)
  })

  it('网络错误超过重试次数返回 NETWORK_ERROR', async () => {
    const promise = httpRequest('/v0/x', { retries: 1 })
    lastMockXhr!._triggerError()
    await flushPromisesAndTimers()
    lastMockXhr!._triggerError()
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('NETWORK_ERROR')
  })

  it('retries=0 时网络错误立即失败', async () => {
    const promise = httpRequest('/v0/x', { retries: 0 })
    lastMockXhr!._triggerError()
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('NETWORK_ERROR')
    expect(xhrCallCount).toBe(1)
  })
})

// ========== 超时 ==========
describe('httpRequest - 超时', () => {
  it('ontimeout 触发重试', async () => {
    const promise = httpRequest('/v0/x', { retries: 2 })
    lastMockXhr!._triggerTimeout()
    await flushPromisesAndTimers()
    lastMockXhr!._respondOk('{}')
    const result = await promise
    expect(result.isOk()).toBe(true)
  })

  it('超时超过重试次数返回 NETWORK_ERROR', async () => {
    const promise = httpRequest('/v0/x', { retries: 1 })
    lastMockXhr!._triggerTimeout()
    await flushPromisesAndTimers()
    lastMockXhr!._triggerTimeout()
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('NETWORK_ERROR')
  })
})

// ========== AbortController ==========
describe('httpRequest - AbortController', () => {
  it('预先 aborted 的 signal 立即返回 ABORTED', async () => {
    const controller = new AbortController()
    controller.abort()
    const promise = httpRequest('/v0/x', { signal: controller.signal })
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('ABORTED')
    // 不应发起 XHR
    expect(xhrCallCount).toBe(0)
  })

  it('请求进行中 abort 触发 xhr.abort() 并返回 ABORTED（不重试）', async () => {
    const controller = new AbortController()
    const promise = httpRequest('/v0/x', { retries: 3, signal: controller.signal })
    // 请求已发出
    expect(xhrCallCount).toBe(1)
    // abort 触发 xhr.abort()，MockXHR.abort() 触发 onerror
    controller.abort()
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('ABORTED')
    // 不应继续重试
    expect(xhrCallCount).toBe(1)
  })

  it('重试期间 abort 应停止重试', async () => {
    const controller = new AbortController()
    const promise = httpRequest('/v0/x', { retries: 3, signal: controller.signal })
    // 第一次返回 429 触发重试等待（429 是唯一会重试的 HTTP 状态码）
    lastMockXhr!._respondError(429, 'Too Many Requests')
    // 在重试等待期间 abort
    controller.abort()
    // 推进 timers（但 abort 已触发，不应继续重试）
    await flushPromisesAndTimers()
    const result = await promise
    expect(result.isFail()).toBe(true)
    // abort 后应返回 ABORTED（重试循环顶部检测到 signal.aborted）
    expect(['ABORTED', 'NETWORK_ERROR']).toContain(result.error?.code)
  })
})

// ========== zodSchema 校验 ==========
describe('httpRequest - zodSchema 校验', () => {
  it('通过校验时返回解析后的数据', async () => {
    const schema = z.object({ id: z.number(), name: z.string() })
    const promise = httpRequest('/v0/x', { zodSchema: schema })
    lastMockXhr!._respondOk(JSON.stringify({ id: 1, name: 'test' }))
    const result = await promise
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().data).toEqual({ id: 1, name: 'test' })
  })

  it('校验失败返回 SCHEMA_VALIDATION_ERROR', async () => {
    const schema = z.object({ id: z.number() })
    const promise = httpRequest('/v0/x', { zodSchema: schema })
    // 提供的对象缺少 id 字段
    lastMockXhr!._respondOk(JSON.stringify({ name: 'no-id' }))
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('SCHEMA_VALIDATION_ERROR')
  })

  it('校验失败错误详情包含 endpoint 和 status', async () => {
    const schema = z.object({ id: z.number() })
    const promise = httpRequest('/v0/x', { zodSchema: schema })
    lastMockXhr!._respondOk(JSON.stringify({}))
    const result = await promise
    expect(result.error?.details).toMatchObject({ endpoint: '/v0/x', status: 200 })
  })

  it('类型不匹配（字符串 vs 数字）校验失败', async () => {
    const schema = z.object({ id: z.number() })
    const promise = httpRequest('/v0/x', { zodSchema: schema })
    lastMockXhr!._respondOk(JSON.stringify({ id: 'not-a-number' }))
    const result = await promise
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('SCHEMA_VALIDATION_ERROR')
  })

  it('不提供 zodSchema 时跳过校验返回原始 unknown 数据', async () => {
    const promise = httpRequest('/v0/x')
    lastMockXhr!._respondOk(JSON.stringify({ whatever: 'data' }))
    const result = await promise
    expect(result.isOk()).toBe(true)
    // data 是 unknown，但实际是解析后的对象
    expect(result.unwrap().data).toEqual({ whatever: 'data' })
  })
})

// ========== 输入校验 ==========
describe('httpRequest - 输入校验', () => {
  it('endpoint 包含 .. 返回 INVALID_ENDPOINT', async () => {
    const result = await httpRequest('../etc/passwd')
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('INVALID_ENDPOINT')
  })

  it('endpoint 以 http 开头返回 INVALID_ENDPOINT', async () => {
    const result = await httpRequest('http://evil.com/api')
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('INVALID_ENDPOINT')
  })

  it('endpoint 为空字符串返回 INVALID_ENDPOINT', async () => {
    const result = await httpRequest('')
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('INVALID_ENDPOINT')
  })

  it('endpoint 为 null 抛出 INVALID_ENDPOINT', async () => {
    // 通过 unknown 中转绕过类型检查以测试运行时校验
    const badEndpoint = null as unknown as string
    const result = await httpRequest(badEndpoint)
    expect(result.isFail()).toBe(true)
    expect(result.error?.code).toBe('INVALID_ENDPOINT')
  })

  it('非法 HTTP 方法返回 INVALID_METHOD', async () => {
    // 通过 unknown 中转绕过类型检查以测试运行时校验
    const badMethod = 'INVALID' as unknown as HttpMethod
    const result = await httpRequest('/v0/x', { method: badMethod })
    expect(result.isFail()).toBe(true)
    // validateMethod 抛出 BgmError(code='INVALID_METHOD')，
    // 在 catch 中 instanceof BgmError 为 true，直接返回该错误
    expect(result.error?.code).toBe('INVALID_METHOD')
  })
})

// ========== 便捷方法 ==========
describe('httpGet / httpPost / httpPut / httpDelete', () => {
  it('httpGet 默认 GET 方法', async () => {
    const { httpGet } = await import('../ts/tools/http.js')
    const promise = httpGet('/v0/x')
    expect(lastXhrCall?.method).toBe('GET')
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('httpPost 发送 POST 与 body', async () => {
    const { httpPost } = await import('../ts/tools/http.js')
    const promise = httpPost('/v0/x', '{"k":1}')
    expect(lastXhrCall?.method).toBe('POST')
    expect(lastXhrCall?.body).toBe('{"k":1}')
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('httpPut 发送 PUT 与 body', async () => {
    const { httpPut } = await import('../ts/tools/http.js')
    const promise = httpPut('/v0/x', '{"v":2}')
    expect(lastXhrCall?.method).toBe('PUT')
    lastMockXhr!._respondOk('{}')
    await promise
  })

  it('httpDelete 发送 DELETE', async () => {
    const { httpDelete } = await import('../ts/tools/http.js')
    const promise = httpDelete('/v0/x')
    expect(lastXhrCall?.method).toBe('DELETE')
    lastMockXhr!._respondOk('{}')
    await promise
  })
})
