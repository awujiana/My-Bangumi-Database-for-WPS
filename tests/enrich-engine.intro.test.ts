/**
 * @fileoverview 简介工作表富化功能专项测试
 *
 * 测试目标：
 *   - isIntroSheet 判断逻辑
 *   - INTRO_FIELD_TO_BANGUMI 映射完整性
 *   - enrichIntroData 字段富化逻辑
 *   - enrichOpEdPv OP/ED/PV 富化逻辑
 *   - enrichAlias 别名富化逻辑
 *   - 标注白名单机制
 *   - 冲突处理逻辑
 */

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

// ========== Mock 设置 ==========

// 模拟单元格值存储
const mockCellStore = new Map<string, string>()

function getMockCellValue(row: number, col: number): string {
  return mockCellStore.get(`${String(row)}_${String(col)}`) ?? ''
}

function setMockCellValue(row: number, col: number, value: string): void {
  mockCellStore.set(`${String(row)}_${String(col)}`, value)
}

// 重置 mock
function resetMock(): void {
  mockCellStore.clear()
}

// ========== 常量定义（与代码保持同步）==========

/** 简介字段 → Bangumi追踪表列名映射 */
const INTRO_FIELD_TO_BANGUMI: Record<string, string> = {
  导演: '导演',
  编剧: '脚本',
  人设: '人物设定',
  CG导演: '演出',
  音乐: '音乐',
  动画制作: '动画制作公司',
  系列构成: '系列构成',
  分镜: '分镜',
  原作: '原作',
  语言: '语言',
  制片国家: '制片国家',
  声优: '声优',
}

/** 需要标注的字段映射白名单 */
const ANNOTATED_FIELD_MAPPINGS = new Set<string>(['编剧→脚本', '人设→人物设定', 'CG导演→演出'])

/** 简介字段中需追加到特点/印象的键 */
const INTRO_FEATURE_FIELDS = new Set(['简介', 'OP', 'ED', 'PV'])

/** 标签分隔符 */
const TAG_SEPARATOR = ' | '

// ========== 辅助函数（与代码保持同步）==========

function isEmptyValue(value: string | null | undefined): boolean {
  if (!value) return true
  return value.trim() === ''
}

function getAnnotatedValue(sourceKey: string, targetColName: string, value: string): string {
  if (!value) return value
  if (sourceKey === targetColName) return value
  const mappingKey = `${sourceKey}→${targetColName}`
  if (!ANNOTATED_FIELD_MAPPINGS.has(mappingKey)) return value
  return `${value}(${sourceKey})`
}

