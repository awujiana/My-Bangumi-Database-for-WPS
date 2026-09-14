// @vitest-environment jsdom
/**
 * @fileoverview `ts/sync/scraping.ts`（Bangumi 拉取：Token 验证 / 收藏分页 / 单条收藏）单元测试。
 *
 * 依赖形状：只 import `core/constants.js`（纯常量）与 `tools/util/index.js` 的 `bgmLog` —— 两个叶子模块，
 * 不需要先拆切片即可就地测（判据见 `REF-testing.md` 第 0 节）。真实 `REQUEST_DELAY=800ms`、
 * `RETRY_DELAY_BASE=2000ms` 会把分页用例拖到秒级，故 `constants` 用**同形状的小延时替身**，
 * 只保留 `API_BASE` 真实语义（URL 断言）。
 *
 * `XMLHttpRequest` 换成**不自动完成**的假实现：由用例显式 `emit('load' | 'error')` / `fireTimeout()` 驱动，
 * 才能分别触发 200 / 401 / 4xx / 429 限流重试 / 解析失败 / 网络错误 / 超时 / 取消 各条分支。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: string, message?: string) => void>(),
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  BGM_CONFIG: {
    API_BASE: 'https://api.example.test',
    REQUEST_DELAY: 1,
    MAX_RETRIES: 2,
    RETRY_DELAY_BASE: 2,
  },
}))

vi.mock('../ts/tools/util/index.js', () => ({ bgmLog: m.bgmLog }))

import {
  fetchAllUserCollections,
  fetchSubjectCollection,
  verifyToken,
} from '../ts/sync/scraping.js'
import type { CollectionItem } from '../ts/sync/scraping.js'

// ========== 假 XMLHttpRequest ==========

/**
 * 假 XHR：只实现被测代码用到的那一面，且**不自动完成请求** ——
 * 由用例显式驱动事件，才能精确命中各条状态分支。
 */
class FakeXhr {
  static readonly instances: FakeXhr[] = []

  /** 非 null 时 `setRequestHeader` 直接抛出该值（用于「非 Error 异常」分支） */
  static throwOnSetHeader: string | null = null

  private readonly listeners = new Map<string, (() => void)[]>()

  status = 200

  statusText = 'OK'

  responseText = '{}'

  timeout = 0

  method = ''

  url = ''

  aborted = false

  headers: Record<string, string> = {}

  ontimeout: (() => void) | null = null

  open(method: string, url: string, _isAsync?: boolean): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string): void {
    if (FakeXhr.throwOnSetHeader !== null) throw FakeXhr.throwOnSetHeader
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

  send(): void {
    FakeXhr.instances.push(this)
  }

  abort(): void {
    this.aborted = true
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

/** 取最近一次请求；没有即说明被测代码没发请求 */
function lastRequest(): FakeXhr {
  const xhr = FakeXhr.instances.at(-1)
  if (!xhr) throw new Error('未发起请求')
  return xhr
}

/** 用给定响应完成最近一次请求 */
function respondWith(status: number, body: string): void {
  const xhr = lastRequest()
  xhr.status = status
  xhr.responseText = body
  xhr.emit('load')
}

/** 让出宏任务，等被测代码内部的延时定时器（REQUEST_DELAY / 限流退避） */
async function settleWaits(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 30)
  })
}

/** 让出微任务队列，供 `await` 链推进（不涉及定时器时使用） */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

interface PageSpec {
  status: number
  body?: string
}

/**
 * 逐页驱动收藏分页请求：第 1 页同步完成，后续页先等一轮延时定时器再完成
 * （被测代码在两次请求之间会 `await setTimeout(REQUEST_DELAY)`）。
 */
async function drivePages(pages: PageSpec[]): Promise<void> {
  for (const [index, page] of pages.entries()) {
    if (index > 0) await settleWaits()
    const xhr = lastRequest()
    xhr.status = page.status
    xhr.responseText = page.body ?? ''
    xhr.emit('load')
  }
}

/** 造一页收藏响应 */
function collectionPage(items: CollectionItem[], total?: number): string {
  return JSON.stringify(total === undefined ? { data: items } : { total, data: items })
}

function collectionItem(subjectId: number): CollectionItem {
  return { subject_id: subjectId, type: 2 }
}

/** 日志消息序列 */
function loggedMessages(): string[] {
  return m.bgmLog.mock.calls.map((call) => call[1] ?? '')
}

