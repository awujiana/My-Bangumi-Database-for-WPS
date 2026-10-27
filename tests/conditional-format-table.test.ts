// @vitest-environment node
/**
 * @fileoverview `ts/panel/conditional-format-table.ts` 既有规则表格引擎单测（纯函数，Node 直跑）
 *
 * 守住的东西：
 * 1. 快照 → 行模型：序号与 FormatConditions.Item 的 1 基下标一致（对错一行 = 操作错规则）
 * 2. 行 HTML 的**转义**：公式与范围来自 Excel 内容，是 XSS 入口，必须转义
 * 3. 「不可重建」标记：数据条 / 色阶等不能导进规则库，UI 必须显式标出
 * 4. StopIfTrue 三态：true / false / undefined（宿主未暴露 → 复选框禁用而非 unchecked）
 * 5. 分页：页码越界收敛到合法区间（删完一页后不能停在空页）
 * 6. 搜索命中类型 / 范围 / 公式 / 颜色（用户常按「那条黄色的」找规则）
 */

import { describe, expect, it } from 'vitest'

import {
  FOREIGN_RULE_PAGE_SIZE,
  buildForeignRuleGroupsHtml,
  buildForeignRuleHeadHtml,
  buildForeignRuleRowHtml,
  columnNumberOf,
  fcTypeLabel,
  filterForeignRuleRows,
  filterRowsByScope,
  formatSwatchHtml,
  hasRangeOverlap,
  paginate,
  parseRangeRect,
  selectionSummary,
  toForeignRuleRows,
  toggleSelection,
} from '../ts/panel/conditional-format-table.js'
import type { ForeignRuleRow } from '../ts/panel/conditional-format-table.js'
import type { ForeignRuleSnapshot } from '../ts/panel/conditional-format-rules.js'
import { snapshotGroupKey } from '../ts/panel/conditional-format-rules.js'

/** 造一条快照的便捷工厂（只覆盖被测字段，其余用默认值） */
function snapshot(overrides: Partial<ForeignRuleSnapshot> = {}): ForeignRuleSnapshot {
  return {
    range: '$B$3:$B$26958',
    formula: '=$R3="26年10月"',
    kind: 'expression',
    ...overrides,
  }
}

describe('fcTypeLabel', () => {
  it('已知类型号给中文标签', () => {
    expect(fcTypeLabel(2, 'expression')).toBe('公式')
    expect(fcTypeLabel(8, 'other')).toBe('数据条')
    expect(fcTypeLabel(9, 'other')).toBe('色阶')
  })

  it('读不到类型号时按 kind 兜底（不显示裸数字）', () => {
    expect(fcTypeLabel(undefined, 'expression')).toBe('公式')
    expect(fcTypeLabel(undefined, 'other')).toBe('其它类型')
  })

  it('未知类型号显示原始编号，方便回报宿主问题', () => {
    expect(fcTypeLabel(99, 'other')).toBe('类型 99')
  })
})

describe('toForeignRuleRows', () => {
  it('序号从 1 起且与数组下标对齐（= FormatConditions.Item 下标）', () => {
    const rows = toForeignRuleRows([snapshot(), snapshot(), snapshot()])
    expect(rows.map((row) => row.index)).toEqual([1, 2, 3])
  })

  it('公式类标记为可重建，其它类型不可重建', () => {
    const rows = toForeignRuleRows([snapshot(), snapshot({ kind: 'other', type: 8 })])
    expect(rows[0]?.rebuildable).toBe(true)
    expect(rows[1]?.rebuildable).toBe(false)
  })

  it('读不到范围时给占位文案而不是空单元格', () => {
    const rows = toForeignRuleRows([snapshot({ range: '' })])
    expect(rows[0]?.range).toBe('（未读到范围）')
  })

  it('颜色与 StopIfTrue 原样带出；没读到的字段不出现（而非置空串）', () => {
    const rows = toForeignRuleRows([
      snapshot({ interior: '#00B050', fontColor: '#FFFFFF', stopIfTrue: true }),
      snapshot(),
    ])
    expect(rows[0]?.fillColor).toBe('#00B050')
    expect(rows[0]?.fontColor).toBe('#FFFFFF')
    expect(rows[0]?.stopIfTrue).toBe(true)
    expect('fillColor' in (rows[1] ?? {})).toBe(false)
    expect('stopIfTrue' in (rows[1] ?? {})).toBe(false)
  })
})

