// @vitest-environment jsdom
/**
 * @fileoverview `ts/sync/exceltobangumi/chapter-marker.ts` 单元测试。
 *
 * 该模块是「XHR 取章节 + PATCH 标记」两段式编排：`fetchEpisodeIds` 自己开 XHR，
 * `markEpisodesComplete` 则复用 `api.ts` 的 `bgmRequestSync`。因此这里
 *   - 用可编程的假 `XMLHttpRequest` 驱动 `fetchEpisodeIds` 的各条回调分支；
 *   - mock 掉 `./api.js` 的 `bgmRequestSync`，只断言参数与返回码分支。
 *
 * 断言打到真实的 Promise 结果与真实请求参数上（URL / 请求头 / PATCH body），
 * 而不是「mock 被调用了」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ========== 假 XHR ==========

class FakeXhr {
  static readonly instances: FakeXhr[] = []

  private readonly listeners = new Map<string, (() => void)[]>()

  status = 0

  responseText = ''

  timeout = 0

  ontimeout: (() => void) | null = null

  isAborted = false

  method = ''

  url = ''

  headers: Record<string, string> = {}

  isSent = false

  constructor() {
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string): void {
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

  send(): void {
    this.isSent = true
  }

  abort(): void {
    this.isAborted = true
  }

  /** 测试侧主动触发某个事件（load / error） */
  emit(type: string): void {
    const handlers = this.listeners.get(type) ?? []
    for (const handler of handlers) handler()
  }
}

/** 取最近一次构造的假 XHR */
function latestXhr(): FakeXhr {
  const instance = FakeXhr.instances.at(-1)
  if (!instance) throw new Error('尚未创建 XHR 实例')
  return instance
}

// ========== mock ==========

const m = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  bgmRequestSync: vi.fn(),
}))

vi.mock('../ts/tools/util/index.js', () => ({ bgmLog: m.bgmLog }))
vi.mock('../ts/sync/exceltobangumi/api.js', () => ({ bgmRequestSync: m.bgmRequestSync }))

import { BGM_CONFIG } from '../ts/core/constants.js'
import { fetchEpisodeIds, markEpisodesComplete } from '../ts/sync/exceltobangumi/chapter-marker.js'

/**
 * 先发起 `markEpisodesComplete`，再驱动**它内部那次** `fetchEpisodeIds` 创建的假 XHR。
 *
 * ⚠️ 不能预先单独调一次 `fetchEpisodeIds` 来「预热」：那是另一个 Promise、另一个 XHR，
 * 而 `markEpisodesComplete` 内部 `await` 的永远是它自己发起的那次，会一直挂到用例超时
 * （表现为 5000ms timeout，而不是断言失败）。由于 `fetchEpisodeIds` 的 Promise 执行器
 * 是同步运行的，`markEpisodesComplete(...)` 调用返回时内部 XHR 必然已构造完成。
 */
function startMark(
  epCount: number,
  ids: number[],
  token = 'tok',
  signal?: AbortSignal,
): Promise<{ success: boolean; message: string }> {
  const resultPromise = markEpisodesComplete(999, epCount, token, signal)
  const xhr = latestXhr()
  xhr.status = 200
  xhr.responseText = JSON.stringify({ data: ids.map((id, index) => ({ id, sort: index + 1 })) })
  xhr.emit('load')
  return resultPromise
}