function logMessagesContaining(fragment: string): string[] {
  return loggedMessages().filter((message) => message.includes(fragment))
}

beforeEach(() => {
  vi.clearAllMocks()
  FakeXhr.instances.length = 0
  FakeXhr.throwOnSetHeader = null
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ========== verifyToken ==========

describe('verifyToken', () => {
  it('空 Token 直接返回失败，且不发请求', async () => {
    const result = await verifyToken('')

    expect(result).toEqual({ valid: false, message: 'Token 不能为空' })
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('200 且带用户数据 → 有效，并回填 userId / username', async () => {
    const pending = verifyToken('tok-1')
    expect(lastRequest().method).toBe('GET')
    expect(lastRequest().url).toBe('https://api.example.test/v0/me')
    expect(lastRequest().headers.Authorization).toBe('Bearer tok-1')
    expect(lastRequest().headers['Content-Type']).toBe('application/json')
    // 未预设 timeout 时由 requestPromise 补默认值
    expect(lastRequest().timeout).toBe(30_000)

    respondWith(200, JSON.stringify({ id: 42, username: 'momo', nickname: '昵称' }))
    const result = await pending

    expect(result).toEqual({ valid: true, message: 'Token 有效', userId: '42', username: 'momo' })
  })

  it('200 但 id / username / nickname 都缺失 → 用户信息回落为空串', async () => {
    const pending = verifyToken('tok-2b')
    respondWith(200, JSON.stringify({ id: 0 }))

    const result = await pending

    expect(result.userId).toBe('')
    expect(result.username).toBe('')
  })

  it('200 但 username 缺失 → 回退 nickname', async () => {
    const pending = verifyToken('tok-2')
    respondWith(200, JSON.stringify({ id: 7, username: '', nickname: '备用名' }))

    const result = await pending

    expect(result.valid).toBe(true)
    expect(result.username).toBe('备用名')
  })

  it('200 但响应体为空 → 有效但不回填用户信息', async () => {
    const pending = verifyToken('tok-3')
    respondWith(200, '')

    const result = await pending

    expect(result.valid).toBe(true)
    expect(result.userId).toBeUndefined()
    expect(result.username).toBeUndefined()
  })

  it('401 → Token 无效并记 warn 日志', async () => {
    const pending = verifyToken('tok-4')
    respondWith(401, '{}')

    const result = await pending

    expect(result).toEqual({ valid: false, message: 'Token 无效或已过期' })
    expect(logMessagesContaining('Token 无效或已过期')).toHaveLength(1)
  })

  it('其它状态码 → 文案带上状态码并记 error 日志', async () => {
    const pending = verifyToken('tok-5')
    respondWith(503, '{}')

    const result = await pending

    expect(result.message).toBe('验证失败 (HTTP 503)')
    expect(m.bgmLog.mock.calls.at(-1)?.[0]).toBe('ERROR')
  })

  it('响应体不是合法 JSON → 解析失败', async () => {
    const pending = verifyToken('tok-6')
    respondWith(200, '{坏 JSON')

    const result = await pending

    expect(result.valid).toBe(false)
    expect(result.message).toBe('解析响应失败')
  })

  it('网络错误事件 → 网络错误', async () => {
    const pending = verifyToken('tok-7')
    lastRequest().emit('error')

    const result = await pending

    expect(result.message).toBe('网络错误')
  })

  it('超时 → 请求超时', async () => {
    const pending = verifyToken('tok-8')
    lastRequest().fireTimeout()

    const result = await pending

    expect(result.message).toBe('请求超时')
  })

  it('signal 已取消 → 立即失败且不发请求', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await verifyToken('tok-9', controller.signal)

    expect(result.message).toBe('请求被取消')
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('请求发出后 signal 取消 → 归类为取消而非网络错误', async () => {
    const controller = new AbortController()
    const pending = verifyToken('tok-10', controller.signal)
    const xhr = lastRequest()

    controller.abort()

    expect(xhr.aborted).toBe(true)
    const result = await pending
    expect(result.message).toBe('请求被取消')
  })

  it('抛出的不是 Error → 回退到通用文案', async () => {
    FakeXhr.throwOnSetHeader = '字符串异常'

    const result = await verifyToken('tok-11')

    expect(result.message).toBe('验证过程出错')
  })
})

// ========== fetchAllUserCollections ==========

describe('fetchAllUserCollections · 用户 ID 解析', () => {
  it('未传 userId → 先验证 Token；验证失败则不抓收藏', async () => {
    const pending = fetchAllUserCollections('tok')
    respondWith(401, '{}')

    const result = await pending

    expect(result).toEqual([])
    expect(FakeXhr.instances).toHaveLength(1)
    expect(logMessagesContaining('Token无效')).toHaveLength(1)
  })

  it('Token 有效但拿不到用户 ID → 空数组', async () => {
    const pending = fetchAllUserCollections('tok')
    // 空响应体 → userData 为 null → userId 无法回填
    respondWith(200, '')

    const result = await pending

    expect(result).toEqual([])
    expect(logMessagesContaining('无法获取用户ID')).toHaveLength(1)
  })

  it('未传 userId 且验证成功 → 用返回的用户 ID 继续抓收藏', async () => {
    const pending = fetchAllUserCollections('tok')
    respondWith(200, JSON.stringify({ id: 99, username: 'u' }))
    await flushMicrotasks()

    expect(FakeXhr.instances).toHaveLength(2)
    expect(lastRequest().url).toContain('/v0/users/99/collections')

    respondWith(200, collectionPage([collectionItem(1)], 1))
    const result = await pending

    expect(result.map((item) => item.subject_id)).toEqual([1])
  })
})

describe('fetchAllUserCollections · 分页', () => {
  it('单页不足 limit → 一页即结束，并上报进度', async () => {
    const onProgress = vi.fn<(page: number, total: number) => void>()
    const pending = fetchAllUserCollections('tok', '5', {
      limit: 3,
      onProgress,
    })

    expect(lastRequest().url).toBe(
      'https://api.example.test/v0/users/5/collections?limit=3&offset=0',
    )
    expect(lastRequest().timeout).toBe(30_000)

    respondWith(200, collectionPage([collectionItem(1), collectionItem(2)], 2))
    const result = await pending

    expect(result).toHaveLength(2)
    expect(onProgress).toHaveBeenCalledWith(1, 1)
    expect(FakeXhr.instances).toHaveLength(1)
    expect(logMessagesContaining('收藏总数: 2')).toHaveLength(1)
  })

  it('满页后继续翻页，直到不足一页或达到 total', async () => {
    const pending = fetchAllUserCollections('tok', '5', { limit: 2, maxTotal: 10 })

    await drivePages([
      { status: 200, body: collectionPage([collectionItem(1), collectionItem(2)], 3) },
      { status: 200, body: collectionPage([collectionItem(3)], 3) },
    ])
    const result = await pending

    expect(result.map((item) => item.subject_id)).toEqual([1, 2, 3])
    expect(FakeXhr.instances).toHaveLength(2)
    expect(lastRequest().url).toContain('offset=2')
    // 第二页 total 已确定 → 不再重复记录总数
    expect(logMessagesContaining('收藏总数')).toHaveLength(1)
  })

  it('total 超过 maxTotal 时按 maxTotal 截断，且 offset 达上限即停', async () => {
    const pending = fetchAllUserCollections('tok', '5', { limit: 2, maxTotal: 2 })

    await drivePages([
      { status: 200, body: collectionPage([collectionItem(1), collectionItem(2)], 100) },
    ])
    const result = await pending

    expect(result).toHaveLength(2)
    expect(FakeXhr.instances).toHaveLength(1)
    expect(logMessagesContaining('收藏总数: 2')).toHaveLength(1)
  })

  it('响应缺少 data 数组 → 直接结束', async () => {
    const pending = fetchAllUserCollections('tok', '5')

    respondWith(200, JSON.stringify({ total: 10 }))
    const result = await pending

    expect(result).toEqual([])
  })
})

describe('fetchAllUserCollections · 类型过滤与错误', () => {
  it('type 选项映射为收藏类型编号', async () => {
    for (const [type, expected] of [
      ['wish', '&type=1'],
      ['collect', '&type=2'],
      ['do', '&type=3'],
    ] as const) {
      FakeXhr.instances.length = 0
      const pending = fetchAllUserCollections('tok', '5', { type })
      expect(lastRequest().url).toContain(expected)
      respondWith(200, collectionPage([], 0))
      await pending
    }
  })

  it('type 传 null → URL 不带类型参数', async () => {
    const pending = fetchAllUserCollections('tok', '5', { type: null })

    expect(lastRequest().url).not.toContain('type=')
    respondWith(200, collectionPage([], 0))
    await pending
  })

  it('type 传类型以外的值（刻意越界）→ 退回空类型参数而非 undefined', async () => {
    // 类型上不可达，用于锁住 String(typeNumber ?? '') 的兜底；越界输入只在此处断言
    const outOfContract = { type: 'unknown-type' } as unknown as { type: 'collect' }
    const pending = fetchAllUserCollections('tok', '5', outOfContract)

    expect(lastRequest().url).toContain('&type=')
    respondWith(200, collectionPage([], 0))
    await pending
  })

  it('429 限流 → 按指数退避重试，成功后重置计数', async () => {
    const pending = fetchAllUserCollections('tok', '5', { limit: 1 })

    await drivePages([
      { status: 429 },
      { status: 200, body: collectionPage([collectionItem(9)], 1) },
    ])
    const result = await pending

    expect(result).toHaveLength(1)
    expect(FakeXhr.instances).toHaveLength(2)
    // 两次请求 offset 都是 0（重试不推进分页）
    expect(FakeXhr.instances.at(1)?.url).toContain('offset=0')
    expect(logMessagesContaining('API限流，第 1 次重试')).toHaveLength(1)
  })

  it('429 超过最大重试次数 → 记 error 并结束', async () => {
    const pending = fetchAllUserCollections('tok', '5', { limit: 1 })

    await drivePages([{ status: 429 }, { status: 429 }, { status: 429 }])
    const result = await pending

    expect(result).toEqual([])
    expect(FakeXhr.instances).toHaveLength(3)
    expect(logMessagesContaining('API限流')).toHaveLength(2)
    expect(logMessagesContaining('HTTP 429：请求过于频繁，已超过最大重试次数')).toHaveLength(1)
    expect(loggedMessages().some((message) => message.includes('请求失败'))).toBe(true)
  })

  it('非 429 的 HTTP 错误 → 记 error 并结束，不重试', async () => {
    const pending = fetchAllUserCollections('tok', '5')

    respondWith(500, '{}')
    const result = await pending

    expect(result).toEqual([])
    expect(FakeXhr.instances).toHaveLength(1)
    expect(logMessagesContaining('请求失败: HTTP 500')).toHaveLength(1)
  })

  it('status 为 0 也按 HTTP 错误处理', async () => {
    const pending = fetchAllUserCollections('tok', '5')

    respondWith(0, '')
    await pending

    expect(logMessagesContaining('请求失败: HTTP 0')).toHaveLength(1)
  })

  it('解析失败同样被 catch 归类为请求失败', async () => {
    const pending = fetchAllUserCollections('tok', '5')

    respondWith(200, '{坏 JSON')
    await pending

    expect(logMessagesContaining('请求失败: 解析响应失败')).toHaveLength(1)
  })

  it('抛出的不是 Error → 日志不追加以异常文案，但仍结束', async () => {
    FakeXhr.throwOnSetHeader = '字符串异常'

    const result = await fetchAllUserCollections('tok', '5')

    expect(result).toEqual([])
    expect(logMessagesContaining('请求失败:')).toHaveLength(1)
  })
})

// ========== fetchSubjectCollection ==========

describe('fetchSubjectCollection', () => {
  it('2xx → 返回数据并标记 success', async () => {
    const pending = fetchSubjectCollection('tok', '123')

    expect(lastRequest().url).toBe('https://api.example.test/v0/users/-/collections/123')
    respondWith(200, JSON.stringify({ subject_id: 123, type: 2 }))
    const result = await pending

    expect(result.status).toBe(200)
    expect(result.message).toBe('success')
    expect(result.data).toEqual({ subject_id: 123, type: 2 })
  })

  it('非 2xx → 文案带上状态码', async () => {
    const pending = fetchSubjectCollection('tok', '123')
    respondWith(404, '{}')

    const result = await pending

    expect(result).toEqual({ data: null, status: 404, message: 'HTTP 404' })
  })

  it('请求异常且不是 Error → 回退通用文案', async () => {
    FakeXhr.throwOnSetHeader = '字符串异常'

    const result = await fetchSubjectCollection('tok', '123')

    expect(result).toEqual({ data: null, status: 0, message: '请求失败' })
    expect(logMessagesContaining('请求失败')).toHaveLength(1)
  })

  it('请求超时 → 文案为超时信息', async () => {
    const pending = fetchSubjectCollection('tok', '123')
    lastRequest().fireTimeout()

    const result = await pending

    expect(result.message).toBe('请求超时')
  })
})