describe('buildForeignRuleRowHtml', () => {
  const baseRow: ForeignRuleRow = {
    index: 3,
    groupKey: '=$R3="26年10月"\u{0}$B$3:$B$26958',
    typeLabel: '公式',
    rebuildable: true,
    selected: false,
    range: '$B$3:$B$26958',
    formula: '=$R3="26年10月"',
  }

  it('公式与范围里的 HTML 必须被转义（Excel 内容是 XSS 入口）', () => {
    const html = buildForeignRuleRowHtml({
      ...baseRow,
      range: '<img src=x onerror=alert(1)>',
      formula: '"><script>alert(1)</script>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('data-row-index 与 index 一致（事件委托靠它定位规则）', () => {
    const html = buildForeignRuleRowHtml(baseRow)
    expect(html).toContain('data-row-index="3"')
  })

  it('不可重建的类型整行加标记 class，且类型列带警示徽章', () => {
    const html = buildForeignRuleRowHtml({ ...baseRow, rebuildable: false, typeLabel: '数据条' })
    expect(html).toContain('conditional-format-row-foreign')
    expect(html).toContain('conditional-format-tag-warn')
    expect(html).toContain('不可重建')
  })

  it('StopIfTrue 三态：true 勾选 / false 不勾 / 未读到则禁用', () => {
    expect(buildForeignRuleRowHtml({ ...baseRow, stopIfTrue: true })).toMatch(
      /data-action="stop"[^>]*checked/,
    )
    const off = buildForeignRuleRowHtml({ ...baseRow, stopIfTrue: false })
    expect(off).not.toMatch(/data-action="stop"[^>]*checked/)
    expect(off).not.toMatch(/data-action="stop"[^>]*disabled/)
    const unknown = buildForeignRuleRowHtml({ ...baseRow })
    expect(unknown).toMatch(/data-action="stop"[^>]*disabled/)
  })

  it('超长公式截断显示，但 title 保留全量', () => {
    const long = `=${'A'.repeat(120)}`
    const html = buildForeignRuleRowHtml({ ...baseRow, formula: long })
    expect(html).toContain('…')
    expect(html).toContain(`title="${long}"`)
  })

  it('行内不再渲染操作按钮（统一走右键菜单，省出列宽）', () => {
    const html = buildForeignRuleRowHtml(baseRow)
    for (const action of ['import', 'up', 'down', 'delete']) {
      expect(html).not.toContain(`data-action="${action}"`)
    }
    expect(html).toContain('右键打开操作菜单')
  })
})

describe('formatSwatchHtml', () => {
  it('填充色与字体色都在（WPS 只显示填充）', () => {
    const html = formatSwatchHtml({
      index: 1,
      groupKey: '\u{0}A1',
      typeLabel: '公式',
      rebuildable: true,
      selected: false,
      range: 'A1',
      formula: '',
      fillColor: '#00B050',
      fontColor: '#FFFFFF',
    })
    expect(html).toContain('background:#00B050')
    expect(html).toContain('conditional-format-swatch-font')
    expect(html).toContain('background:#FFFFFF')
  })

  it('读不到颜色时用斜纹占位（不是空白，用户看得出「没读到」）', () => {
    const html = formatSwatchHtml({
      index: 1,
      groupKey: '\u{0}A1',
      typeLabel: '公式',
      rebuildable: true,
      selected: false,
      range: 'A1',
      formula: '',
    })
    expect(html).toContain('repeating-conic-gradient')
    expect(html).toContain('未读到格式')
  })
})

describe('buildForeignRuleHeadHtml', () => {
  it('七列表头与行列一一对应（不再有「操作」列）', () => {
    const head = buildForeignRuleHeadHtml()
    for (const label of ['#', '类型', '格式', '应用于', '公式', '为真则停']) {
      expect(head).toContain(`>${label}<`)
    }
    expect(head).not.toContain('>操作<')
  })
})

describe('filterForeignRuleRows', () => {
  const rows = toForeignRuleRows([
    snapshot({ range: '$B$3:$B$100', formula: '=$R3="26年10月"' }),
    snapshot({ kind: 'other', type: 8, formula: '', range: '$C$3:$C$100' }),
    snapshot({ interior: '#FFC7CE', range: '$D$3:$D$100', formula: '=$S3<>""' }),
  ])

  it('空查询返回全部（不改引用语义也要内容一致）', () => {
    expect(filterForeignRuleRows(rows, '  ')).toHaveLength(3)
  })

  it('按公式搜', () => {
    expect(filterForeignRuleRows(rows, '26年10月')).toHaveLength(1)
  })

  it('按范围搜', () => {
    expect(filterForeignRuleRows(rows, '$C$3')).toHaveLength(1)
  })

  it('按类型标签搜', () => {
    expect(filterForeignRuleRows(rows, '数据条')).toHaveLength(1)
  })

  it('按颜色搜（用户常记得「那条黄色的」而不记得公式）', () => {
    expect(filterForeignRuleRows(rows, '#ffc7ce')).toHaveLength(1)
  })

  it('大小写不敏感', () => {
    expect(filterForeignRuleRows(rows, 'FFC7CE')).toHaveLength(1)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 347 }, (_unused, position) => position)

  it('347 条按每页 50 分 7 页', () => {
    const page = paginate(items, 1, FOREIGN_RULE_PAGE_SIZE)
    expect(page.pageCount).toBe(7)
    expect(page.items).toHaveLength(50)
  })

  it('页码越界时收敛到合法区间（删完一页后不能停在空页）', () => {
    expect(paginate(items, 99, 50).page).toBe(7)
    expect(paginate(items, 0, 50).page).toBe(1)
    expect(paginate(items, -3, 50).page).toBe(1)
  })

  it('空列表仍是 1 页且条目为空', () => {
    const page = paginate([], 1)
    expect(page.pageCount).toBe(1)
    expect(page.items).toEqual([])
  })

  it('最后一页可能不满', () => {
    expect(paginate(items, 7, 50).items).toHaveLength(347 - 6 * 50)
  })
})

describe('columnNumberOf', () => {
  it('单字母 A→1 / Z→26', () => {
    expect(columnNumberOf('A')).toBe(1)
    expect(columnNumberOf('Z')).toBe(26)
  })

  it('双字母 AA→27 / AB→28（26 进制而非简单累加）', () => {
    expect(columnNumberOf('AA')).toBe(27)
    expect(columnNumberOf('AB')).toBe(28)
  })

  it('空串得 0（整行语义的「列不限」）', () => {
    expect(columnNumberOf('')).toBe(0)
  })
})

describe('parseRangeRect', () => {
  it('普通区域 A1:B9', () => {
    expect(parseRangeRect('A1:B9')).toEqual({
      startRow: 1,
      endRow: 9,
      startColumn: 1,
      endColumn: 2,
    })
  })

  it('剥掉绝对引用符 $（AppliesTo.Address 常带 $）', () => {
    expect(parseRangeRect('$B$3:$B$26958')).toEqual({
      startRow: 3,
      endRow: 26_958,
      startColumn: 2,
      endColumn: 2,
    })
  })

  it('整列 A:A → 行维度 0（不限）', () => {
    const rect = parseRangeRect('A:A')
    expect(rect?.startRow).toBe(0)
    expect(rect?.startColumn).toBe(1)
  })

  it('整行 1:10 → 列维度 0（不限）', () => {
    const rect = parseRangeRect('1:10')
    expect(rect?.startColumn).toBe(0)
    expect(rect?.startRow).toBe(1)
  })

  it('单个单元格视为 1×1 区域', () => {
    expect(parseRangeRect('C7')).toEqual({
      startRow: 7,
      endRow: 7,
      startColumn: 3,
      endColumn: 3,
    })
  })

  it('倒着写的区域 B9:A1 归一化（Excel 偶尔返回这种）', () => {
    expect(parseRangeRect('B9:A1')?.startRow).toBe(1)
    expect(parseRangeRect('B9:A1')?.endColumn).toBe(2)
  })

  it('解析不了的返回 null（调用方按不相交处理，不抛错）', () => {
    expect(parseRangeRect('')).toBeNull()
    expect(parseRangeRect('???')).toBeNull()
    expect(parseRangeRect('AAAA1')).toBeNull()
  })
})

describe('hasRangeOverlap', () => {
  it('相交', () => {
    expect(hasRangeOverlap('A1:C9', 'B5:D12')).toBe(true)
  })

  it('不相交', () => {
    expect(hasRangeOverlap('A1:A9', 'B1:B9')).toBe(false)
  })

  it('整列 B:B 的行维度不限（任何行号都算相交）', () => {
    expect(hasRangeOverlap('B:B', 'B5:C6')).toBe(true)
    expect(hasRangeOverlap('B:B', 'B99999')).toBe(true)
  })

  it('整列仍受列维度约束：B:B 与 C 列不相交', () => {
    expect(hasRangeOverlap('B:B', 'C1:C9')).toBe(false)
  })

  it('任一解析失败时按不相交处理（不能把整表藏掉）', () => {
    expect(hasRangeOverlap('A1:B2', 'not-a-range')).toBe(false)
  })
})

describe('toggleSelection', () => {
  it('选中与取消都不改原集合（不可变，避免渲染拿到脏引用）', () => {
    const before = new Set([1, 2])
    const after = toggleSelection(before, 3, true)
    expect(before.has(3)).toBe(false)
    expect(after.has(3)).toBe(true)
    expect(toggleSelection(after, 3, false).has(3)).toBe(false)
    expect(toggleSelection(after, 3, true).size).toBe(3)
  })
})

describe('selectionSummary', () => {
  it('空集合 → 全未选', () => {
    expect(selectionSummary([])).toEqual({ isAllSelected: false, isSomeSelected: false })
  })

  it('部分选中 → 全选 false、部分 true（表头要显示半选态）', () => {
    const rows = toForeignRuleRows([snapshot(), snapshot()], new Set([1]))
    expect(selectionSummary(rows)).toEqual({ isAllSelected: false, isSomeSelected: true })
  })

  it('全部选中 → 全选 true', () => {
    const rows = toForeignRuleRows([snapshot(), snapshot()], new Set([1, 2]))
    expect(selectionSummary(rows).isAllSelected).toBe(true)
  })
})

describe('filterRowsByScope', () => {
  const rows = toForeignRuleRows([
    snapshot({ range: '$B$3:$B$26958' }),
    snapshot({ range: '$D$1:$D$20' }),
  ])

  it('scope=all 时原样返回', () => {
    expect(filterRowsByScope(rows, 'all', 'B10')).toHaveLength(2)
  })

  it('scope=selection 时只留与选区相交的', () => {
    expect(filterRowsByScope(rows, 'selection', 'B10')).toHaveLength(1)
  })

  it('读不到选区时按整表返回（不能把表清空）', () => {
    expect(filterRowsByScope(rows, 'selection', '')).toHaveLength(2)
  })
})

// ========== 既有规则本地分组（buildForeignRuleGroupsHtml）==========

/** 两条同组 + 一条异组的快照（组名 = 自动聚类产出的公式模式） */
function groupFixtures(): { rows: ForeignRuleRow[]; groups: Record<string, string> } {
  const a = snapshot({ range: 'J2:J9', formula: '=$J2="饮品"' })
  const b = snapshot({ range: 'J2:J9', formula: '=$J2="大区"' })
  const c = snapshot({ range: 'K2:K9', formula: '=$K2<>""' })
  const rows = toForeignRuleRows([a, b, c])
  return {
    rows,
    groups: {
      [snapshotGroupKey(a)]: '=$J2="*"',
      [snapshotGroupKey(b)]: '=$J2="*"',
      [snapshotGroupKey(c)]: '=$K2="*"',
    },
  }
}

describe('buildForeignRuleGroupsHtml', () => {
  it('组序 = 组内首条规则出现序；组标题带收起钮 + 计数 + 组级操作', () => {
    const { rows, groups } = groupFixtures()
    const html = buildForeignRuleGroupsHtml(rows, groups, new Set())
    // 组名走 escapeHtml（" → &quot;），按转义后的形态定位
    const first = html.indexOf('data-group="=$J2=&quot;*&quot;"')
    const second = html.indexOf('data-group="=$K2=&quot;*&quot;"')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(-1)
    expect(first).toBeLessThan(second)
    expect(html).toContain('data-action="toggle-existing-group"')
    expect(html).toContain('data-action="rename-existing-group"')
    expect(html).toContain('data-action="dissolve-existing-group"')
    expect(html).toContain('<span class="conditional-format-group-count">2</span>')
    expect(html).toContain('<span class="conditional-format-group-count">1</span>')
  })

  it('收起契约：collapsed 里的组输出 is-collapsed + ▸ + aria-expanded=false', () => {
    const { rows, groups } = groupFixtures()
    const html = buildForeignRuleGroupsHtml(rows, groups, new Set(['=$J2="*"']))
    // CSS 靠 .conditional-format-group.is-collapsed 藏行（.conditional-format-row），
    // HTML 侧必须把类名与展开态如实输出——这个契约断过一次（收起完全没反应）
    expect(html).toContain('conditional-format-existing-group is-collapsed')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('>▸</button>')
    // 行仍然渲染（折叠只靠 CSS 藏）：计数仍说得通
    expect(html.match(/conditional-format-row-head/g)).toBeNull()
    expect(html).toContain('data-row-index="1"')
  })

  it('未收起的组输出 ▾ + aria-expanded=true', () => {
    const { rows, groups } = groupFixtures()
    const html = buildForeignRuleGroupsHtml(rows, groups, new Set())
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('>▾</button>')
    expect(html).not.toContain('is-collapsed')
  })

  it('未分组恒排最后（用户主动归的组先看到）', () => {
    const rows = toForeignRuleRows([
      snapshot({ range: 'A1', formula: '=1' }),
      snapshot({ range: 'B1', formula: '=2' }),
    ])
    const html = buildForeignRuleGroupsHtml(rows, {}, new Set())
    expect(html.indexOf('未分组')).toBeGreaterThan(-1)
    // 两条都没归组 → 只有一个「未分组」组，且在文档中唯一
    expect(html.match(/data-group="未分组"/g)).toHaveLength(1)
  })

  it('组名转义：公式模式串含引号也不破 attribute', () => {
    const row = toForeignRuleRows([snapshot({ range: 'J2:J9', formula: '=$J2="x"' })])
    const html = buildForeignRuleGroupsHtml(
      row,
      { [snapshotGroupKey(row[0]!)]: '=$J2="*"' },
      new Set(),
    )
    expect(html).toContain('data-group="=$J2=&quot;*&quot;"')
  })
})

describe('分组 key 口径（渲染层与存储层一致）', () => {
  it('范围读不到的规则也能归组：groupKey 用原始范围，不用显示兜底串', () => {
    // 读不到范围时行上 range 是「（未读到范围）」，映射却用原始 '' 存——
    // 拿兜底串现算 key 永远命中不了，规则会死死掉进「未分组」
    const noRange = snapshot({ range: '', formula: '=$A1>1' })
    const rows = toForeignRuleRows([noRange])
    const html = buildForeignRuleGroupsHtml(
      rows,
      { [snapshotGroupKey(noRange)]: '我的组' },
      new Set(),
    )
    expect(html).toContain('data-group="我的组"')
    expect(html).not.toContain('data-group="未分组"')
  })
})