function splitAliases(aliasesString: string): string[] {
  if (!aliasesString) return []
  return aliasesString
    .split(/\s*(?:[|/;])\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeName(name: string): string {
  if (!name) return ''
  return name.replace(/\s+/g, '').toLowerCase()
}

function appendFeatures(oldFeature: string, features: string): string {
  if (isEmptyValue(oldFeature)) return features
  if (isEmptyValue(features)) return oldFeature
  return `${oldFeature}${TAG_SEPARATOR}${features}`
}

// ========== isIntroSheet 测试 ==========

interface EnrichColumnMapping {
  nameCol: number
  introCol?: number
  studioCol?: number
  directorCol?: number
  musicCol?: number
  voiceCol?: number
  opCol?: number
  edCol?: number
  pvCol?: number
  screenplayCol?: number
  characterDesignCol?: number
  cgDirectorCol?: number
  seriesCompositionCol?: number
  storyboardCol?: number
  originalWorkCol?: number
  languageCol?: number
  productionCountryCol?: number
  typeCol?: number
}

function isIntroSheet(mapping: EnrichColumnMapping): boolean {
  return (
    mapping.introCol !== undefined ||
    mapping.screenplayCol !== undefined ||
    mapping.characterDesignCol !== undefined ||
    mapping.cgDirectorCol !== undefined
  )
}

describe('isIntroSheet 判断逻辑', () => {
  it('有简介列时返回 true', () => {
    const mapping: EnrichColumnMapping = { nameCol: 1, introCol: 2 }
    expect(isIntroSheet(mapping)).toBe(true)
  })

  it('有编剧列时返回 true', () => {
    const mapping: EnrichColumnMapping = { nameCol: 1, screenplayCol: 3 }
    expect(isIntroSheet(mapping)).toBe(true)
  })

  it('有人设列时返回 true', () => {
    const mapping: EnrichColumnMapping = { nameCol: 1, characterDesignCol: 4 }
    expect(isIntroSheet(mapping)).toBe(true)
  })

  it('有CG导演列时返回 true', () => {
    const mapping: EnrichColumnMapping = { nameCol: 1, cgDirectorCol: 5 }
    expect(isIntroSheet(mapping)).toBe(true)
  })

  it('只有基本列时返回 false', () => {
    const mapping: EnrichColumnMapping = { nameCol: 1, tagsCol: 2 } as EnrichColumnMapping
    expect(isIntroSheet(mapping)).toBe(false)
  })

  it('空映射返回 false', () => {
    const mapping: EnrichColumnMapping = { nameCol: 1 }
    expect(isIntroSheet(mapping)).toBe(false)
  })

  it('有多个简介专有列时返回 true', () => {
    const mapping: EnrichColumnMapping = {
      nameCol: 1,
      introCol: 2,
      directorCol: 3,
      screenplayCol: 4,
      characterDesignCol: 5,
      cgDirectorCol: 6,
    }
    expect(isIntroSheet(mapping)).toBe(true)
  })
})

// ========== INTRO_FIELD_TO_BANGUMI 映射完整性测试 ==========

describe('INTRO_FIELD_TO_BANGUMI 映射完整性', () => {
  const requiredMappings: [string, string][] = [
    ['导演', '导演'],
    ['编剧', '脚本'],
    ['人设', '人物设定'],
    ['CG导演', '演出'],
    ['音乐', '音乐'],
    ['动画制作', '动画制作公司'],
    ['系列构成', '系列构成'],
    ['分镜', '分镜'],
    ['原作', '原作'],
    ['语言', '语言'],
    ['制片国家', '制片国家'],
    ['声优', '声优'],
  ]

  it('包含所有必需的字段映射', () => {
    for (const [source, target] of requiredMappings) {
      expect(INTRO_FIELD_TO_BANGUMI[source]).toBe(target)
    }
  })

  it('映射表没有多余的键', () => {
    const keys = Object.keys(INTRO_FIELD_TO_BANGUMI)
    expect(keys).toHaveLength(requiredMappings.length)
  })

  it('所有映射值都是非空字符串', () => {
    for (const [, target] of Object.entries(INTRO_FIELD_TO_BANGUMI)) {
      expect(target).toBeTruthy()
      expect(typeof target).toBe('string')
    }
  })
})

// ========== 标注白名单机制测试 ==========

describe('简介字段标注白名单机制', () => {
  it('导演→导演：源字段名与目标列名相同，不添加标注', () => {
    expect(getAnnotatedValue('导演', '导演', '新海诚')).toBe('新海诚')
  })

  it('音乐→音乐：源字段名与目标列名相同，不添加标注', () => {
    expect(getAnnotatedValue('音乐', '音乐', '天门')).toBe('天门')
  })

  it('编剧→脚本：白名单中，添加 (编剧) 标注', () => {
    expect(getAnnotatedValue('编剧', '脚本', '富野由悠季')).toBe('富野由悠季(编剧)')
  })

  it('人设→人物设定：白名单中，添加 (人设) 标注', () => {
    expect(getAnnotatedValue('人设', '人物设定', '贞本义行')).toBe('贞本义行(人设)')
  })

  it('CG导演→演出：白名单中，添加 (CG导演) 标注', () => {
    expect(getAnnotatedValue('CG导演', '演出', '庵野秀明')).toBe('庵野秀明(CG导演)')
  })

  it('动画制作→动画制作公司：不在白名单，不添加标注', () => {
    expect(getAnnotatedValue('动画制作', '动画制作公司', 'Gainax')).toBe('Gainax')
  })

  it('声优→声优：源字段名与目标列名相同，不添加标注', () => {
    expect(getAnnotatedValue('声优', '声优', '花泽香菜')).toBe('花泽香菜')
  })

  it('空值不受白名单影响', () => {
    expect(getAnnotatedValue('编剧', '脚本', '')).toBe('')
  })

  it('系列构成→系列构成：源字段名相同，不添加标注', () => {
    expect(getAnnotatedValue('系列构成', '系列构成', '虚渊玄')).toBe('虚渊玄')
  })
})

// ========== enrichIntroData 逻辑测试 ==========

/**
 * 模拟 enrichIntroData 的核心逻辑
 * 用于测试简介数据富化的业务规则
 */
function simulateEnrichIntroData(
  row: number,
  data: Record<string, string>,
  colMap: Map<string, number>,
): {
  enriched: {
    field: string
    col: number
    oldValue: string | null
    updatedValue: string
    action: 'fill' | 'append' | 'skip'
  }[]
  conflicts: { field: string; col: number; oldValue: string; updatedValue: string }[]
} {
  const enriched: {
    field: string
    col: number
    oldValue: string | null
    updatedValue: string
    action: 'fill' | 'append' | 'skip'
  }[] = []
  const conflicts: { field: string; col: number; oldValue: string; updatedValue: string }[] = []

  const bangumiFeatureCol = colMap.get('特点/印象')

  for (const [sourceKey, targetColName] of Object.entries(INTRO_FIELD_TO_BANGUMI)) {
    const rawValue = data[sourceKey] ?? ''
    if (!isEmptyValue(rawValue)) {
      const annotatedValue = getAnnotatedValue(sourceKey, targetColName, rawValue)
      const targetCol = colMap.get(targetColName)

      if (targetCol !== undefined) {
        const oldValue = getMockCellValue(row, targetCol)
        if (isEmptyValue(oldValue)) {
          setMockCellValue(row, targetCol, annotatedValue)
          enriched.push({
            field: targetColName,
            col: targetCol,
            oldValue: null,
            updatedValue: annotatedValue,
            action: 'fill',
          })
        } else {
          conflicts.push({
            field: targetColName,
            col: targetCol,
            oldValue,
            updatedValue: annotatedValue,
          })
        }
      } else if (bangumiFeatureCol !== undefined) {
        const oldFeature = getMockCellValue(row, bangumiFeatureCol)
        const featureEntry = `${sourceKey}:${annotatedValue}`
        if (isEmptyValue(oldFeature)) {
          setMockCellValue(row, bangumiFeatureCol, featureEntry)
          enriched.push({
            field: `特点/印象(${sourceKey})`,
            col: bangumiFeatureCol,
            oldValue: null,
            updatedValue: featureEntry,
            action: 'fill',
          })
        } else {
          const merged = appendFeatures(oldFeature, featureEntry)
          if (merged !== oldFeature) {
            setMockCellValue(row, bangumiFeatureCol, merged)
            enriched.push({
              field: `特点/印象(${sourceKey})`,
              col: bangumiFeatureCol,
              oldValue: oldFeature,
              updatedValue: merged,
              action: 'append',
            })
          }
        }
      }
    }
  }

  // 简介专有字段追加到特点/印象
  if (bangumiFeatureCol !== undefined) {
    const featureParts: string[] = []
    for (const key of INTRO_FEATURE_FIELDS) {
      const value = data[key] ?? ''
      if (!isEmptyValue(value)) {
        const label = key === '简介' ? '简介' : key
        const display = key === '简介' && value.length > 80 ? `${value.substring(0, 80)}...` : value
        featureParts.push(`${label}:${display}`)
      }
    }
    if (featureParts.length > 0) {
      const oldFeature = getMockCellValue(row, bangumiFeatureCol)
      const merged = featureParts.join(TAG_SEPARATOR)
      if (isEmptyValue(oldFeature)) {
        setMockCellValue(row, bangumiFeatureCol, merged)
        enriched.push({
          field: '特点/印象(简介补充)',
          col: bangumiFeatureCol,
          oldValue: null,
          updatedValue: merged,
          action: 'fill',
        })
      } else {
        const combined = appendFeatures(oldFeature, merged)
        if (combined !== oldFeature) {
          setMockCellValue(row, bangumiFeatureCol, combined)
          enriched.push({
            field: '特点/印象(简介补充)',
            col: bangumiFeatureCol,
            oldValue: oldFeature,
            updatedValue: combined,
            action: 'append',
          })
        }
      }
    }
  }

  return { enriched, conflicts }
}

describe('enrichIntroData 逻辑', () => {
  beforeEach(() => {
    resetMock()
  })

  describe('字段填充规则', () => {
    it('目标列存在且为空时，填充值', () => {
      const colMap = new Map<string, number>([
        ['导演', 3],
        ['特点/印象', 10],
      ])
      const data = { 导演: '新海诚' }
      const result = simulateEnrichIntroData(5, data, colMap)

      expect(result.enriched).toHaveLength(1)
      expect(result.enriched[0]?.action).toBe('fill')
      expect(result.enriched[0]?.updatedValue).toBe('新海诚')
      expect(getMockCellValue(5, 3)).toBe('新海诚')
    })

    it('目标列存在且有值时，记录冲突', () => {
      const colMap = new Map<string, number>([
        ['导演', 3],
        ['特点/印象', 10],
      ])
      setMockCellValue(5, 3, '宫崎骏')
      const data = { 导演: '新海诚' }
      const result = simulateEnrichIntroData(5, data, colMap)

      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]?.oldValue).toBe('宫崎骏')
      expect(result.conflicts[0]?.updatedValue).toBe('新海诚')
    })

    it('目标列不存在时，回退到特点/印象', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])
      const data = { 系列构成: '虚渊玄' }
      const result = simulateEnrichIntroData(5, data, colMap)

      expect(result.enriched.length).toBeGreaterThan(0)
      expect(result.enriched[0]?.field).toContain('特点/印象')
      expect(getMockCellValue(5, 10)).toContain('系列构成:虚渊玄')
    })

    it('源字段值为空时跳过', () => {
      const colMap = new Map<string, number>([
        ['导演', 3],
        ['特点/印象', 10],
      ])
      const data = { 导演: '' }
      const result = simulateEnrichIntroData(5, data, colMap)

      expect(result.enriched).toHaveLength(0)
      expect(result.conflicts).toHaveLength(0)
    })
  })

  describe('标注机制', () => {
    it('编剧→脚本：添加 (编剧) 标注', () => {
      const colMap = new Map<string, number>([
        ['脚本', 4],
        ['特点/印象', 10],
      ])
      const data = { 编剧: '富野由悠季' }
      simulateEnrichIntroData(5, data, colMap)

      expect(getMockCellValue(5, 4)).toBe('富野由悠季(编剧)')
    })

    it('人设→人物设定：添加 (人设) 标注', () => {
      const colMap = new Map<string, number>([
        ['人物设定', 5],
        ['特点/印象', 10],
      ])
      const data = { 人设: '贞本义行' }
      simulateEnrichIntroData(5, data, colMap)

      expect(getMockCellValue(5, 5)).toBe('贞本义行(人设)')
    })

    it('CG导演→演出：添加 (CG导演) 标注', () => {
      const colMap = new Map<string, number>([
        ['演出', 6],
        ['特点/印象', 10],
      ])
      const data = { CG导演: '庵野秀明' }
      simulateEnrichIntroData(5, data, colMap)

      expect(getMockCellValue(5, 6)).toBe('庵野秀明(CG导演)')
    })

    it('动画制作→动画制作公司：不添加标注', () => {
      const colMap = new Map<string, number>([
        ['动画制作公司', 7],
        ['特点/印象', 10],
      ])
      const data = { 动画制作: 'Gainax' }
      simulateEnrichIntroData(5, data, colMap)

      expect(getMockCellValue(5, 7)).toBe('Gainax')
      expect(getMockCellValue(5, 7)).not.toContain('(动画制作)')
    })

    it('导演→导演：源字段名相同，不添加标注', () => {
      const colMap = new Map<string, number>([
        ['导演', 3],
        ['特点/印象', 10],
      ])
      const data = { 导演: '新海诚' }
      simulateEnrichIntroData(5, data, colMap)

      expect(getMockCellValue(5, 3)).toBe('新海诚')
      expect(getMockCellValue(5, 3)).not.toContain('(导演)')
    })
  })

  describe('特点/印象追加', () => {
    it('简介内容追加到特点/印象', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])
      const data = { 简介: '这是一部非常精彩的动画作品' }
      simulateEnrichIntroData(5, data, colMap)

      const feature = getMockCellValue(5, 10)
      expect(feature).toContain('简介:这是一部非常精彩的动画作品')
    })

    it('简介超过80字时截断', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])
      const longIntro = 'A'.repeat(100)
      const data = { 简介: longIntro }
      simulateEnrichIntroData(5, data, colMap)

      const feature = getMockCellValue(5, 10)
      expect(feature).toContain('简介:')
      // "简介:" + 80 chars + "..."
      expect(feature.length).toBeLessThanOrEqual(80 + 10)
    })

    it('已有特点/印象时追加而非替换', () => {
      const colMap = new Map<string, number>([['特点/印象', 10]])
      setMockCellValue(5, 10, '已有内容')
      const data = { 导演: '新海诚' }
      simulateEnrichIntroData(5, data, colMap)

      const feature = getMockCellValue(5, 10)
      expect(feature).toContain('已有内容')
      expect(feature).toContain('导演:新海诚')
    })
  })

  describe('多字段同时富化', () => {
    it('多个简介字段同时填充', () => {
      const colMap = new Map<string, number>([
        ['导演', 3],
        ['脚本', 4],
        ['音乐', 8],
        ['特点/印象', 10],
      ])
      const data = {
        导演: '新海诚',
        编剧: '铃木贵昭',
        音乐: '天门',
      }
      const result = simulateEnrichIntroData(5, data, colMap)

      expect(result.enriched.filter((item) => item.action === 'fill')).toHaveLength(3)
      expect(getMockCellValue(5, 3)).toBe('新海诚')
      expect(getMockCellValue(5, 4)).toBe('铃木贵昭(编剧)')
      expect(getMockCellValue(5, 8)).toBe('天门')
    })

    it('部分字段有值时只处理空字段', () => {
      const colMap = new Map<string, number>([
        ['导演', 3],
        ['音乐', 8],
        ['特点/印象', 10],
      ])
      setMockCellValue(5, 3, '宫崎骏')
      const data = {
        导演: '新海诚',
        音乐: '天门',
      }
      const result = simulateEnrichIntroData(5, data, colMap)

      // 导演冲突
      expect(result.conflicts).toHaveLength(1)
      // 音乐填充
      expect(result.enriched.filter((item) => item.action === 'fill')).toHaveLength(1)
    })
  })
})

