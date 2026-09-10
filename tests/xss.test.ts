/**
 * @fileoverview XSS 防护测试
 *
 * 验证 escapeHtml 和 sanitizeHtml 能正确中和常见的 XSS payload：
 *   - `<img onerror=alert(1)>`
 *   - `<script>alert(1)</script>`
 *   - `<svg onload=alert(1)>`
 *   - `"><script>alert(1)</script>`
 *
 * 测试环境：jsdom（escapeHtml 依赖 document.createElement，sanitizeHtml 依赖 DOMPurify）
 *
 * 模块依赖说明：
 *   - escapeHtml 直接 import 自 string-utilities-pure.ts（零依赖纯模块），避免触发
 *     string-utilities → crypto → index → handlers 的副作用链。
 *   - sanitizeHtml 直接 import 自 sanitize.ts，该模块仅依赖 dompurify，无项目副作用。
 */

// @vitest-environment jsdom

import DOMPurify from 'dompurify'
import { describe, it, expect } from 'vitest'

import { sanitizeHtml, sanitizeTableRows } from '../ts/tools/sanitize.js'
import { escapeHtml } from '../ts/tools/string-utilities-pure.js'

// ========== 测试用 XSS payload ==========
const XSS_PAYLOADS = [
  '<img onerror=alert(1)>',
  '<script>alert(1)</script>',
  '<svg onload=alert(1)>',
  '"><script>alert(1)</script>',
] as const

// ========== escapeHtml 测试 ==========
describe('escapeHtml - XSS 防护', () => {
  it('应转义 < > " \' & 五个字符', () => {
    expect(escapeHtml('<>"\'&')).toBe('&lt;&gt;&quot;&#39;&amp;')
  })

  it('空值输入应返回空字符串', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml('')).toBe('')
  })

  it.each(XSS_PAYLOADS)('payload 转义后不应包含原始标签起始符 <: %s', (payload) => {
    const escaped = escapeHtml(payload)
    // 转义后 < > 应变为 &lt; &gt;，浏览器不会将其解析为标签
    expect(escaped).not.toMatch(/<(img|script|svg)\b/i)
    // 转义后不应包含 <script（应被转义为 &lt;script）
    expect(escaped).not.toMatch(/<script/i)
  })

  it('转义后的字符串写入 innerHTML 后不会生成可执行元素节点', () => {
    for (const payload of XSS_PAYLOADS) {
      const escaped = escapeHtml(payload)
      const div = document.createElement('div')
      // 通过 innerHTML 设置转义后的字符串，浏览器会将其视为文本而非标签
      div.innerHTML = escaped
      // 验证没有生成对应的元素节点
      expect(div.querySelector('img')).toBeNull()
      expect(div.querySelector('script')).toBeNull()
      expect(div.querySelector('svg')).toBeNull()
    }
  })

  it('转义后的字符串作为属性值不会逃逸引号', () => {
    // 模拟 <option value="${escapeHtml(s)}"> 场景
    const malicious = '"><script>alert(1)</script>'
    const escaped = escapeHtml(malicious)
    // 双引号应被转为 &quot;，无法逃逸属性引号
    expect(escaped).not.toMatch(/"/)
    expect(escaped).not.toMatch(/<script/i)
  })
})

