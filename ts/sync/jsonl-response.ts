/**
 * @fileoverview 数据源响应解码（支持 gzip 压缩的 JSONL）
 * @module sync/jsonlResponse
 * @description 数据源文件 `data/bangumi.jsonlines.gz` 是 gzip 压缩的
 *              「表头 + 值数组」两段式 JSON Lines。本模块把各同步源
 *              （GitHub / GitLab / Gitee / 本地文件）拿到的响应体统一解码为 JSONL 文本。
 *
 * 为什么需要它：
 *   1. 明文 JSONL 有 55.83 MiB，超过 GitHub 单文件 50 MB 建议上限（push 报 GH001 警告），
 *      且 raw CDN 对该文件**不做**透明 gzip（实测返回 `application/octet-stream`、
 *      无 `Content-Encoding`），客户端每次同步都要拉满 55.83 MiB。
 *      改存 `.gz` 后仓库体积与单次下载量都降到 20.86 MiB（−63%）。
 *   2. 解压只能在客户端做，因此各同步源统一走 `readXhrJsonlText()`。
 *
 * 设计要点：
 *   - **按魔数判断，不按扩展名**：`1f 8b` 即 gzip。这样明文数据源、
 *     已被 CDN 透明解压过的响应、以及真正的 gzip 响应三种情况都能正确处理。
 *   - 用宿主原生 `DecompressionStream('gzip')` 解压，零第三方依赖。
 *   - 宿主不支持 `DecompressionStream` 时抛出可读错误，而不是让 parseJsonl
 *     在二进制乱码上报出一堆「JSONL 解析失败」。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog } from '../tools/utility.js'

/** gzip 魔数（RFC 1952：ID1 = 0x1f，ID2 = 0x8b） */
const GZIP_MAGIC_1 = 0x1f
const GZIP_MAGIC_2 = 0x8b

/**
 * 判断字节流是否为 gzip（按魔数，与扩展名无关）
 * @param bytes 响应体字节
 * @returns 是 gzip 返回 true
 */
export function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_1 && bytes[1] === GZIP_MAGIC_2
}

/**
 * 当前宿主是否提供原生 gzip 解压能力
 * @returns 支持返回 true
 */
export function hasGzipSupport(): boolean {
  return typeof DecompressionStream === 'function'
}

/**
 * 解压 gzip 字节流
 *
 * 用 `Blob → ReadableStream → pipeThrough(DecompressionStream)` 组合：
 * 读写在流内部并发推进。**不能**写成「先 `await writer.write()` 全部写完再读」——
 * DecompressionStream 有背压，数据超过管道缓冲时会双向等待而死锁
 * （20.86 MiB 远超缓冲，必然触发）。
 *
 * 参数限定为 `Uint8Array<ArrayBuffer>`：`BlobPart` 不接受 SharedArrayBuffer 后备的视图。
 *
 * @param bytes gzip 字节流
 * @returns 解压后的字节流
 * @throws 宿主不支持 DecompressionStream、或数据不是合法 gzip 时抛出 Error
 */