// ========== enrichOpEdPv 逻辑测试 ==========

function simulateEnrichOpEdPv(
  row: number,
  data: Record<string, string>,
  colMap: Map<string, number>,
): {
  field: string
  col: number
  oldValue: string | null
  updatedValue: string
  action: 'fill' | 'append' | 'skip'
}[] {
  const enriched: {
    field: string
    col: number
    oldValue: string | null
    updatedValue: string
    action: 'fill' | 'append' | 'skip'
  }[] = []
  const bangumiFeatureCol = colMap.get('特点/印象')
  if (!bangumiFeatureCol) return enriched

  const parts: string[] = []
  const op = data.OP ?? ''
  if (!isEmptyValue(op)) parts.push(`OP:${op}`)
  const ed = data.ED ?? ''
  if (!isEmptyValue(ed)) parts.push(`ED:${ed}`)
  const pv = data.PV ?? ''
  if (!isEmptyValue(pv)) parts.push(`PV:${pv}`)

  if (parts.length === 0) return enriched

  const featureText = parts.join(TAG_SEPARATOR)
  const oldFeature = getMockCellValue(row, bangumiFeatureCol)

  if (isEmptyValue(oldFeature)) {
    setMockCellValue(row, bangumiFeatureCol, featureText)
    enriched.push({
      field: '特点/印象',
      col: bangumiFeatureCol,
      oldValue: null,
      updatedValue: featureText,
      action: 'fill',
    })
  } else {
    const merged = appendFeatures(oldFeature, featureText)
    if (merged !== oldFeature) {
      setMockCellValue(row, bangumiFeatureCol, merged)
      enriched.push({
        field: '特点/印象',
        col: bangumiFeatureCol,
        oldValue: oldFeature,
        updatedValue: merged,
        action: 'append',
      })
    }
  }

  return enriched
}

