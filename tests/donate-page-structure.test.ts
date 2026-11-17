// @vitest-environment jsdom
/// <reference types="vite/client" />
/**
 * @fileoverview 赞赏页的**可读性不变量**：显示的值 = 复制的值，且不带吃宽度的尾巴
 *
 * 背景（momo 2026-10-29：「赞赏与支持页面，显示不全，邮箱显示不全」）：
 * 联系方式那一行原本是 `white-space: nowrap` + `text-overflow: ellipsis`，
 * 值后面还跟着「· 点击复制」的尾巴；两列 `1fr` 网格被邮箱的 min-content 顶宽，
 * 整块比卡片还宽 → 右侧被裁，邮箱只剩 `bingshanlengti…`。
 *
 * 这里只钉**标记层面的不变量**（jsdom 不做布局，宽度问题看不见 —— 样式侧由
 * headless Chrome 探针实测 `card.scrollWidth === card.clientWidth` 把关，不进 gate）：
 *   - 每个 `[data-copy]` 的完整值都出现在它自己的可见文本里（显示 ≠ 复制 = 骗人）；
 *   - 可见文本里不许再出现「点击复制」（那句统一放到 `.donate-hint` 说一次）。
 *
 * 反向验证：下面「变异用例」把群号截断、把尾巴加回去，断言检查器都会报出来 ——
 * 只判「生产页面通过」会被「检查器根本没在检查」骗过。实测把尾巴加回 `ui/donate.html`
 * 会有 3 条用例变红，还原后全绿。
 */

import { describe, expect, it } from 'vitest'

import donateHtml from '../ui/donate.html?raw'

/** 一条联系方式按钮的可见文本与复制内容 */
interface ContactEntry {
  /** 按钮上的标题（GitHub / 邮箱 / 粉丝 QQ 群） */
  label: string
  /** 点击后写进剪贴板的文本 */
  copy: string
  /** 页面上显示的值 */
  value: string
}

/** 「点击复制」这类说明只该在 `.donate-hint` 里出现一次，逐行重复会吃掉宽度 */
const REPEATED_HINT = '点击复制'

/**
 * 读某个后代元素的可见文本（取不到算空串，空白裁掉）
 *
 * @param root 查询起点
 * @param selector 后代选择器（调用方一律带 `:scope` 前缀）
 * @returns 可见文本
 */
function readText(root: Element, selector: string): string {
  const node = root.querySelector(selector)
  if (node === null) return ''
  return node.textContent.trim()
}

/**
 * 抽出赞赏页里所有联系方式按钮
 *
 * @param html 待检查的 HTML 文本
 * @returns 每条按钮的标题 / 复制值 / 显示值
 */
function contactEntries(html: string): ContactEntry[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return [...parsed.querySelectorAll<HTMLElement>('.donate-link')].map((button) => ({
    label: readText(button, ':scope .donate-link-text strong'),
    copy: button.dataset.copy ?? '',
    value: readText(button, ':scope .donate-link-text span'),
  }))
}

/**
 * 找出「显示与复制不一致」或「值带重复说明」的联系方式
 *
 * @param html 待检查的 HTML 文本
 * @returns 每个问题的描述（空数组 = 全部合规）
 */
function findContactIssues(html: string): string[] {
  const entries = contactEntries(html)
  if (entries.length === 0) return ['赞赏页里没有任何 `.donate-link`：联系方式整块丢了']

  const issues: string[] = []
  for (const entry of entries) {
    if (entry.copy === '') {
      issues.push(`「${entry.label}」没有 data-copy：点了复制不出东西`)
    } else {
      // 协议前缀是唯一允许的差异：GitHub 显示 github.com/awujiana、复制 https://github.com/awujiana
      const readable = entry.copy.replace(/^https?:\/\//u, '')
      if (!entry.value.includes(readable)) {
        issues.push(
          `「${entry.label}」显示「${entry.value}」，但复制的是「${entry.copy}」—— 显示必须是复制值的子串`,
        )
      }
      if (entry.value.includes(REPEATED_HINT)) {
        issues.push(`「${entry.label}」的值里还带着「${REPEATED_HINT}」：说明统一放 .donate-hint`)
      }
    }
  }
  return issues
}

describe('赞赏页联系方式：显示值与复制值一致', () => {
  it('生产页面全部合规', () => {
    expect(findContactIssues(donateHtml)).toEqual([])
  })

  it('三个渠道都在：GitHub / 邮箱 / 粉丝 QQ 群', () => {
    const labels = contactEntries(donateHtml).map((entry) => entry.label)
    expect(labels).toEqual(['GitHub', '邮箱', '粉丝 QQ 群'])
  })

  it('粉丝 QQ 群号是 436212515，且页面上完整可见', () => {
    const entry = contactEntries(donateHtml).find((item) => item.label === '粉丝 QQ 群')
    expect(entry).toBeDefined()
    expect(entry?.copy).toBe('436212515')
    expect(entry?.value).toBe('436212515')
  })

  it('邮箱完整显示，不带「点击复制」尾巴', () => {
    const entry = contactEntries(donateHtml).find((item) => item.label === '邮箱')
    expect(entry?.value).toBe('bingshanlengtie@qq.com')
  })

  it('「点击复制」的说明还在，只是收进 .donate-hint 说一次', () => {
    const parsed = new DOMParser().parseFromString(donateHtml, 'text/html')
    const hint = parsed.querySelector('.donate-hint')?.textContent ?? ''
    expect(hint).toContain('复制')
  })
})

describe('变异用例：检查器真的在检查', () => {
  it('可见文本里的群号被截断 → 报「显示必须是复制值的子串」', () => {
    const mutated = donateHtml.replace('<span>436212515</span>', '<span>436212…</span>')
    expect(mutated).not.toBe(donateHtml)
    expect(findContactIssues(mutated).join('\n')).toContain('显示必须是复制值的子串')
  })

  it('值里加回「· 点击复制」→ 报重复说明', () => {
    const mutated = donateHtml.replace(
      '<span>bingshanlengtie@qq.com</span>',
      '<span>bingshanlengtie@qq.com · 点击复制</span>',
    )
    expect(mutated).not.toBe(donateHtml)
    expect(findContactIssues(mutated).join('\n')).toContain('说明统一放 .donate-hint')
  })

  it('整块联系方式被删 → 报「整块丢了」', () => {
    const mutated = donateHtml.replaceAll('class="donate-link"', 'class="donate-link-x"')
    expect(mutated).not.toBe(donateHtml)
    expect(findContactIssues(mutated).join('\n')).toContain('整块丢了')
  })
})
