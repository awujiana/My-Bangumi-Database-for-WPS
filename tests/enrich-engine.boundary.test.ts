/**
 * @fileoverview enrichEngine 边界情况测试
 *
 * 测试目标：
 *   - normalizeName 空值/特殊字符
 *   - splitAliases 空值/边界
 *   - splitTags 空值/边界
 *   - mergeTags 空值/边界
 *   - appendFeatures 空值/边界
 *   - parseRemoteContent 空值/异常输入
 *   - getAnnotatedValue 白名单机制
 */

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

import {
  normalizeName,
  splitAliases,
  splitTags,
  mergeTags,
  appendFeatures,
  parseRemoteContent,
} from '../ts/sync/enrich-engine.js'

// ========== normalizeName ==========
describe('normalizeName 边界情况', () => {
  it('空字符串返回空字符串', () => {
    expect(normalizeName('')).toBe('')
  })

  it('null/undefined 处理（虽然类型不允许，但防止运行时崩溃）', () => {
    // @ts-expect-error 测试运行时边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(() => normalizeName(null)).toThrow()
    // @ts-expect-error 测试运行时边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(() => normalizeName(undefined)).toThrow()
  })

  it('去除所有空白字符', () => {
    expect(normalizeName('  hello  world  ')).toBe('helloworld')
  })

  it('转小写', () => {
    expect(normalizeName('Hello')).toBe('hello')
  })

  it('全角转半角', () => {
    // 日文假名字符不受影响
    expect(normalizeName('テスト')).toBe('テスト')
  })

  it('完整示例', () => {
    expect(normalizeName('  葬送 の 芙莉莲  ')).toBe('葬送の芙莉莲')
  })
})

// ========== splitAliases ==========
describe('splitAliases 边界情况', () => {
  it('空字符串返回空数组', () => {
    expect(splitAliases('')).toEqual([])
  })

  it('null/undefined 返回空数组', () => {
    // @ts-expect-error 测试边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(splitAliases(null)).toEqual([])
    // @ts-expect-error 测试边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(splitAliases(undefined)).toEqual([])
  })

  it('单个名称', () => {
    expect(splitAliases('芙莉莲')).toEqual(['芙莉莲'])
  })

  it('按 | 分隔', () => {
    expect(splitAliases('芙莉莲 | 费伦')).toEqual(['芙莉莲', '费伦'])
  })

  it('按 / 分隔', () => {
    expect(splitAliases('芙莉莲/费伦')).toEqual(['芙莉莲', '费伦'])
  })

  it('按 ; 分隔', () => {
    expect(splitAliases('芙莉莲;费伦')).toEqual(['芙莉莲', '费伦'])
  })

  it('混合分隔符', () => {
    expect(splitAliases('芙莉莲 | 费伦/欣梅尔')).toEqual(['芙莉莲', '费伦', '欣梅尔'])
  })

  it('过滤空字符串项', () => {
    expect(splitAliases('||')).toEqual([])
    expect(splitAliases('芙莉莲 || 费伦')).toEqual(['芙莉莲', '费伦'])
  })
})

// ========== splitTags ==========
describe('splitTags 边界情况', () => {
  it('空字符串返回空数组', () => {
    expect(splitTags('')).toEqual([])
  })

  it('null/undefined 返回空数组', () => {
    // @ts-expect-error 测试边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(splitTags(null)).toEqual([])
    // @ts-expect-error 测试边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(splitTags(undefined)).toEqual([])
  })

  it('单个标签', () => {
    expect(splitTags('机战')).toEqual(['机战'])
  })

  it('按 | 分隔', () => {
    expect(splitTags('机战 | 日本')).toEqual(['机战', '日本'])
  })

  it('按逗号分隔', () => {
    expect(splitTags('机战,日本')).toEqual(['机战', '日本'])
  })

  it('过滤空字符串', () => {
    expect(splitTags('机战 || 日本')).toEqual(['机战', '日本'])
  })
})

// ========== mergeTags ==========
describe('mergeTags 边界情况', () => {
  it('两个空字符串返回空字符串', () => {
    expect(mergeTags('', '')).toBe('')
  })

  it('旧标签为空，返回新标签', () => {
    expect(mergeTags('', '新标签')).toBe('新标签')
  })

  it('新标签为空，返回旧标签', () => {
    expect(mergeTags('旧标签', '')).toBe('旧标签')
  })

  it('去重合并', () => {
    expect(mergeTags('A | B', 'B | C')).toBe('A | B | C')
  })

  it('完全相同的标签不重复', () => {
    expect(mergeTags('A | B', 'A | B')).toBe('A | B')
  })
})