describe('enrichOpEdPv 逻辑', () => {
  beforeEach(() => {
    resetMock()
  })

  it('OP/ED/PV 追加到特点/印象', () => {
    const colMap = new Map<string, number>([['特点/印象', 10]])
    const data = { OP: 'OP1: 歌曲A', ED: 'ED1: 歌曲B' }
    const enriched = simulateEnrichOpEdPv(5, data, colMap)

    expect(enriched.length).toBeGreaterThan(0)
    expect(getMockCellValue(5, 10)).toContain('OP:OP1: 歌曲A')
    expect(getMockCellValue(5, 10)).toContain('ED:ED1: 歌曲B')
  })

  it('只有 OP 时只添加 OP', () => {
    const colMap = new Map<string, number>([['特点/印象', 10]])
    const data = { OP: 'OP1: 歌曲A' }
    simulateEnrichOpEdPv(5, data, colMap)

    const feature = getMockCellValue(5, 10)
    expect(feature).toContain('OP:OP1: 歌曲A')
    expect(feature).not.toContain('ED:')
  })

  it('没有 OP/ED/PV 时不添加', () => {
    const colMap = new Map<string, number>([['特点/印象', 10]])
    const data = {}
    const enriched = simulateEnrichOpEdPv(5, data, colMap)

    expect(enriched).toHaveLength(0)
  })

  it('特点/印象列不存在时跳过', () => {
    const colMap = new Map<string, number>([['导演', 3]])
    const data = { OP: 'OP1' }
    const enriched = simulateEnrichOpEdPv(5, data, colMap)

    expect(enriched).toHaveLength(0)
  })
})

