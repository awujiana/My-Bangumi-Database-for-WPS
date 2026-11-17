/**
 * @fileoverview `ts/tools/template-release.ts` 单测（纯函数 + 注入 fetch）
 *
 * 覆盖三件真机/真数据才会暴露的事：
 *  1. Release 里挂着**三类 xlsx**（主数据 / 差异对比 / 模板），只按 `.xlsx` 挑会
 *     挑到 75 列的主数据文件 —— 那不是给用户填的表（真实 assets 顺序：主数据在前）。
 *  2. 接口失败（限流 / 断网）必须回落 `releases/latest`，且**不抛异常** ——
 *     查版本号是辅助信息，不能挡住「给个下载位置」。
 *  3. 展示文案在「解析成功」与「兜底」两种形态下都要给用户下一步动作。
 */

import { describe, it, expect } from 'vitest'

import {
  TEMPLATE_FALLBACK,
  TEMPLATE_OWNER,
  TEMPLATE_REPO,
  fetchLatestTemplate,
  formatTemplateMeta,
  resolveTemplateRelease,
  templateReleasePageUrl,
} from '../ts/tools/template-release.js'

/** 造一个 Release 响应（资产顺序照真实 Release：主数据 → 模板 → 差异） */
function releaseJson(
  tag: string,
  assets: { name: string; size: number }[],
): {
  tag_name: string
  assets: { name: string; size: number; browser_download_url: string }[]
} {
  return {
    tag_name: tag,
    assets: assets.map((asset) => ({
      ...asset,
      browser_download_url: `https://github.com/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/releases/download/${tag}/${asset.name}`,
    })),
  }
}

describe('模板资产挑选', () => {
  it('三类 xlsx 混排时挑 -template.xlsx，而不是主数据文件', () => {
    const info = resolveTemplateRelease(
      releaseJson('2026.10.27', [
        { name: 'ani-bangumi-type2-2026-10-27.xlsx', size: 1000 },
        { name: 'ani-bangumi-type2-2026-10-27-template.xlsx', size: 8_122_242 },
        { name: 'type2_subject_261027_vs_261020.xlsx', size: 787_139 },
      ]),
    )

    expect(info.resolved).toBe(true)
    expect(info.assetName).toBe('ani-bangumi-type2-2026-10-27-template.xlsx')
    expect(info.size).toBe(8_122_242)
    expect(info.downloadUrl).toContain('/releases/download/2026.10.27/')
  })

  it('没有 -template.xlsx 时退而取第一个 .xlsx（不是 undefined）', () => {
    const info = resolveTemplateRelease(
      releaseJson('2026.10.20', [{ name: 'ani-bangumi-type2-2026-10-20.xlsx', size: 42 }]),
    )

    expect(info.resolved).toBe(true)
    expect(info.assetName).toBe('ani-bangumi-type2-2026-10-20.xlsx')
  })

  it('完全没有资产时仍给出 tag 页（resolved=false，但不返回 null）', () => {
    const info = resolveTemplateRelease({ tag_name: '2026.10.13', assets: [] })

    expect(info.resolved).toBe(false)
    expect(info.tag).toBe('2026.10.13')
    expect(info.pageUrl).toBe(templateReleasePageUrl('2026.10.13'))
    expect(info.pageUrl).toContain('/releases/tag/2026.10.13')
  })
})

describe('Release 页面地址', () => {
  it('有 tag 用 tag 页，空 tag 用 latest（GitHub 自动 302 到最新）', () => {
    expect(templateReleasePageUrl('2026.10.27')).toBe(
      `https://github.com/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/releases/tag/2026.10.27`,
    )
    expect(templateReleasePageUrl('')).toBe(TEMPLATE_FALLBACK.pageUrl)
    expect(TEMPLATE_FALLBACK.pageUrl).toBe(
      `https://github.com/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/releases/latest`,
    )
  })
})

describe('fetchLatestTemplate', () => {
  it('接口失败（限流 / 断网）回落 latest 页且不抛异常', async () => {
    const failing = (async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch

    const info = await fetchLatestTemplate(failing)

    expect(info).toEqual(TEMPLATE_FALLBACK)
  })

  it('非 2xx（如 403 限流）同样回落', async () => {
    const forbidden = (async () =>
      new Response('{}', { status: 403, statusText: 'Forbidden' })) as unknown as typeof fetch

    const info = await fetchLatestTemplate(forbidden)

    expect(info.resolved).toBe(false)
    expect(info.downloadUrl).toBe(TEMPLATE_FALLBACK.downloadUrl)
  })

  it('正常响应解析出 tag 与模板资产', async () => {
    const ok = (async () =>
      Response.json(
        releaseJson('2026.10.27', [
          { name: 'ani-bangumi-type2-2026-10-27.xlsx', size: 1000 },
          { name: 'ani-bangumi-type2-2026-10-27-template.xlsx', size: 8_122_242 },
        ]),
      )) as unknown as typeof fetch

    const info = await fetchLatestTemplate(ok)

    expect(info.tag).toBe('2026.10.27')
    expect(info.assetName).toBe('ani-bangumi-type2-2026-10-27-template.xlsx')
    expect(info.pageUrl).toContain('/releases/tag/2026.10.27')
  })
})

describe('展示文案', () => {
  it('解析成功：版本 · 文件名 · 大小', () => {
    const text = formatTemplateMeta({
      tag: '2026.10.27',
      assetName: 'ani-bangumi-type2-2026-10-27-template.xlsx',
      size: 8_122_242,
      downloadUrl: 'x',
      pageUrl: 'y',
      resolved: true,
    })

    expect(text).toContain('2026.10.27')
    expect(text).toContain('ani-bangumi-type2-2026-10-27-template.xlsx')
    expect(text).toContain('7.75 MB')
  })

  it('兜底：给出「打开页面挑最新的」这一步动作，而不是空文案', () => {
    expect(formatTemplateMeta(TEMPLATE_FALLBACK)).toContain('Release')
  })
})
