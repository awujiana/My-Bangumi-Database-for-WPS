/**
 * @fileoverview 检查更新逻辑单测（版本比较 / Release 解析 / 下载进度）
 *
 * 只测纯逻辑与可注入 fetch 的网络层，不碰 DOM 与 WPS COM。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  compareVersions,
  downloadReleaseAsset,
  fetchLatestRelease,
  isNewerVersion,
  parseVersion,
} from '../ts/tools/update-check.js'

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

describe('fetchLatestRelease', () => {
  it('解析版本号、更新说明与 zip 资产', async () => {
    const payload = {
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
    const release = await fetchLatestRelease(fakeFetch(Response.json(payload)))
    expect(release.version).toBe('v2.2.0')
    expect(release.notes).toBe('修复若干问题')
    expect(release.asset?.name).toBe('My-Bangumi-Database-for-WPS-v2.2.0.zip')
    expect(release.asset?.size).toBe(2048)
  })

  it('404 时给出「还没有发布」的明确错误', async () => {
    await expect(fetchLatestRelease(fakeFetch(new Response('', { status: 404 })))).rejects.toThrow(
      '还没有发布',
    )
  })

  it('非 2xx 时带上状态码', async () => {
    await expect(fetchLatestRelease(fakeFetch(new Response('', { status: 500 })))).rejects.toThrow(
      'HTTP 500',
    )
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