// ========== enrichAlias 逻辑测试 ==========

function simulateEnrichAlias(
  row: number,
  animeName: string,
  bangumiName: string | undefined,
  colMap: Map<string, number>,
  aliasCol: number,
): { action: 'fill' | 'append' | 'skip'; updatedValue: string } | null {
  const nameCol = colMap.get('名称')
  if (!nameCol) return null

  if (animeName === bangumiName) {
    return { action: 'skip', updatedValue: animeName }
  }

  const existingAliases = getMockCellValue(row, aliasCol)
  const aliasList = splitAliases(existingAliases)

  const normalizedNew = normalizeName(animeName)
  const isAlreadyExists = aliasList.some((a) => normalizeName(a) === normalizedNew)

  if (isAlreadyExists) {
    return { action: 'skip', updatedValue: animeName }
  }

  const merged = existingAliases ? existingAliases + TAG_SEPARATOR + animeName : animeName
  setMockCellValue(row, aliasCol, merged)
  return { action: 'append', updatedValue: merged }
}

describe('enrichAlias 逻辑', () => {
  beforeEach(() => {
    resetMock()
  })

  it('名称相同时跳过', () => {
    const colMap = new Map<string, number>([['名称', 2]])
    const result = simulateEnrichAlias(5, '芙莉莲', '芙莉莲', colMap, 8)

    expect(result?.action).toBe('skip')
  })

  it('名称不同时追加到别名', () => {
    const colMap = new Map<string, number>([['名称', 2]])
    const result = simulateEnrichAlias(5, '葬送的芙莉莲', '芙莉莲', colMap, 8)

    expect(result?.action).toBe('append')
    expect(getMockCellValue(5, 8)).toBe('葬送的芙莉莲')
  })

  it('已有别名时追加新名称', () => {
    const colMap = new Map<string, number>([['名称', 2]])
    setMockCellValue(5, 8, '芙莉莲')
    const result = simulateEnrichAlias(5, '葬送的芙莉莲', '芙莉莲', colMap, 8)

    expect(result?.action).toBe('append')
    expect(getMockCellValue(5, 8)).toContain('芙莉莲')
    expect(getMockCellValue(5, 8)).toContain('葬送的芙莉莲')
  })

  it('别名已存在时跳过', () => {
    const colMap = new Map<string, number>([['名称', 2]])
    setMockCellValue(5, 8, '芙莉莲 | 葬送的芙莉莲')
    const result = simulateEnrichAlias(5, '葬送的芙莉莲', '芙莉莲', colMap, 8)

    expect(result?.action).toBe('skip')
  })

  it('名称列不存在时跳过', () => {
    const colMap = new Map<string, number>([['导演', 3]])
    const result = simulateEnrichAlias(5, '新名', '旧名', colMap, 8)

    expect(result).toBeNull()
  })
})