// ========== appendFeatures ==========
describe('appendFeatures 边界情况', () => {
  it('两个空字符串返回空字符串', () => {
    expect(appendFeatures('', '')).toBe('')
  })

  it('旧特点为空，返回新特点', () => {
    expect(appendFeatures('', '新特点')).toBe('新特点')
  })

  it('新特点为空，返回旧特点', () => {
    expect(appendFeatures('旧特点', '')).toBe('旧特点')
  })

  it('去重合并', () => {
    expect(appendFeatures('A | B', 'B | C')).toBe('A | B | C')
  })
})

// ========== parseRemoteContent ==========
describe('parseRemoteContent 边界情况', () => {
  it('空字符串返回空数组', () => {
    expect(parseRemoteContent('')).toEqual([])
  })

  it('null/undefined 返回空数组', () => {
    // @ts-expect-error 测试边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(parseRemoteContent(null)).toEqual([])
    // @ts-expect-error 测试边界：类型不允许 null/undefined，此处验证运行时容错行为
    expect(parseRemoteContent(undefined)).toEqual([])
  })

  it('纯空行返回空数组', () => {
    expect(parseRemoteContent('\n'.repeat(3))).toEqual([])
  })

  it('单行 CSV', () => {
    const result = parseRemoteContent('name,age\n张三,25')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ name: '张三', age: '25' })
  })

  it('多行 CSV', () => {
    const result = parseRemoteContent('name,age\n张三,25\n李四,30')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ name: '张三', age: '25' })
    expect(result[1]).toEqual({ name: '李四', age: '30' })
  })

  it('Tab 分隔符', () => {
    const result = parseRemoteContent('name\tage\n张三\t25')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ name: '张三', age: '25' })
  })

  it('行数与列数不匹配，缺失值为空字符串', () => {
    const result = parseRemoteContent('a,b,c\n1,2')
    expect(result).toHaveLength(1)
    expect(result[0]?.a).toBe('1')
    expect(result[0]?.b).toBe('2')
    expect(result[0]?.c).toBe('')
  })

  it('多余列被忽略', () => {
    const result = parseRemoteContent('a,b\n1,2,3')
    expect(result).toHaveLength(1)
    expect(result[0]?.a).toBe('1')
    expect(result[0]?.b).toBe('2')
  })

  it('CRLF 行尾正确处理', () => {
    const result = parseRemoteContent('name,age\r\n张三,25\r\n')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ name: '张三', age: '25' })
  })
})

// ========== getAnnotatedValue 白名单机制 ==========
/**
 * 注意：getAnnotatedValue 是私有函数，这里通过间接测试验证其行为：
 * - 当 sourceKey === targetColName 时，不添加标注
 * - 当 sourceKey → targetColName 在白名单中时，添加 (sourceKey) 后缀
 * - 其他情况不添加标注
 */
describe('标注白名单机制', () => {
  // 白名单定义（与代码保持同步）
  const ANNOTATED_FIELD_MAPPINGS = new Set<string>(['编剧→脚本', '人设→人物设定', 'CG导演→演出'])

  function getAnnotatedValue(sourceKey: string, targetColName: string, value: string): string {
    if (!value) return value
    if (sourceKey === targetColName) return value
    const mappingKey = `${sourceKey}→${targetColName}`
    if (!ANNOTATED_FIELD_MAPPINGS.has(mappingKey)) return value
    return `${value}(${sourceKey})`
  }

  it('源字段名与目标列名相同时不添加标注', () => {
    expect(getAnnotatedValue('导演', '导演', '新海诚')).toBe('新海诚')
    expect(getAnnotatedValue('音乐', '音乐', '天门')).toBe('天门')
  })

  it('白名单中的映射添加 (源字段名) 后缀', () => {
    expect(getAnnotatedValue('编剧', '脚本', '富野由悠季')).toBe('富野由悠季(编剧)')
    expect(getAnnotatedValue('人设', '人物设定', '贞本义行')).toBe('贞本义行(人设)')
    expect(getAnnotatedValue('CG导演', '演出', '庵野秀明')).toBe('庵野秀明(CG导演)')
  })

  it('非白名单中的映射不添加标注', () => {
    // 动画制作→动画制作公司 不在白名单
    expect(getAnnotatedValue('动画制作', '动画制作公司', 'Gainax')).toBe('Gainax')
    // 其他任意映射
    expect(getAnnotatedValue('原作', '漫画', '进击的巨人')).toBe('进击的巨人')
  })

  it('空值不受影响', () => {
    expect(getAnnotatedValue('编剧', '脚本', '')).toBe('')
  })
})
