import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isBangumiUrl,
  extractSubjectId,
  mapWatchStatus,
  setLogger,
} from '../ts/sync/pure-utilities-core.js'
import { URL_PATTERNS, WATCH_STATUS_MAP, LOG_LEVELS } from '../ts/core/constants.js'

/**
 * 纯函数逻辑测试 - isBangumiUrl / extractSubjectId / mapWatchStatus
 *
 * 测试策略：直接 import 源码实现，避免复制实现导致源码修改后测试不失败的问题。
 *
 * 模块依赖说明：
 *   - isBangumiUrl / extractSubjectId / mapWatchStatus 来自 pure-utilities-core.ts
 *     （仅依赖 core/constants 与 tools/string-utilities-pure，无副作用链）
 *   - URL_PATTERNS / WATCH_STATUS_MAP / LOG_LEVELS 来自 core/constants.ts（纯常量模块）
 *
 * 日志注入：mapWatchStatus 在状态无法识别时调用注入的日志函数。
 * 测试通过 setLogger(vi.fn()) 注入 mock，以便断言日志调用。
 */

// 注入 mock 日志函数，用于断言 mapWatchStatus 在无法识别状态时是否记录警告
const bgmLog = vi.fn()
setLogger(bgmLog)

describe('isBangumiUrl', () => {
  it('应识别 bgm.tv URL', () => {
    expect(isBangumiUrl('https://bgm.tv/subject/123456')).toBe(true)
  })

  it('应识别 bangumi.tv URL', () => {
    expect(isBangumiUrl('https://bangumi.tv/subject/123456')).toBe(true)
  })

  it('应识别 chii.in URL', () => {
    expect(isBangumiUrl('https://chii.in/subject/123456')).toBe(true)
  })

  it('应识别纯数字 ID', () => {
    expect(isBangumiUrl('123456')).toBe(true)
  })

  it('应拒绝非 BGM URL', () => {
    expect(isBangumiUrl('https://example.com/123')).toBe(false)
  })

  it('应拒绝空字符串与纯空白', () => {
    expect(isBangumiUrl('')).toBe(false)
    expect(isBangumiUrl(' '.repeat(3))).toBe(false)
  })
})

describe('extractSubjectId', () => {
  it('应从 bgm.tv URL 提取 ID', () => {
    expect(extractSubjectId('https://bgm.tv/subject/123456')).toBe('123456')
  })

  it('应从 bangumi.tv URL 提取 ID', () => {
    expect(extractSubjectId('https://bangumi.tv/subject/654321')).toBe('654321')
  })

  it('应从 chii.in URL 提取 ID', () => {
    expect(extractSubjectId('https://chii.in/subject/999')).toBe('999')
  })

  it('应从纯数字提取 ID', () => {
    expect(extractSubjectId('123456')).toBe('123456')
  })

  it('应从混合文本提取首个数字', () => {
    expect(extractSubjectId('bgm id 12345 and more')).toBe('12345')
  })

  it('应返回 null 当无数字', () => {
    expect(extractSubjectId('no numbers here')).toBe(null)
  })

  it('应处理空输入与空白', () => {
    expect(extractSubjectId('')).toBe(null)
    expect(extractSubjectId(' '.repeat(3))).toBe(null)
    expect(extractSubjectId(null as unknown as string)).toBe(null)
    expect(extractSubjectId(undefined as unknown as string)).toBe(null)
  })

  it('应拒绝超过 8 位的数字 ID（防脏数据）', () => {
    // 9 位数字超过 Bangumi Subject ID 上限
    expect(extractSubjectId('123456789')).toBe(null)
    expect(extractSubjectId('https://bgm.tv/subject/123456789')).toBe(null)
  })

  it('应接受 1-8 位数字 ID', () => {
    expect(extractSubjectId('1')).toBe('1')
    expect(extractSubjectId('12345678')).toBe('12345678')
  })
})

