// @vitest-environment jsdom
/**
 * @fileoverview 条件格式页模态框的**结构不变量**：标题栏必须是模态框的直接子元素
 *
 * 为什么单独立一条：收起态完全由一条 CSS 承担——
 *
 *   .conditional-format-modal.is-collapsed > :not(.conditional-format-modal-grip)
 *   { display: none }
 *
 * 它只认**直接子元素**。编辑器弹窗曾把 `<h4 class="…-grip">` 放在
 * `#conditionalFormatEditor` 容器里（其余 4 个弹窗都是直接子元素），于是点「收起」
 * 把容器连同标题栏一起藏掉：只剩一个空白圆角框，既拖不动、也点不到 ▾ 展不开
 * （2026-10-27 用户截图）。jsdom 不做布局计算，单测看不见这类缺陷，所以这里直接
 * 校验 DOM 形状——**它是那条 CSS 生效的前提**。
 *
 * 反向验证：下面「变异用例」把标题栏故意嵌进一层容器，断言检查器会报出来。
 * 只判「生产 HTML 通过」会被「检查器根本没在检查」骗过。
 */

import { describe, expect, it } from 'vitest'

import pageHtml from '../ui/conditional-format.html?raw'

/**
 * 找出「标题栏不是直接子元素」的模态框
 *
 * @param html 待检查的 HTML 文本
 * @returns 每个违规模态框的描述（空数组 = 全部合规）
 */
function findModalsWithoutDirectGrip(html: string): string[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const issues: string[] = []
  for (const modal of parsed.querySelectorAll<HTMLElement>('.conditional-format-modal')) {
    const hasDirectGrip = [...modal.children].some((child) =>
      child.classList.contains('conditional-format-modal-grip'),
    )
    if (!hasDirectGrip) {
      const nestedGrip = modal.querySelector('.conditional-format-modal-grip')
      if (nestedGrip === null) {
        issues.push('弹窗没有标题栏（.conditional-format-modal-grip），收起后无法展开')
      } else {
        // 标题栏里还夹着 ⛶ / ▾ 按钮，textContent 会带换行与缩进 → 压成单行再截断
        const label = nestedGrip.textContent.replaceAll(/\s+/gu, ' ').trim().slice(0, 20)
        const parentTag = nestedGrip.parentElement?.tagName.toLowerCase() ?? '?'
        issues.push(`弹窗「${label}」的标题栏被包在 <${parentTag}> 里，收起后会连标题栏一起隐藏`)
      }
    }
  }
  return issues
}

describe('模态框收起态的结构前提', () => {
  it('生产 HTML：每个模态框的标题栏都是直接子元素', () => {
    expect(findModalsWithoutDirectGrip(pageHtml)).toEqual([])
  })

  it('生产 HTML：七个弹窗都在（编辑器 / 导入 / 从文本导入 / 批量修改 / 归组 / 粘贴 / 应用确认）', () => {
    const parsed = new DOMParser().parseFromString(pageHtml, 'text/html')
    const ids = [...parsed.querySelectorAll<HTMLElement>('.conditional-format-modal-grip')].map(
      (grip) => grip.id,
    )
    expect(ids).toEqual([
      'conditionalFormatEditorTitle',
      'conditionalFormatImportTitle',
      'conditionalFormatTextImportTitle',
      'conditionalFormatBatchTitle',
      'conditionalFormatGroupTitle',
      'conditionalFormatPasteTitle',
      'conditionalFormatConfirmTitle',
    ])
  })

  // 变异用例：把标题栏嵌进一层容器（= 2026-10-27 那个 bug 的形状）
  it('变异：标题栏被容器包住时检查器必须报出来', () => {
    const broken = `<div class="conditional-format-modal">
        <div class="conditional-format-editor">
          <h4 id="conditionalFormatEditorTitle" class="conditional-format-modal-grip">编辑规则</h4>
        </div>
      </div>`
    const issues = findModalsWithoutDirectGrip(broken)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('收起后会连标题栏一起隐藏')
    expect(issues[0]).toContain('编辑规则')
  })

  // 变异用例：整个标题栏被删掉（收起后没有任何可点的东西）
  it('变异：缺标题栏时检查器必须报出来', () => {
    const broken = `<div class="conditional-format-modal"><p>只有正文</p></div>`
    const issues = findModalsWithoutDirectGrip(broken)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('没有标题栏')
  })
})
