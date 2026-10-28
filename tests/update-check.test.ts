/**
 * @fileoverview 检查更新逻辑单测（版本比较 / Release 解析 / 下载进度 / SHA-256 校验）
 *
 * 只测纯逻辑与可注入 fetch 的网络层，不碰 DOM 与 WPS COM。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  compareVersions,
  downloadReleaseAsset,
  fetchLatestRelease,
  isNewerVersion,
  normalizeSha256,
  parseVersion,
  sha256Hex,
  verifyAssetIntegrity,
} from '../ts/tools/update-check.js'

/**
 * 注入真实的 WebCrypto
 *
 * 本文件跑在 `environment: 'node'` 下，Node 19+ 的 `globalThis.crypto` 就是
 * WebCrypto（与浏览器同一套 API），所以不需要 `node:crypto`（测试 tsconfig 里没有
 * node 类型）。显式注入而不依赖默认值，是为了让「默认取全局」这条分支也能被覆盖到。
 */
const SUBTLE = crypto.subtle

/** SHA-256("abc") 的已知向量 */
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

/** "abc" 的字节（手写而不用 TextEncoder：后者的返回类型是 `Uint8Array<ArrayBufferLike>`） */
function abcBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x61, 0x62, 0x63])
}

describe('parseVersion', () => {
  it('去掉 v 前缀并按 . / - / + 切段', () => {
    expect(parseVersion('v2.1.0')).toEqual([2, 1, 0])
    expect(parseVersion('2.10.3')).toEqual([2, 10, 3])
  })

  it('非数字段按 0 处理', () => {
    expect(parseVersion('2.1.0-beta.1')).toEqual([2, 1, 0, 0, 1])
  })

  it('空串返回空数组', () => {
    expect(parseVersion(' '.repeat(3))).toEqual([])
  })
})

describe('compareVersions', () => {
  it('逐段比较大小', () => {
    expect(compareVersions('2.2.0', '2.1.9')).toBe(1)
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1)
  })

  it('缺失段按 0 补齐（2.1 == 2.1.0）', () => {
    expect(compareVersions('2.1', '2.1.0')).toBe(0)
  })

  it('多位数字按数值而非字典序比较', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1)
  })
})

describe('isNewerVersion', () => {
  it('远程更新返回 true', () => {
    expect(isNewerVersion('v2.2.0', '2.1.0')).toBe(true)
  })

  it('相同或更旧返回 false', () => {
    expect(isNewerVersion('2.1.0', '2.1.0')).toBe(false)
    expect(isNewerVersion('2.0.9', '2.1.0')).toBe(false)
  })
})

/** 造一个只返回固定响应的假 fetch */
function fakeFetch(response: Response): typeof fetch {
  return vi.fn(async () => response)
}

/**
 * 造一个按 URL 分流的假 fetch：`api.github.com` 走 `api`，其余（raw version.json）走 `manifest`
 *
 * 每次调用都新建 Response —— 复用同一个对象会在第二次 `.json()` 时报「body already used」。
 */
function routingFetch(options: { api: () => Response; manifest?: () => Response }): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('api.github.com')) return options.api()
    return options.manifest?.() ?? new Response('', { status: 404 })
  })
}

/** Release 接口的最小载荷 */
function releasePayload(): Record<string, unknown> {
  return {
    tag_name: 'v2.2.0',
    body: '修复若干问题',
    html_url: 'https://github.com/awujiana/My-Bangumi-Database-for-WPS/releases/tag/v2.2.0',
    published_at: '2026-10-26T00:00:00Z',
    assets: [
      { name: 'notes.txt', size: 10, browser_download_url: 'https://example.com/notes.txt' },
      {
        name: 'My-Bangumi-Database-for-WPS-v2.2.0.zip',
        size: 2048,
        browser_download_url: 'https://example.com/pkg.zip',
      },
    ],
  }
}

