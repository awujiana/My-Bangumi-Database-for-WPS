import { describe, it, expect } from 'vitest'

import {
  CLEAN_RULES,
  CLEAN_TARGETS,
  CLEAN_EXCLUDES,
  NOISE_TAGS,
  NOISE_TAG_PATTERNS,
  ORIGINAL_TAG_RULES,
  findCleanRule,
  RISK_LABELS,
} from '../ts/panel/clean-rules.js'

describe('CLEAN_RULES 配置不变量', () => {
  it('id 全局唯一', () => {
    const ids = CLEAN_RULES.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cellTransform 规则必须配置 transform 与 columns', () => {
    const transformRules = CLEAN_RULES.filter((rule) => rule.kind === 'cellTransform')
    expect(transformRules.length).toBeGreaterThan(0)
    for (const rule of transformRules) {
      expect(rule.transform, `${rule.id} 缺 transform`).toBeTruthy()
      expect(rule.columns?.length, `${rule.id} 缺 columns`).toBeGreaterThan(0)
    }
  })

  it('cellTransform 的 transform 必须在已知 ID 集合内', () => {
    const knownIds = new Set([
      'stripNoiseTags',
      'normalizeTagSeparator',
      'stripCategoryNumberPrefix',
      'dedupAliasAgainstName',
      'normalizeOriginalTag',
    ])
    for (const rule of CLEAN_RULES) {
      if (rule.transform) expect(knownIds.has(rule.transform), rule.id).toBe(true)
    }
  })

  it('风险等级必须是 low / medium / high 且有对应文案', () => {
    for (const rule of CLEAN_RULES) {
      expect(RISK_LABELS[rule.risk]).toBeTruthy()
    }
  })

  it('分组名非空（页面按 group 分组渲染）', () => {
    for (const rule of CLEAN_RULES) {
      expect(rule.group.length).toBeGreaterThan(0)
    }
  })

  it('findCleanRule 命中与未命中', () => {
    expect(findCleanRule('dup-name')?.name).toBe('重复名称行')
    expect(findCleanRule('__missing__')).toBeUndefined()
  })
})

describe('CLEAN_TARGETS / CLEAN_EXCLUDES 配置', () => {
  it('工作簿排除规则包含 WPS 临时锁文件前缀', () => {
    expect(CLEAN_TARGETS.excludeWorkbookPath).toContain('~$')
  })

  it('必备表头关键词包含「名称」', () => {
    expect(CLEAN_TARGETS.requireHeaderKeywords).toContain('名称')
  })

  it('排除表名包含同步记录 / 日志类关键词', () => {
    expect(CLEAN_EXCLUDES.sheetName).toContain('同步记录')
    expect(CLEAN_EXCLUDES.sheetName).toContain('日志')
  })

  it('排除行文本包含模板噪声关键词', () => {
    expect(CLEAN_EXCLUDES.rowText).toContain('新番表 by Hazx')
  })

  it('行数护栏为正数', () => {
    expect(CLEAN_TARGETS.maxDataRows).toBeGreaterThan(0)
    expect(CLEAN_EXCLUDES.minDataRows).toBeGreaterThan(0)
    expect(CLEAN_EXCLUDES.rowScanColumns).toBeGreaterThan(0)
  })
})

describe('噪声词表与归一化规则', () => {
  it('噪声词表非空且无重复', () => {
    expect(NOISE_TAGS.length).toBeGreaterThan(0)
    expect(new Set(NOISE_TAGS).size).toBe(NOISE_TAGS.length)
  })

  it('噪声正则覆盖纯年份与年月', () => {
    expect(NOISE_TAG_PATTERNS.some((pattern) => pattern.test('2024'))).toBe(true)
    expect(NOISE_TAG_PATTERNS.some((pattern) => pattern.test('2024-04'))).toBe(true)
    expect(NOISE_TAG_PATTERNS.some((pattern) => pattern.test('漫画'))).toBe(false)
  })

  it('原作规则：特例输出与国家均在国家表内', () => {
    for (const rule of ORIGINAL_TAG_RULES.specialCases) {
      expect(ORIGINAL_TAG_RULES.countries).toContain(rule.country)
      expect(rule.output.length).toBeGreaterThan(0)
    }
  })

  it('优先级规则的 higher 与 lower 不同', () => {
    for (const rule of ORIGINAL_TAG_RULES.priorityRules) {
      expect(rule.higher).not.toBe(rule.lower)
    }
  })
})