// ========== sanitizeHtml 测试 ==========
describe('sanitizeHtml - XSS 防护', () => {
  it('<img onerror=alert(1)> 应被剥离（img 不在白名单）', () => {
    const cleaned = sanitizeHtml('<img onerror=alert(1)>')
    expect(cleaned).not.toMatch(/<img\b/i)
    // onerror 作为属性应不存在（img 标签整体被剥离）
    expect(cleaned).not.toMatch(/<[^>]*\bonerror\s*=/i)
  })

  it('<script>alert(1)</script> 应被完全移除', () => {
    const cleaned = sanitizeHtml('<script>alert(1)</script>')
    expect(cleaned).not.toMatch(/<script\b/i)
    expect(cleaned).not.toContain('alert(1)')
  })

  it('<svg onload=alert(1)> 应被剥离', () => {
    const cleaned = sanitizeHtml('<svg onload=alert(1)>')
    expect(cleaned).not.toMatch(/<svg\b/i)
    expect(cleaned).not.toMatch(/<[^>]*\bonload\s*=/i)
  })

  it('"><script>alert(1)</script> 注入应被中和', () => {
    const cleaned = sanitizeHtml('"><script>alert(1)</script>')
    expect(cleaned).not.toMatch(/<script\b/i)
    expect(cleaned).not.toContain('alert(1)')
  })

  it.each(XSS_PAYLOADS)('所有 payload 经 sanitizeHtml 后均无可执行标签: %s', (payload) => {
    const cleaned = sanitizeHtml(payload)
    // 不应保留任何危险标签
    expect(cleaned).not.toMatch(/<(img|script|svg|iframe|object|embed)\b/i)
    // 不应保留任何事件处理器属性（onError、onLoad 等）
    // 注意：作为文本内容的 "onerror" 是安全的，这里只检查属性形式
    expect(cleaned).not.toMatch(/<[^>]*\bon(error|load|click|mouseover|focus|blur|change)\s*=/i)
  })

  it('sanitizeHtml 不应破坏白名单内的合法 HTML 结构', () => {
    const html =
      '<div class="card"><p>名称：<b>测试</b></p><a href="https://example.com" target="_blank" rel="noopener">链接</a></div>'
    const cleaned = sanitizeHtml(html)
    expect(cleaned).toContain('<div')
    expect(cleaned).toContain('<p>')
    expect(cleaned).toContain('<b>测试</b>')
    expect(cleaned).toContain('<a')
    expect(cleaned).toContain('href="https://example.com"')
  })

  it('sanitizeHtml 应保留 <br> 换行标签', () => {
    const cleaned = sanitizeHtml('第一行<br>第二行')
    expect(cleaned).toContain('<br>')
  })

  it('sanitizeHtml 应剥离 javascript: 协议的 href', () => {
    const cleaned = sanitizeHtml('<a href="javascript:alert(1)">点击</a>')
    expect(cleaned).not.toMatch(/javascript:/i)
  })

  it('sanitizeHtml 空字符串输入应返回空字符串', () => {
    expect(sanitizeHtml('')).toBe('')
  })

  it('sanitizeHtml 处理后写入 DOM 不应生成可执行脚本节点', () => {
    const div = document.createElement('div')
    for (const payload of XSS_PAYLOADS) {
      div.innerHTML = sanitizeHtml(payload)
      expect(div.querySelector('img')).toBeNull()
      expect(div.querySelector('script')).toBeNull()
      expect(div.querySelector('svg')).toBeNull()
      expect(div.querySelector('iframe')).toBeNull()
    }
  })
})

// ========== 综合场景测试 ==========
describe('XSS 防护综合场景', () => {
  it('escapeHtml + sanitizeHtml 双重防护：卡片渲染场景', () => {
    // 模拟 preview.ts 的卡片渲染场景
    const userInput = '<img onerror=alert(1)>'
    const cardHtml = `<div class="detail-item"><span class="name">${escapeHtml(userInput)}</span></div>`
    const cleaned = sanitizeHtml(cardHtml)
    // 卡片结构应保留
    expect(cleaned).toContain('<div')
    expect(cleaned).toContain('<span')
    // 用户输入应被转义为文本（&lt;img ...），不应生成 <img> 标签
    expect(cleaned).toContain('&lt;img')
    expect(cleaned).not.toMatch(/<img\b/i)
    // 不应保留 onerror 事件处理器属性
    expect(cleaned).not.toMatch(/<[^>]*\bonerror\s*=/i)
  })

  it('sanitizeHtml 对含 table 的预览表格是安全的', () => {
    // 模拟 renderPreviewTable 场景
    const malicious = '<script>alert("xss")</script>'
    const tableHtml = `<table class="preview-table"><tbody><tr><td>${escapeHtml(malicious)}</td></tr></tbody></table>`
    const cleaned = sanitizeHtml(tableHtml)
    expect(cleaned).toContain('<table')
    expect(cleaned).toContain('<td>')
    expect(cleaned).not.toMatch(/<script/i)
  })

  it('sanitizeHtml 对话框模板场景（含 button）', () => {
    // 模拟 dialog.ts 的静态模板场景
    const template = `<div class="bgm-modal-content"><button id="okBtn" class="bgm-btn">确定</button></div>`
    const cleaned = sanitizeHtml(template)
    expect(cleaned).toContain('<div')
    expect(cleaned).toContain('<button')
    expect(cleaned).toContain('id="okBtn"')
    expect(cleaned).toContain('确定')
  })
})

