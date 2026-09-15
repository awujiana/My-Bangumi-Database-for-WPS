// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/github-config-dialog.ts` 的单元测试。
 *
 * 纯 DOM 模块：`showConnectionTestDialog` 把连接测试结果拼成 HTML 写进
 * `#connectionTestBody`，`hideConnectionTestDialog` 把 `#connectionTestModal` 隐藏。
 * 两条函数都以「元素缺失就静默返回」为前置，所以这里把「有弹窗」与「无弹窗」两侧都覆盖。
 *
 * 安全断言（本文件重点）：测试地址来自用户填的 GitHub 配置，会被插入到
 * `title="…"` **属性值**上下文。因此除了 `<` `>` `&`，引号也必须被转义 ——
 * 否则 `"` 能提前闭合属性、把后续内容变成新属性（属性注入）。
 * 这里直接断言「注入 `"` 后 `title` 仍只有一个属性、值等于原文」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  hideConnectionTestDialog,
  showConnectionTestDialog,
} from '../ts/ui/github-config-dialog.js'

/** 最小宿主：只建函数真正读取的两个元素 */
function mountDialog(): { modal: HTMLElement; body: HTMLElement } {
  document.body.innerHTML = `
    <div id="connectionTestModal" class="modal" style="display: none">
      <div id="connectionTestBody"></div>
    </div>
  `
  const modal = document.getElementById('connectionTestModal')
  const body = document.getElementById('connectionTestBody')
  if (!modal || !body) throw new Error('测试 DOM 缺少连接测试弹窗')
  return { modal, body }
}

const baseResult = {
  success: true,
  statusCode: 200,
  responseTime: 123,
  url: 'https://api.github.com/user',
  sourceType: 'github',
} as const

beforeEach(() => {
  document.body.replaceChildren()
})

describe('showConnectionTestDialog · 成功路径', () => {
  it('渲染成功状态、数据源名称、响应时间与状态码，并显示弹窗', () => {
    const { modal, body } = mountDialog()

    showConnectionTestDialog({ ...baseResult })

    expect(body.textContent).toContain('✅ 连接成功')
    expect(body.textContent).toContain('GitHub')
    expect(body.textContent).toContain('123ms')
    expect(body.textContent).toContain('200')
    expect(body.innerHTML).toContain('color:#4CAF50')
    // 成功时没有错误行
    expect(body.querySelector('.error-row')).toBeNull()
    expect(modal.style.display).toBe('block')
  })

  it('数据源类型未知时回退为原始字符串', () => {
    const { body } = mountDialog()

    showConnectionTestDialog({ ...baseResult, sourceType: 'bitbucket' })

    expect(body.textContent).toContain('bitbucket')
  })

  it('响应时间为 0 → 显示「超时」，状态码为 null → 显示「无响应」', () => {
    const { body } = mountDialog()

    showConnectionTestDialog({ ...baseResult, responseTime: 0, statusCode: null })

    expect(body.textContent).toContain('超时')
    expect(body.textContent).toContain('无响应')
    expect(body.textContent).not.toContain('0ms')
  })
})

describe('showConnectionTestDialog · 失败路径', () => {
  it('渲染失败状态与错误行（红色）', () => {
    const { modal, body } = mountDialog()

    showConnectionTestDialog({
      success: false,
      statusCode: 401,
      responseTime: 88,
      url: 'https://api.github.com/user',
      sourceType: 'gist',
      errorMessage: 'Bad credentials',
    })

    expect(body.textContent).toContain('❌ 连接失败')
    expect(body.textContent).toContain('Gist')
    expect(body.textContent).toContain('401')
    expect(body.textContent).toContain('Bad credentials')
    expect(body.innerHTML).toContain('color:#f44336')
    expect(body.querySelector('.error-row')).not.toBeNull()
    expect(modal.style.display).toBe('block')
  })

  it('无 errorMessage 时不渲染错误行', () => {
    const { body } = mountDialog()

    showConnectionTestDialog({
      success: false,
      statusCode: 500,
      responseTime: 12,
      url: 'https://api.github.com/user',
      sourceType: 'github',
      errorMessage: undefined,
    })

    expect(body.querySelector('.error-row')).toBeNull()
  })
})

describe('showConnectionTestDialog · HTML 转义', () => {
  it('测试地址里的引号被转义（title 属性不会被提前闭合）', () => {
    const { body } = mountDialog()
    const url = 'https://example.com/x" onmouseover="alert(1)'

    showConnectionTestDialog({ ...baseResult, url })

    const value = body.querySelector<HTMLElement>('.detail-value')
    expect(value).not.toBeNull()
    // 只有 class 与 title 两个属性，没有多出 onmouseover（未转义时这里会多一个属性）
    expect(value?.getAttributeNames()).toEqual(['class', 'title'])
    // 属性值等于原文（浏览器已把实体还原）
    expect(value?.getAttribute('title')).toBe(url)
    // 序列化后 title 内部是 &quot;，没有能提前闭合属性的裸引号
    expect(body.innerHTML).toContain('title="https://example.com/x&quot; onmouseover=&quot;alert(1)"')
    // 文本节点里保留字面引号是安全的（文本上下文不解析属性），不会产生子元素
    expect(value?.childElementCount).toBe(0)
  })

  it('尖括号与 & 被转义，不会插入真实元素', () => {
    const { body } = mountDialog()

    showConnectionTestDialog({ ...baseResult, url: 'https://e.com/<img src=x>&a' })

    expect(body.querySelector('img')).toBeNull()
    expect(body.innerHTML).toContain('&lt;img')
    expect(body.innerHTML).toContain('&amp;')
  })

  it('错误信息同样被转义', () => {
    const { body } = mountDialog()

    showConnectionTestDialog({
      success: false,
      statusCode: null,
      responseTime: 0,
      url: 'https://e.com',
      sourceType: 'github',
      errorMessage: '<script>alert(1)</script>"x',
    })

    expect(body.querySelector('script')).toBeNull()
    expect(body.textContent).toContain('<script>alert(1)</script>"x')
  })
})

describe('元素缺失时静默返回', () => {
  it('没有弹窗元素时 showConnectionTestDialog 不抛错也不写 DOM', () => {
    document.body.replaceChildren()

    expect(() => {
      showConnectionTestDialog({ ...baseResult })
    }).not.toThrow()
  })

  it('只有 modal 没有 body 时同样静默返回（弹窗保持隐藏）', () => {
    document.body.innerHTML = '<div id="connectionTestModal" style="display: none"></div>'
    const modal = document.getElementById('connectionTestModal')

    showConnectionTestDialog({ ...baseResult })

    expect(modal?.style.display).toBe('none')
  })
})

describe('hideConnectionTestDialog', () => {
  it('隐藏已显示的弹窗', () => {
    const { modal } = mountDialog()
    modal.style.display = 'block'

    hideConnectionTestDialog()

    expect(modal.style.display).toBe('none')
  })

  it('弹窗不存在时不抛错', () => {
    document.body.replaceChildren()

    expect(() => {
      hideConnectionTestDialog()
    }).not.toThrow()
  })
})