beforeEach(() => {
  vi.clearAllMocks()
  FakeXhr.instances.length = 0
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ========== fetchEpisodeIds ==========

describe('fetchEpisodeIds', () => {
  it('signal 已 abort → 直接 reject 且不发请求', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(fetchEpisodeIds(123, 'tok', controller.signal)).rejects.toThrow('请求被取消')

    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('成功响应 → 按 sort 升序返回章节 id，并带上 URL / 超时 / 鉴权头', async () => {
    const promise = fetchEpisodeIds('42', 'my-token')
    const xhr = latestXhr()

    expect(xhr.method).toBe('GET')
    expect(xhr.url).toBe(`${BGM_CONFIG.API_BASE}/v0/episodes?subject_id=42&limit=1000`)
    expect(xhr.timeout).toBe(30_000)
    expect(xhr.headers.Authorization).toBe('Bearer my-token')

    xhr.status = 200
    xhr.responseText = JSON.stringify({
      data: [
        { id: 300, sort: 3 },
        { id: 100, sort: 1 },
        { id: 200, sort: 2 },
      ],
    })
    xhr.emit('load')

    await expect(promise).resolves.toEqual([100, 200, 300])
    expect(xhr.isSent).toBe(true)
  })

  it('章节 sort 缺失或为 0 → 按 0 参与排序', async () => {
    const promise = fetchEpisodeIds(7, 'tok')
    const xhr = latestXhr()

    xhr.status = 200
    xhr.responseText = JSON.stringify({ data: [{ id: 2, sort: 0 }, { id: 1, sort: 5 }] })
    xhr.emit('load')

    await expect(promise).resolves.toEqual([2, 1])
  })

  it('data 缺失时按空数组处理', async () => {
    const promise = fetchEpisodeIds(1, 'tok')
    const xhr = latestXhr()

    xhr.status = 200
    xhr.responseText = '{}'
    xhr.emit('load')

    await expect(promise).resolves.toEqual([])
  })

  it('响应不是合法 JSON → reject 解析失败', async () => {
    const promise = fetchEpisodeIds(1, 'tok')
    const xhr = latestXhr()

    xhr.status = 200
    xhr.responseText = '<html>网关错误</html>'
    xhr.emit('load')

    await expect(promise).rejects.toThrow('解析章节数据失败')
  })

  it('非 2xx → reject 并带上状态码与响应体', async () => {
    const promise = fetchEpisodeIds(1, 'tok')
    const xhr = latestXhr()

    xhr.status = 503
    xhr.responseText = 'Service Unavailable'
    xhr.emit('load')

    await expect(promise).rejects.toThrow('HTTP 503: Service Unavailable')
  })

  it('网络错误 → reject 网络错误', async () => {
    const promise = fetchEpisodeIds(1, 'tok')
    const xhr = latestXhr()

    xhr.emit('error')

    await expect(promise).rejects.toThrow('网络错误')
  })

  it('已 abort 后的 error 事件 → 归类为取消', async () => {
    const controller = new AbortController()
    const promise = fetchEpisodeIds(1, 'tok', controller.signal)
    const xhr = latestXhr()

    controller.abort()
    expect(xhr.isAborted).toBe(true)

    xhr.emit('error')

    await expect(promise).rejects.toThrow('请求被取消')
  })

  it('超时 → reject 并提示 30s', async () => {
    const promise = fetchEpisodeIds(1, 'tok')
    const xhr = latestXhr()

    xhr.ontimeout?.()

    await expect(promise).rejects.toThrow('请求章节数据超时（30s）')
  })
})

// ========== markEpisodesComplete ==========

describe('markEpisodesComplete', () => {
  it('该条目没有章节数据 → 失败且不调用 PATCH', async () => {
    const result = await startMark(3, [])

    expect(result).toEqual({ success: false, message: '该条目没有章节数据' })
    expect(m.bgmRequestSync).not.toHaveBeenCalled()
  })

  it('epCount 为 0 → 没有需要标记的章节', async () => {
    const result = await startMark(0, [1, 2, 3])

    expect(result).toEqual({ success: false, message: '没有需要标记的章节' })
    expect(m.bgmRequestSync).not.toHaveBeenCalled()
  })

  it('2xx → 成功并回报实际标记集数，PATCH body 只含前 N 集', async () => {
    m.bgmRequestSync.mockResolvedValue({ code: 204, message: '' })

    const result = await startMark(2, [11, 12, 13, 14])

    expect(result).toEqual({ success: true, message: '已标记前 2 集为已完成' })
    expect(m.bgmRequestSync).toHaveBeenCalledWith(
      'PATCH',
      '/v0/users/-/collections/999/episodes',
      JSON.stringify({ episode_id: [11, 12], type: 2 }),
      'tok',
      undefined,
    )
  })

  it('非 2xx → 透传服务端 message', async () => {
    m.bgmRequestSync.mockResolvedValue({ code: 401, message: 'Unauthorized' })

    const result = await startMark(2, [11, 12])

    expect(result).toEqual({ success: false, message: 'Unauthorized' })
  })

  it('fetchEpisodeIds 抛错 → 记 WARN 并返回失败（Error 消息）', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await markEpisodesComplete(999, 2, 'tok', controller.signal)

    expect(result).toEqual({ success: false, message: '请求被取消' })
    expect(FakeXhr.instances).toHaveLength(0)
    expect(m.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('markEpisodesComplete 异常'),
    )
  })

  it('抛出的不是 Error 时 → 返回「未知错误」', async () => {
    // 章节请求成功、后续 PATCH 抛非 Error 值，走同一个 catch 的另一半分支。
    m.bgmRequestSync.mockRejectedValue('字符串错误')

    const result = await startMark(1, [1, 2])

    expect(result).toEqual({ success: false, message: '未知错误' })
  })
})