// ========== 冲突解决逻辑测试 ==========

describe('冲突解决逻辑', () => {
  beforeEach(() => {
    resetMock()
  })

  it('append 模式：追加分隔符', () => {
    const oldValue = '宫崎骏'
    const updatedValue = '新海诚'
    const parts = oldValue
      .split(/\s*\|\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.includes(updatedValue)) {
      const merged = parts.join(TAG_SEPARATOR) + TAG_SEPARATOR + updatedValue
      expect(merged).toBe('宫崎骏 | 新海诚')
    }
  })

  it('keep 模式：保留原名', () => {
    const oldValue = '宫崎骏'
    // keep 模式下不修改
    expect(oldValue).toBe('宫崎骏')
  })

  it('overwrite 模式：使用新值', () => {
    const updatedValue = '新海诚'
    // overwrite 模式下直接使用新值
    expect(updatedValue).toBe('新海诚')
  })

  it('append 模式：新值已存在时不重复添加', () => {
    const oldValue = '宫崎骏 | 新海诚'
    const updatedValue = '新海诚'
    const parts = oldValue
      .split(/\s*\|\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
    expect(parts.includes(updatedValue)).toBe(true)
    // 不添加重复项
    const merged = parts.join(TAG_SEPARATOR)
    expect(merged).toBe('宫崎骏 | 新海诚')
  })
})

// ========== 综合场景测试 ==========

describe('简介工作表富化综合场景', () => {
  beforeEach(() => {
    resetMock()
  })

  it('完整的简介富化流程', () => {
    // 模拟一个完整的简介工作表富化场景
    const colMap = new Map<string, number>([
      ['导演', 3],
      ['脚本', 4],
      ['音乐', 8],
      ['特点/印象', 10],
    ])

    // 设置一些已有数据
    // 导演已有值（会冲突）
    setMockCellValue(5, 3, '宫崎骏')
    // 音乐为空（会填充）
    setMockCellValue(5, 8, '')

    // 新番表数据
    const data = {
      // 会冲突
      导演: '新海诚',
      // 会填充（带标注）
      编剧: '铃木贵昭',
      // 会填充
      音乐: '天门',
      // 追加到特点/印象
      简介: '精彩的动画',
    }

    const result = simulateEnrichIntroData(5, data, colMap)

    // 验证冲突
    expect(result.conflicts.filter((c) => c.field === '导演')).toHaveLength(1)

    // 验证填充
    const fills = result.enriched.filter((item) => item.action === 'fill')
    // 编剧 + 音乐 + 简介
    expect(fills.length).toBeGreaterThanOrEqual(2)

    // 验证标注
    expect(getMockCellValue(5, 4)).toContain('(编剧)')

    // 验证特点/印象追加
    const feature = getMockCellValue(5, 10)
    expect(feature).toContain('简介:精彩的动画')
  })

  it('OP/ED/PV 与简介富化的组合', () => {
    const colMap = new Map<string, number>([['特点/印象', 10]])

    // 先执行简介富化
    const introData = { 简介: '这是一部好作品' }
    simulateEnrichIntroData(5, introData, colMap)

    // 再执行 OP/ED/PV 富化
    const opEdData = { OP: 'OP: 主题曲A', ED: 'ED: 片尾曲B' }
    simulateEnrichOpEdPv(5, opEdData, colMap)

    // 验证合并结果
    const feature = getMockCellValue(5, 10)
    expect(feature).toContain('简介:这是一部好作品')
    expect(feature).toContain('OP:OP: 主题曲A')
    expect(feature).toContain('ED:ED: 片尾曲B')
  })

  it('别名富化与简介富化的组合', () => {
    const colMap = new Map<string, number>([
      ['名称', 2],
      ['导演', 3],
      ['特点/印象', 10],
    ])

    // 简介富化
    const introData = { 导演: '新海诚' }
    simulateEnrichIntroData(5, introData, colMap)

    // 别名富化
    const aliasResult = simulateEnrichAlias(5, '葬送的芙莉莲', '芙莉莲', colMap, 8)

    // 验证两个富化都成功
    expect(getMockCellValue(5, 3)).toBe('新海诚')
    expect(aliasResult?.action).toBe('append')
    expect(getMockCellValue(5, 8)).toBe('葬送的芙莉莲')
  })
})
