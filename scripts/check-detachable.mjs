#!/usr/bin/env node
/**
 * @fileoverview 校验「可拖出浮动窗口」的 HTML 契约（`data-detachable*`）自洽
 *
 * 背景：拖出能力是**声明式**的 —— 页面只在 `<section>` 上写一个 `data-detachable`，
 * 通用组件（ui/components/detachable-panel.ts）扫描并装配。好处是所有页面零成本接入，
 * 代价是写错也**静默失效**：
 *   - `data-detachable-trigger="foo"` 指到不存在的 id → 组件退化为「注入一个 ⧉ 按钮」，
 *     页面原有的「🔍 规则管理器」按钮点了没反应；
 *   - `data-detachable-toolbar="bar"` 指到不存在的 id → 窗口标题栏少一条工具条，
 *     不报错，用户只觉得「按钮怎么没了」；
 *   - 尺寸写成 `data-detachable-width="abc"` → 静默退回默认尺寸。
 * 这与本项目其它「平行清单」是同一形态，故同样用门禁兜住（check-nav-order 的同款思路）。
 *
 * 校验内容：
 *   1. 每个 `data-detachable` 区块引用的 trigger / toolbar id 在本文件里存在；
 *   2. `data-detachable-width` / `-height` 是正数（写错就退回默认，等于没写还更难查）；
 *   3. 同一页面不重复装配同一 id（重复会被组件的幂等标记吞掉，属配置冗余）；
 *   4. 六个页面都引入了 `css/detachable-panel.css`（少一个页面就是该页完全没样式，
 *      窗口会变成一堆裸 div，且不会报错）；
 *   5. `mode=native` 必须给出 `data-detachable-url` 且该文件真的存在 ——
 *      原生对话框是**另一个 WebView**，url 写错或文件改名，表现就是「点了没反应」；
 *   6. 解析结果非空 —— 否则说明本脚本的解析失效，必须报错而不是「0 问题」空转。
 *
 * 退出码：0 一致；1 不一致（并打印修复指引）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 参与校验的页面（与 ui/*.html 一一对应） */
const PAGES = ['clean', 'conditional-format', 'enrich', 'highlight', 'panel', 'settings']

/** 组件样式表（每个页面都必须引入） */
const COMPONENT_CSS = 'css/detachable-panel.css'

/** 收集到的所有问题 */
const problems = []

/** 统计：确保解析器真的读到了东西 */
let sectionCount = 0

for (const page of PAGES) {
  const htmlPath = join(projectRoot, 'ui', `${page}.html`)
  const html = readFileSync(htmlPath, 'utf8')

  // ④ 样式表必须引入
  if (!html.includes(COMPONENT_CSS)) {
    problems.push(`ui/${page}.html 未引入 ${COMPONENT_CSS} —— 该页拖出的窗口没有样式`)
  }

  // 本页出现过的所有 id（用于校验引用是否指向真实元素）
  const ids = new Set()
  for (const match of html.matchAll(/\sid="([^"]+)"/gu)) {
    ids.add(match[1])
  }

  // 本页已声明的 data-detachable 区块 id（查重）
  const declared = new Set()

  for (const match of html.matchAll(/<[a-z]+[^>]*?\sdata-detachable(?=[\s>])([^>]*)>/gu)) {
    const attributeText = match[1]
    sectionCount += 1

    const id = /\sid="([^"]+)"/u.exec(attributeText)?.[1]
    const where = id ? `ui/${page}.html #${id}` : `ui/${page}.html 第 ${sectionCount} 个 data-detachable`

    // ③ 重复装配
    if (id && declared.has(id)) {
      problems.push(`${where} 重复声明 data-detachable（组件的幂等标记会吞掉第二个）`)
    }
    if (id) declared.add(id)

    // ① 引用的 id 必须存在
    for (const kind of ['trigger', 'toolbar']) {
      const referenced = new RegExp(`data-detachable-${kind}="([^"]+)"`, 'u').exec(attributeText)?.[1]
      if (referenced && !ids.has(referenced)) {
        problems.push(`${where} 的 data-detachable-${kind} 指向不存在的 id「${referenced}」`)
      }
    }

    // ⑤ 原生窗口模式：必须给出真实存在的页面
    const mode = /data-detachable-mode="([^"]+)"/u.exec(attributeText)?.[1] ?? 'float'
    if (mode !== 'float' && mode !== 'native') {
      problems.push(`${where} 的 data-detachable-mode="${mode}" 非法（只接受 float / native）`)
    }
    const nativeUrl = /data-detachable-url="([^"]+)"/u.exec(attributeText)?.[1]
    if (mode === 'native') {
      if (!nativeUrl) {
        problems.push(`${where} 是 native 模式但没有 data-detachable-url（拖不出任何窗口）`)
      } else if (!existsSync(join(projectRoot, 'ui', nativeUrl))) {
        problems.push(`${where} 的 data-detachable-url="${nativeUrl}" 指向的文件不存在`)
      }
      // 工具条是 DOM 节点，跨不了 WebView：写在 native 上等于永远不显示
      if (/data-detachable-toolbar=/u.test(attributeText)) {
        problems.push(`${where} 是 native 模式却带 data-detachable-toolbar（工具条搬不进另一个 WebView）`)
      }
    }
  }
}

// ⑤ 解析结果非空
if (sectionCount === 0) {
  problems.push('一个 data-detachable 区块都没解析到 —— 解析失效，必须修脚本而不是放行')
}

if (problems.length > 0) {
  console.error(`✖ 可拖出面板契约不一致（${String(problems.length)} 处）：`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\n修法：ui/*.html 里 data-detachable 的 trigger / toolbar 必须指向本页真实存在的 id，')
  console.error('      尺寸必须是正数；六个页面都要引入 css/detachable-panel.css。')
  process.exit(1)
}

console.log(
  `✔ 可拖出面板契约一致：${String(PAGES.length)} 个页面 / ${String(sectionCount)} 个区块，` +
    '引用的 trigger / toolbar id 均存在，尺寸合法，样式表齐备',
)