describe('mapWatchStatus', () => {
  beforeEach(() => {
    bgmLog.mockClear()
  })

  it('应映射"想看"为 1', () => {
    expect(mapWatchStatus('想看')).toBe(1)
    expect(mapWatchStatus('想看动画')).toBe(1)
    expect(mapWatchStatus('wish')).toBe(1)
  })

  it('应映射"在看"为 3（Bangumi API: 3=在看）', () => {
    expect(mapWatchStatus('在看')).toBe(3)
    expect(mapWatchStatus('在看动画')).toBe(3)
    expect(mapWatchStatus('在追')).toBe(3)
    expect(mapWatchStatus('追')).toBe(3)
    expect(mapWatchStatus('watching')).toBe(3)
  })

  it('应映射"看过"为 2（Bangumi API: 2=看过）', () => {
    expect(mapWatchStatus('看过')).toBe(2)
    expect(mapWatchStatus('看完')).toBe(2)
    expect(mapWatchStatus('已看')).toBe(2)
    expect(mapWatchStatus('completed')).toBe(2)
  })

  it('应映射"搁置"为 4', () => {
    expect(mapWatchStatus('搁置')).toBe(4)
    expect(mapWatchStatus('暂停')).toBe(4)
    expect(mapWatchStatus('on_hold')).toBe(4)
  })

  it('应映射"抛弃"为 5', () => {
    expect(mapWatchStatus('抛弃')).toBe(5)
    expect(mapWatchStatus('弃番')).toBe(5)
    expect(mapWatchStatus('drop')).toBe(5)
    expect(mapWatchStatus('dropped')).toBe(5)
  })

  it('应映射"忽略"为 0', () => {
    expect(mapWatchStatus('忽略')).toBe(0)
    expect(mapWatchStatus('ignore')).toBe(0)
    expect(mapWatchStatus('skip')).toBe(0)
  })

  it('应映射数字字符串 0-5 为对应数值', () => {
    expect(mapWatchStatus('0')).toBe(0)
    expect(mapWatchStatus('1')).toBe(1)
    expect(mapWatchStatus('2')).toBe(2)
    expect(mapWatchStatus('3')).toBe(3)
    expect(mapWatchStatus('4')).toBe(4)
    expect(mapWatchStatus('5')).toBe(5)
  })

  it('应对布尔文本"是"/"否"映射（是否看完列）', () => {
    // "是" → 2 (看过), "否" → 1 (想看)
    expect(mapWatchStatus('是')).toBe(2)
    expect(mapWatchStatus('否')).toBe(1)
    // "true"/"false" 在 WATCH_STATUS_MAP 中：true→2, false→1
    expect(mapWatchStatus('true')).toBe(2)
    expect(mapWatchStatus('false')).toBe(1)
  })

  it('应对空输入返回 1（默认想看）', () => {
    expect(mapWatchStatus('')).toBe(1)
  })

  it('应对无法识别的状态返回 0 并记录警告日志', () => {
    expect(mapWatchStatus('未知状态')).toBe(0)
    expect(mapWatchStatus('xyz')).toBe(0)
    expect(bgmLog).toHaveBeenCalled()
  })

  it('应对超出 0-5 且不包含映射键的数字字符串返回 0', () => {
    expect(mapWatchStatus('6')).toBe(0)
    expect(mapWatchStatus('99')).toBe(0)
  })

  it('应反映模糊匹配对含数字子串的副作用（源码既有行为）', () => {
    // 注意：源码模糊匹配会检测 normalized 是否"包含"映射键。
    // '100' 包含 '1' → 命中 WATCH_STATUS_MAP['1'] = 1
    expect(mapWatchStatus('100')).toBe(1)
    // '200' 包含 '2' → 命中 WATCH_STATUS_MAP['2'] = 2
    expect(mapWatchStatus('200')).toBe(2)
  })

  it('应支持模糊匹配（包含关键词）', () => {
    // "看完动画" 包含 "看完" → 2
    expect(mapWatchStatus('看完动画')).toBe(2)
    // "想看这部" 包含 "想看" → 1
    expect(mapWatchStatus('想看这部')).toBe(1)
  })
})

// 验证 URL_PATTERNS 与 WATCH_STATUS_MAP 常量从源码导入（防止源码与测试脱节）
describe('常量导入完整性', () => {
  it('URL_PATTERNS 应包含 3 个 BGM 域名模式', () => {
    expect(URL_PATTERNS).toHaveLength(3)
    expect(URL_PATTERNS.some((p) => p.test('https://bgm.tv/subject/1'))).toBe(true)
    expect(URL_PATTERNS.some((p) => p.test('https://bangumi.tv/subject/1'))).toBe(true)
    expect(URL_PATTERNS.some((p) => p.test('https://chii.in/subject/1'))).toBe(true)
  })

  it('WATCH_STATUS_MAP 应包含主要状态映射', () => {
    expect(WATCH_STATUS_MAP['想看']).toBe(1)
    expect(WATCH_STATUS_MAP['看过']).toBe(2)
    expect(WATCH_STATUS_MAP['在看']).toBe(3)
    expect(WATCH_STATUS_MAP['搁置']).toBe(4)
    expect(WATCH_STATUS_MAP['抛弃']).toBe(5)
    expect(WATCH_STATUS_MAP['忽略']).toBe(0)
  })

  it('LOG_LEVELS.WARN 应为 2', () => {
    expect(LOG_LEVELS.WARN).toBe(2)
  })
})