describe('fetchLatestRelease', () => {
  it('解析版本号、更新说明、zip 资产与清单里的 sha256', async () => {
    const release = await fetchLatestRelease(
      routingFetch({
        api: () => Response.json(releasePayload()),
        manifest: () => Response.json({ version: '2.2.0', sha256: ABC_SHA256, size: 2048 }),
      }),
    )
    expect(release.version).toBe('v2.2.0')
    expect(release.notes).toBe('修复若干问题')
    expect(release.asset?.name).toBe('My-Bangumi-Database-for-WPS-v2.2.0.zip')
    expect(release.asset?.size).toBe(2048)
    expect(release.asset?.sha256).toBe(ABC_SHA256)
  })

  it('清单缺失时 sha256 为空串（跳过校验，但不阻断更新）', async () => {
    const release = await fetchLatestRelease(
      routingFetch({ api: () => Response.json(releasePayload()) }),
    )
    expect(release.asset?.sha256).toBe('')
  })

  it('清单版本与 Release 不一致（发布到一半）时不采信它的哈希', async () => {
    const release = await fetchLatestRelease(
      routingFetch({
        api: () => Response.json(releasePayload()),
        manifest: () => Response.json({ version: '2.1.0', sha256: ABC_SHA256 }),
      }),
    )
    expect(release.asset?.sha256).toBe('')
  })

  it('404 时给出「还没有发布」的明确错误', async () => {
    await expect(fetchLatestRelease(fakeFetch(new Response('', { status: 404 })))).rejects.toThrow(
      '还没有发布',
    )
  })

  it('非 2xx 且兜底也失败时保留原始状态码', async () => {
    await expect(fetchLatestRelease(fakeFetch(new Response('', { status: 500 })))).rejects.toThrow(
      'HTTP 500',
    )
  })

  it('API 限流（403）时回退到仓库内 version.json 的版本', async () => {
    const release = await fetchLatestRelease(
      routingFetch({
        api: () => new Response('', { status: 403 }),
        manifest: () => Response.json({ version: '2.2.0', sha256: ABC_SHA256 }),
      }),
    )
    expect(release.version).toBe('v2.2.0')
    expect(release.asset?.name).toBe('My-Bangumi-Database-for-WPS-v2.2.0.zip')
    expect(release.asset?.downloadUrl).toContain('/download/My-Bangumi-Database-for-WPS-v2.2.0.zip')
    expect(release.asset?.sha256).toBe(ABC_SHA256)
  })
})

describe('normalizeSha256', () => {
  it('接受 64 位十六进制并统一转小写', () => {
    expect(normalizeSha256(ABC_SHA256.toUpperCase())).toBe(ABC_SHA256)
    expect(normalizeSha256(`  ${ABC_SHA256}  `)).toBe(ABC_SHA256)
  })

  it('去掉 `sha256:` 前缀（GitHub digest 口径）', () => {
    expect(normalizeSha256(`sha256:${ABC_SHA256}`)).toBe(ABC_SHA256)
  })

  it('长度不对 / 非法字符一律返回空串（当作「没提供」）', () => {
    expect(normalizeSha256('')).toBe('')
    expect(normalizeSha256('abc')).toBe('')
    expect(normalizeSha256('z'.repeat(64))).toBe('')
    expect(normalizeSha256(ABC_SHA256.slice(0, 63))).toBe('')
  })
})

describe('sha256Hex', () => {
  it('与已知向量一致（"abc"）', async () => {
    expect(await sha256Hex(abcBytes(), SUBTLE)).toBe(ABC_SHA256)
  })

  it('环境没有 WebCrypto 时返回 null（调用方降级为跳过校验）', async () => {
    expect(await sha256Hex(new Uint8Array([1, 2, 3]), null)).toBeNull()
  })
})

describe('verifyAssetIntegrity', () => {
  it('一致 → verified', async () => {
    const result = await verifyAssetIntegrity(abcBytes(), ABC_SHA256, SUBTLE)
    expect(result.status).toBe('verified')
    expect(result.actual).toBe(ABC_SHA256)
    expect(result.expected).toBe(ABC_SHA256)
  })

  it('不一致 → mismatch，并回传双方哈希（便于贴进 Issue）', async () => {
    const wrong = 'f'.repeat(64)
    const result = await verifyAssetIntegrity(abcBytes(), wrong, SUBTLE)
    expect(result.status).toBe('mismatch')
    expect(result.actual).toBe(ABC_SHA256)
    expect(result.expected).toBe(wrong)
  })

  it('发布端没给哈希 → skipped（不阻断更新）', async () => {
    const result = await verifyAssetIntegrity(abcBytes(), '', SUBTLE)
    expect(result.status).toBe('skipped')
    expect(result.expected).toBe('')
  })

  it('没有 WebCrypto → skipped，但保留发布端声明的哈希', async () => {
    const result = await verifyAssetIntegrity(abcBytes(), ABC_SHA256, null)
    expect(result.status).toBe('skipped')
    expect(result.expected).toBe(ABC_SHA256)
    expect(result.actual).toBe('')
  })
})

describe('downloadReleaseAsset', () => {
  it('返回完整字节并回报进度', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const progress: number[] = []
    const result = await downloadReleaseAsset(
      'https://example.com/pkg.zip',
      (event) => {
        progress.push(event.loaded)
      },
      fakeFetch(new Response(bytes)),
    )
    expect([...result]).toEqual([1, 2, 3, 4, 5])
    expect(progress.at(-1)).toBe(5)
  })

  it('下载失败抛出带状态码的错误', async () => {
    await expect(
      downloadReleaseAsset(
        'https://example.com/pkg.zip',
        () => {},
        fakeFetch(new Response('', { status: 403 })),
      ),
    ).rejects.toThrow('HTTP 403')
  })
})