// ========== sanitizeTableRows 测试 ==========
//
// 背景：DOMPurify 主路径用 DOMParser 以完整文档上下文解析，顶层裸 `<tr>`/`<td>`/`<th>`
// 会被 HTML 解析器按规范剥离（只保留文本），导致 `tbody.innerHTML = sanitizeHtml(rows)`
// 这类「表格行片段」场景结构全部丢失（表现为预览不是表格形式）。
// sanitizeTableRows 用完整 `<table><tbody>` 上下文包裹清洗后再取回 tbody 内部。

describe('sanitizeTableRows - 表格行片段', () => {
  it('保留顶层裸 <tr>/<td> 结构', () => {
    const cleaned = sanitizeTableRows('<tr><td>A</td><td>B</td></tr>')
    expect(cleaned).toContain('<tr')
    expect(cleaned).toContain('<td')
    expect(cleaned).toContain('A')
    expect(cleaned).toContain('B')
  })

  it('保留 <th> 表头行', () => {
    const cleaned = sanitizeTableRows('<tr><th></th><th>名称</th></tr>')
    expect(cleaned).toContain('<th')
    expect(cleaned).toContain('名称')
  })

  it('保留行内 class / data-* 等属性', () => {
    const cleaned = sanitizeTableRows(
      '<tr class="match-row" data-row="3"><td class="row-num">3</td></tr>',
    )
    expect(cleaned).toContain('match-row')
    expect(cleaned).toContain('data-row="3"')
    expect(cleaned).toContain('row-num')
  })

  it('写入 tbody 后能形成真实的表格行结构（回归：曾退化为纯文本）', () => {
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    tbody.innerHTML = sanitizeTableRows('<tr><td>甲</td></tr><tr><td>乙</td></tr>')
    expect(tbody.querySelectorAll('tr')).toHaveLength(2)
    expect(tbody.querySelectorAll('td')).toHaveLength(2)
    expect(tbody.textContent).toContain('甲')
  })

  it('剥离 <script> 等危险标签', () => {
    const cleaned = sanitizeTableRows('<tr><td><script>alert(1)</script>x</td></tr>')
    expect(cleaned).not.toMatch(/<script/i)
    expect(cleaned).not.toContain('alert(1)')
  })

  it.each(XSS_PAYLOADS)('所有 payload 经 sanitizeTableRows 后均无可执行标签: %s', (payload) => {
    const cleaned = sanitizeTableRows(`<tr><td>${payload}</td></tr>`)
    expect(cleaned).not.toMatch(/<(img|script|svg|iframe|object|embed)\b/i)
    expect(cleaned).not.toMatch(/<[^>]*\bon(error|load|click|mouseover|focus|blur|change)\s*=/i)
  })

  it('空字符串输入返回空字符串', () => {
    expect(sanitizeTableRows('')).toBe('')
  })
})

/**
 * 复现加载项运行时的清洗路径：所有任务窗格都会先加载 libs/purify.js
 * （DOMPurify 3.4.12 UMD，挂到 globalThis.DOMPurify），使 sanitizeHtml 走严格白名单。
 * node_modules 中的 dompurify 与之同版本，故直接引用即可。
 */
function installRealDomPurify(): void {
  const host = globalThis as { DOMPurify?: typeof DOMPurify }
  host.DOMPurify = DOMPurify
}

/**
 * 真实 DOMPurify 路径：运行时拼装 HTML 的 data-* 必须保留。
 *
 * 背景（2026-09 发现的系统性问题）：所有任务窗格页面（ui/panel.html、clean.html、
 * enrich.html、settings.html）都先加载 libs/purify.js，因此运行时 sanitizeHtml 走
 * DOMPurify 严格白名单路径；而 jsdom 单测默认没有 DOMPurify，走的是「保留 data-*」
 * 的轻量降级路径。两条路径的属性行为不一致，且白名单只登记了 5 个 data-* 属性 ——
 * 导致 clean-page 的分组按钮/勾选键、enrich-page 的批量删除与列映射、progress 组件
 * 的 data-el 在真实环境下被静默剥离，表现为「点了没反应 / 勾选丢失 / 组件抛错」
 * 而单测全绿。此处显式注入真实 DOMPurify，锁死该类回归。
 */