export async function gunzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (!hasGzipSupport()) {
    throw new Error(
      '当前运行环境不支持 DecompressionStream，无法解压 gzip 数据文件；' +
        '请升级宿主（WPS / Excel）版本，或在同步设置中改用未压缩的 .jsonlines 数据源',
    )
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * 把响应字节解码为 JSONL 文本（检测到 gzip 魔数时先解压）
 * @param bytes 响应体字节
 * @returns JSONL 文本（UTF-8）
 */
export async function decodeJsonlBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!isGzipBytes(bytes)) {
    return new TextDecoder('utf-8').decode(bytes)
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[jsonlResponse] 检测到 gzip 数据（${String(bytes.length)} 字节），开始解压`,
  )
  const plain = await gunzipBytes(bytes)
  bgmLog(
    LOG_LEVELS.INFO,
    `[jsonlResponse] 解压完成：${String(bytes.length)} -> ${String(plain.length)} 字节`,
  )
  return new TextDecoder('utf-8').decode(plain)
}

/**
 * 读取 XHR 响应体并解码为 JSONL 文本
 *
 * 兼容两种 responseType：
 *   - `'arraybuffer'`（远程源使用）：拿得到原始字节，能识别并解压 gzip；
 *     若 CDN 已按 `Content-Encoding: gzip` 透明解压，字节里就是明文，直接解码。
 *   - 默认 `'text'`（测试桩 / 降级路径）：直接返回 `responseText`。
 *
 * @param xhr 已触发 load 的 XMLHttpRequest
 * @returns JSONL 文本
 */
export async function readXhrJsonlText(xhr: XMLHttpRequest): Promise<string> {
  const body: unknown = xhr.response
  if (body instanceof ArrayBuffer) {
    return decodeJsonlBytes(new Uint8Array(body))
  }
  return xhr.responseText
}

/** 远程请求默认超时（毫秒）—— 四个同步源原本各自定义一份，收敛到此 */
export const REMOTE_REQUEST_TIMEOUT_MS = 30_000

/** {@link createRawTextFetcher} 的配置 */
export interface RawTextFetcherOptions {
  /** 日志前缀，如 `'githubSync'` */
  logTag: string
  /** 由「仓库内相对路径」构造完整下载 URL（可抛配置错误） */
  buildUrl: (relativePath: string) => string
  /** 404 / 403 的文案（各源措辞不同，地址已由调用方插值） */
  messages: {
    notFound: (url: string) => string
    forbidden: (url: string) => string
  }
  /** Accept 请求头，默认 `application/json` */
  acceptHeader?: string
  /** 是否按 arraybuffer 取原始字节（gzip 数据源必须），默认 true */
  rawBytes?: boolean
  /** 超时（毫秒），默认 {@link REMOTE_REQUEST_TIMEOUT_MS} */
  timeoutMs?: number
}

/**
 * 构造「按仓库内相对路径下载并解码文本」的 fetcher
 *
 * GitHub / Gitee / GitLab 三个 raw 源的取数流程**完全同构**：
 * 构 URL（可抛配置错误）→ 已取消早退 → XHR 准备 → abort 支持 →
 * status 分支（200 解码 / 404 / 403 / 其它）→ 错误归类 → send。
 * 差异只在 logTag、Accept 头、错误措辞，故收敛到本工厂，各源只提供 URL 构造函数。
 *
 * ⚠️ **abort 监听器必须在 load / error / timeout 后 removeEventListener**。
 * 原实现里只有 GitHub 版这么做，Gitee / GitLab 两份只 add 不 remove ——
 * 同一同步源反复同步（或切换配置重试）会持续往 signal 上挂监听器，属于泄漏。
 *
 * @param options 配置
 * @returns `(relativePath, signal) => Promise<string>`
 */
export function createRawTextFetcher(
  options: RawTextFetcherOptions,
): (relativePath: string, signal?: AbortSignal) => Promise<string> {
  const {
    logTag,
    buildUrl,
    messages,
    acceptHeader = 'application/json',
    rawBytes = true,
    timeoutMs = REMOTE_REQUEST_TIMEOUT_MS,
  } = options

  return (relativePath: string, signal?: AbortSignal): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      let url: string
      try {
        url = buildUrl(relativePath)
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      // 如果 signal 已 aborted，立即 reject
      if (signal?.aborted) {
        reject(new Error('请求被取消'))
        return
      }

      bgmLog(LOG_LEVELS.INFO, `[${logTag}] 开始下载: ${url}`)
      const xhr = new XMLHttpRequest()
      xhr.open('GET', url, true)
      xhr.timeout = timeoutMs
      xhr.setRequestHeader('Accept', acceptHeader)
      // 取原始字节：数据源是 gzip 压缩的 .jsonlines.gz，需要按魔数判断后再解压
      if (rawBytes) {
        xhr.responseType = 'arraybuffer'
      }

      // AbortSignal 支持：监听 abort 触发 xhr.abort()，并在请求结束后移除监听器
      let abortHandler: (() => void) | null = null
      const removeAbortHandler = (): void => {
        if (!(abortHandler && signal)) {
          return
        }

        signal.removeEventListener('abort', abortHandler)
        abortHandler = null
      }
      if (signal) {
        abortHandler = (): void => {
          xhr.abort()
        }
        signal.addEventListener('abort', abortHandler)
      }

      xhr.addEventListener('load', (): void => {
        removeAbortHandler()
        switch (xhr.status) {
          case 200: {
            // gzip 数据源需要异步解压（DecompressionStream），200 分支走异步流程
            void (async (): Promise<void> => {
              try {
                resolve(await readXhrJsonlText(xhr))
              } catch (error: unknown) {
                reject(
                  new Error(
                    `数据解码失败: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                )
              }
            })()

            break
          }
          case 404: {
            reject(new Error(messages.notFound(url)))

            break
          }
          case 403: {
            reject(new Error(messages.forbidden(url)))

            break
          }
          default: {
            reject(new Error(`HTTP 错误 ${String(xhr.status)}: ${xhr.statusText}`))
          }
        }
      })

      xhr.addEventListener('error', (): void => {
        removeAbortHandler()
        // 如果是 abort 导致的 onerror，归类为取消
        if (signal?.aborted) {
          reject(new Error('请求被取消'))
          return
        }
        reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`))
      })

      xhr.ontimeout = (): void => {
        removeAbortHandler()
        reject(new Error(`请求超时（${String(timeoutMs)}ms）：${url}`))
      }

      xhr.send()
    })
}
