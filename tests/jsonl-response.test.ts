// @vitest-environment node
/**
 * 数据源响应解码（gzip）单测
 *
 * 被测模块 jsonl-response.ts 只依赖 core/constants.ts（纯常量）与 tools/utility.ts 的
 * bgmLog，后者带有 index → handlers → document 的副作用链，故在此 mock 掉，
 * 让本测试保持 node 环境、零 DOM 依赖。
 *
 * gzip 用例用平台自带 CompressionStream 现场压缩（而非 node:zlib），
 * 验证的是真实解压路径而非 mock，同时避免在测试里引入 Node 内建模块。
 *
 * 测试数据全部为 ASCII，因此 bytesOf 可逐码位映射；这也是为了不依赖 TextEncoder
 * 的返回类型（当前 TS 版本下会被 ESLint 判为 Uint8Array<any>）。
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../ts/tools/utility.js', () => ({
  bgmLog: vi.fn(),
}))

import {
  decodeJsonlBytes,
  gunzipBytes,
  hasGzipSupport,
  isGzipBytes,
  readXhrJsonlText,
} from '../ts/sync/jsonl-response.js'

const PLAIN = '["sid","name"]\n["8","Code Geass R2"]\n'

/** ASCII 文本 → UTF-8 字节 */
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (ch) => ch.codePointAt(0) ?? 0)
}

/** 用平台自带 CompressionStream 生成真实 gzip 字节流 */
async function gzipOf(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 构造一个只带 response / responseText 的 XHR 替身 */
function fakeXhr(response: unknown, responseText = ''): XMLHttpRequest {
  return { response, responseText } as unknown as XMLHttpRequest
}

describe('isGzipBytes', () => {
  it('识别 gzip 魔数 1f 8b', async () => {
    expect(isGzipBytes(await gzipOf(PLAIN))).toBe(true)
  })

  it('明文 JSONL 返回 false', () => {
    expect(isGzipBytes(bytesOf(PLAIN))).toBe(false)
  })

  it('空数组与单字节返回 false（不越界读第二个字节）', () => {
    expect(isGzipBytes(new Uint8Array([]))).toBe(false)
    expect(isGzipBytes(new Uint8Array([0x1f]))).toBe(false)
  })

  it('仅首字节匹配时返回 false', () => {
    expect(isGzipBytes(new Uint8Array([0x1f, 0x00]))).toBe(false)
  })
})

describe('hasGzipSupport', () => {
  it('当前运行环境提供 DecompressionStream', () => {
    expect(hasGzipSupport()).toBe(true)
  })
})

describe('gunzipBytes', () => {
  it('解压真实 gzip 字节流', async () => {
    const plain = await gunzipBytes(await gzipOf(PLAIN))
    expect(plain.length).toBe(bytesOf(PLAIN).length)
    expect(isGzipBytes(plain)).toBe(false)
  })

  it('数据不是合法 gzip 时 reject（而不是静默返回空）', async () => {
    await expect(gunzipBytes(bytesOf('not a gzip stream'))).rejects.toThrow()
  })
})

describe('decodeJsonlBytes', () => {
  it('检测到 gzip 魔数时自动解压为 JSONL 文本', async () => {
    expect(await decodeJsonlBytes(await gzipOf(PLAIN))).toBe(PLAIN)
  })

  it('明文按 UTF-8 直接解码（不依赖扩展名）', async () => {
    expect(await decodeJsonlBytes(bytesOf(PLAIN))).toBe(PLAIN)
  })

  it('大体积解压不会因管道背压死锁', async () => {
    const rows = Array.from(
      { length: 100_000 },
      (_, index) => `["${String(index)}","entry-${String(index)}"]`,
    )
    const big = `["sid","name"]\n${rows.join('\n')}\n`
    const gz = await gzipOf(big)
    // 解压后约 2 MiB，远超 DecompressionStream 内部缓冲，可暴露「先写完再读」的死锁
    expect(gz.length).toBeLessThan(big.length / 4)
    expect(await decodeJsonlBytes(gz)).toBe(big)
  })
})

describe('readXhrJsonlText', () => {
  it('response 为 ArrayBuffer（gzip）时解压为 JSONL 文本', async () => {
    const gzip = await gzipOf(PLAIN)
    expect(await readXhrJsonlText(fakeXhr(gzip.buffer))).toBe(PLAIN)
  })

  it('response 为 ArrayBuffer（明文，如 CDN 已透明解压）时直接解码', async () => {
    expect(await readXhrJsonlText(fakeXhr(bytesOf(PLAIN).buffer))).toBe(PLAIN)
  })

  it('response 不是 ArrayBuffer 时回退到 responseText', async () => {
    expect(await readXhrJsonlText(fakeXhr(PLAIN, PLAIN))).toBe(PLAIN)
  })
})