describe('真实 DOMPurify 路径：运行时拼装 HTML 的 data-* 必须保留', () => {
  it('注入后 sanitizeHtml 确实切入 DOMPurify 严格白名单路径', () => {
    installRealDomPurify()
    const host = globalThis as { DOMPurify?: { sanitize: unknown } }
    expect(typeof host.DOMPurify?.sanitize).toBe('function')
    // DOMPurify 路径会剥离白名单外的标签（img 不在 ALLOWED_TAGS）
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).not.toContain('<img')
  })

  it('clean-page 的工作簿分组/勾选属性可被 dataset 读取（回归：勾选丢失）', () => {
    installRealDomPurify()
    const html = `
      <div class="clean-sheet-group">
        <div class="clean-sheet-group-head">
          <button data-group-toggle="D:/a.xlsx" title="展开/折叠">▾</button>
          <button data-group-all="D:/a.xlsx">本簿全选</button>
          <button data-group-none="D:/a.xlsx">清空</button>
        </div>
        <label class="clean-sheet-item">
          <input type="checkbox" id="clean-sheet-x" data-workbook-key="D:/a.xlsx" data-sheet-name="动画" checked />
        </label>
      </div>`
    const container = document.createElement('div')
    container.innerHTML = sanitizeHtml(html)

    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(box?.dataset.workbookKey).toBe('D:/a.xlsx')
    expect(box?.dataset.sheetName).toBe('动画')
    expect(container.querySelector('[data-group-toggle]')).not.toBeNull()
    expect(container.querySelector('[data-group-all]')).not.toBeNull()
    expect(container.querySelector('[data-group-none]')).not.toBeNull()
  })

  it('enrich-page 的批量删除/列映射/匹配跳转属性保留', () => {
    installRealDomPurify()
    const container = document.createElement('div')
    container.innerHTML = sanitizeHtml(`
      <button data-batch-remove="3">✕</button>
      <select data-field="tags"><option>1</option></select>
      <button data-match-index="7">🔍</button>`)
    expect(container.querySelector<HTMLElement>('[data-batch-remove]')?.dataset.batchRemove).toBe(
      '3',
    )
    expect(container.querySelector<HTMLElement>('[data-field]')?.dataset.field).toBe('tags')
    expect(container.querySelector<HTMLElement>('[data-match-index]')?.dataset.matchIndex).toBe('7')
  })

  it('进度组件模板的 data-el 引用在严格白名单下保留（回归：组件抛错）', () => {
    installRealDomPurify()
    const container = document.createElement('div')
    container.innerHTML = sanitizeHtml('<div data-el="head"><span data-el="title"></span></div>')
    expect(container.querySelector('[data-el="head"]')).not.toBeNull()
    expect(container.querySelector('[data-el="title"]')).not.toBeNull()
  })

  it('放行 data-* 不放行事件处理器与危险 URI', () => {
    installRealDomPurify()
    const cleaned = sanitizeHtml(
      '<div data-el="x" onclick="alert(1)"><a href="javascript:alert(2)">点</a></div>',
    )
    expect(cleaned).toContain('data-el="x"')
    expect(cleaned).not.toMatch(/\son\w+\s*=/i)
    expect(cleaned).not.toMatch(/javascript:/i)
  })

  it('data-* 值本身不能成为注入载体（经 escapeHtml 后写入）', () => {
    installRealDomPurify()
    const evil = escapeHtml('" onmouseover="alert(1)')
    const container = document.createElement('div')
    container.innerHTML = sanitizeHtml(`<button data-group-all="${evil}">x</button>`)
    const button = container.querySelector<HTMLElement>('button')
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(button?.hasAttribute('onmouseover')).toBe(false)
    expect(button?.dataset.groupAll).toBe('" onmouseover="alert(1)')
  })
})
