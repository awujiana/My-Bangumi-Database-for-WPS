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
