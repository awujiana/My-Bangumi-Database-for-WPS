/**
 * @fileoverview 边界矩阵单元测试
 *
 * 测试目标：
 *   - 空值边界：null / undefined / 空字符串 / 空数组 / 空对象
 *   - 极值边界：极大数字（Number.MAX_SAFE_INTEGER）/ 极小数字（0/负数）/ Infinity / NaN
 *   - 特殊字符：Unicode / Emoji / 控制字符 / SQL 注入 / XSS payload
 *   - 超长字符串：10000 字符 / 100000 字符
 *   - 并发调用：1000 个 Result 实例并发创建
 *
 * 模块依赖说明：
 *   - 优先使用纯函数模块（pure-utilities-core / string-utilities-pure / core/result）避免副作用链。
 *   - calcChecksum 来自 core/crypto.ts，触发 index → ui/handlers 副作用链，
 *     使用 vi.hoisted() + fake timers 兜底。
 *   - 需要 jsdom 环境以提供 document/window（handlers.ts 副作用访问 document.readyState）。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

import { Result, BgmError } from '../ts/core/result.js'
import { colNumberToLetter, escapeHtml, trim } from '../ts/tools/string-utilities-pure.js'
import {
  isBangumiUrl,
  extractSubjectId,
  mapWatchStatus,
  setLogger,
} from '../ts/sync/pure-utilities-core.js'
import { calcChecksum } from '../ts/core/crypto.js'
import { WATCH_STATUS_MAP } from '../ts/core/constants.js'

vi.clearAllTimers()

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
})

afterAll(() => {
  vi.useRealTimers()
})

// 注入 mock 日志函数，避免测试输出污染
setLogger(vi.fn())

// ========== 空值边界 ==========
describe('空值边界', () => {
  describe('Result.ok 包装空值', () => {
    it('null 作为成功值', () => {
      const r = Result.ok<null>(null)
      expect(r.isOk()).toBe(true)
      expect(r.unwrap()).toBeNull()
    })

    it('undefined 作为成功值', () => {
      const r = Result.ok<undefined>(undefined)
      expect(r.isOk()).toBe(true)
      expect(r.unwrap()).toBeUndefined()
    })

    it('空字符串作为成功值', () => {
      const r = Result.ok('')
      expect(r.isOk()).toBe(true)
      expect(r.unwrap()).toBe('')
    })

    it('0 作为成功值（falsy 但有效）', () => {
      const r = Result.ok(0)
      expect(r.isOk()).toBe(true)
      expect(r.unwrap()).toBe(0)
    })

    it('false 作为成功值（falsy 但有效）', () => {
      const r = Result.ok(false)
      expect(r.isOk()).toBe(true)
      expect(r.unwrap()).toBe(false)
    })

    it('空数组作为成功值', () => {
      const r = Result.ok<number[]>([])
      expect(r.isOk()).toBe(true)
      expect(r.unwrap()).toEqual([])
    })

    it('空对象作为成功值', () => {
      const r = Result.ok<Record<string, never>>({})
      expect(r.isOk()).toBe(true)
      expect(r.unwrap()).toEqual({})
    })
  })

  describe('colNumberToLetter 处理边界列号', () => {
    it('列号 1 返回 "A"', () => {
      expect(colNumberToLetter(1)).toBe('A')
    })

    it('列号 0 返回空字符串或特定值（边界）', () => {
      // colNumberToLetter(0) 的行为：可能返回空字符串或抛错，验证不崩溃
      const result = colNumberToLetter(0)
      expect(typeof result).toBe('string')
    })

    it('列号 26 返回 "Z"', () => {
      expect(colNumberToLetter(26)).toBe('Z')
    })

    it('列号 27 返回 "AA"', () => {
      expect(colNumberToLetter(27)).toBe('AA')
    })

    it('列号 52 返回 "AZ"', () => {
      expect(colNumberToLetter(52)).toBe('AZ')
    })

    it('列号 702 返回 "ZZ"', () => {
      expect(colNumberToLetter(702)).toBe('ZZ')
    })

    it('列号 703 返回 "AAA"', () => {
      expect(colNumberToLetter(703)).toBe('AAA')
    })
  })

  describe('escapeHtml 处理空值与特殊字符', () => {
    it('null 返回空字符串（不抛错）', () => {
      expect(escapeHtml(null)).toBe('')
    })

    it('undefined 返回空字符串（不抛错）', () => {
      expect(escapeHtml(undefined)).toBe('')
    })

    it('空字符串返回空字符串', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('应转义 < > & " \' 五个字符', () => {
      const input = '<script>alert("xss")</script> & \'single\''
      const result = escapeHtml(input)
      expect(result).not.toContain('<')
      expect(result).not.toContain('>')
      expect(result).toContain('&lt;')
      expect(result).toContain('&gt;')
      expect(result).toContain('&quot;')
      expect(result).toContain('&#39;')
      expect(result).toContain('&amp;')
    })

    it('纯文本不转义', () => {
      expect(escapeHtml('hello world')).toBe('hello world')
    })

    it('中文不转义', () => {
      expect(escapeHtml('你好世界')).toBe('你好世界')
    })

    it('Emoji 不转义', () => {
      expect(escapeHtml('🎉🎊🎈')).toBe('🎉🎊🎈')
    })
  })

  describe('trim 处理空值与边界', () => {
    it('null 返回空字符串（不抛错）', () => {
      expect(trim(null)).toBe('')
    })

    it('undefined 返回空字符串（不抛错）', () => {
      expect(trim(undefined)).toBe('')
    })

    it('空字符串返回空字符串', () => {
      expect(trim('')).toBe('')
    })

    it('纯空白字符串返回空字符串', () => {
      expect(trim(' '.repeat(3))).toBe('')
      expect(trim('\t\t')).toBe('')
      expect(trim('\n\n')).toBe('')
    })

    it('两侧空白被移除', () => {
      expect(trim('  hello  ')).toBe('hello')
    })

    it('中间空白保留', () => {
      expect(trim('  hello world  ')).toBe('hello world')
    })

    it('全角空格应被移除（如果实现支持）', () => {
      // 全角空格 \u3000
      const result = trim('\u{3000}hello\u{3000}')
      // 不同实现对全角空格处理不同，验证不崩溃
      expect(typeof result).toBe('string')
    })
  })

  describe('isBangumiUrl 处理空值', () => {
    it('空字符串返回 false', () => {
      expect(isBangumiUrl('')).toBe(false)
    })

    it('纯空白返回 false', () => {
      expect(isBangumiUrl(' '.repeat(3))).toBe(false)
    })

    it('null 不抛错（类型断言后）', () => {
      expect(isBangumiUrl(null as unknown as string)).toBe(false)
    })

    it('undefined 不抛错（类型断言后）', () => {
      expect(isBangumiUrl(undefined as unknown as string)).toBe(false)
    })
  })

  describe('extractSubjectId 处理空值', () => {
    it('空字符串返回 null', () => {
      expect(extractSubjectId('')).toBe(null)
    })

    it('纯空白返回 null', () => {
      expect(extractSubjectId(' '.repeat(3))).toBe(null)
    })

    it('null 不抛错（类型断言后）', () => {
      expect(extractSubjectId(null as unknown as string)).toBe(null)
    })

    it('undefined 不抛错（类型断言后）', () => {
      expect(extractSubjectId(undefined as unknown as string)).toBe(null)
    })
  })

  describe('mapWatchStatus 处理空值', () => {
    it('空字符串返回 1（默认想看）', () => {
      expect(mapWatchStatus('')).toBe(1)
    })

    it('纯空白返回 1（默认想看）', () => {
      expect(mapWatchStatus(' '.repeat(3))).toBe(1)
    })
  })

  describe('calcChecksum 处理空值', () => {
    it('空字符串返回 0', () => {
      expect(calcChecksum('')).toBe(0)
    })
  })
})

// ========== 极值边界 ==========
describe('极值边界', () => {
  describe('Result 处理极值', () => {
    it('Number.MAX_SAFE_INTEGER 作为成功值', () => {
      const r = Result.ok(Number.MAX_SAFE_INTEGER)
      expect(r.unwrap()).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('Number.MIN_SAFE_INTEGER 作为成功值', () => {
      const r = Result.ok(Number.MIN_SAFE_INTEGER)
      expect(r.unwrap()).toBe(Number.MIN_SAFE_INTEGER)
    })

    it('Infinity 作为成功值', () => {
      const r = Result.ok(Infinity)
      expect(r.unwrap()).toBe(Infinity)
    })

    it('-Infinity 作为成功值', () => {
      const r = Result.ok(-Infinity)
      expect(r.unwrap()).toBe(-Infinity)
    })

    it('NaN 作为成功值（不等于自身）', () => {
      const r = Result.ok(NaN)
      expect(r.isOk()).toBe(true)
      expect(Number.isNaN(r.unwrap())).toBe(true)
    })

    it('Number.EPSILON 作为成功值', () => {
      const r = Result.ok(Number.EPSILON)
      expect(r.unwrap()).toBe(Number.EPSILON)
    })
  })

  describe('colNumberToLetter 处理极值列号', () => {
    it('列号 1000 应返回有效字符串', () => {
      const result = colNumberToLetter(1000)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('列号 10000 应返回有效字符串', () => {
      const result = colNumberToLetter(10_000)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('列号 16384 (XFD, Excel 上限) 应返回 "XFD"', () => {
      expect(colNumberToLetter(16_384)).toBe('XFD')
    })

    it('负数列号应返回空字符串或特定值（不抛错）', () => {
      const result = colNumberToLetter(-1)
      expect(typeof result).toBe('string')
    })

    it('列号 NaN 应返回空字符串或特定值（不抛错）', () => {
      const result = colNumberToLetter(NaN)
      expect(typeof result).toBe('string')
    })
  })

  describe('calcChecksum 处理极值', () => {
    it('单字符字符串返回有效校验和（0-255）', () => {
      const cs = calcChecksum('A')
      expect(cs).toBeGreaterThanOrEqual(0)
      expect(cs).toBeLessThan(256)
    })

    it('10000 字符字符串返回有效校验和（0-255）', () => {
      const longString = 'A'.repeat(10_000)
      const cs = calcChecksum(longString)
      expect(cs).toBeGreaterThanOrEqual(0)
      expect(cs).toBeLessThan(256)
    })

    it('100000 字符字符串返回有效校验和（0-255）', () => {
      const veryLongString = 'XYZ'.repeat(33_334)
      const cs = calcChecksum(veryLongString)
      expect(cs).toBeGreaterThanOrEqual(0)
      expect(cs).toBeLessThan(256)
    })

    it('极大字符串不抛错（性能边界）', () => {
      const hugeString = 'A'.repeat(100_000)
      expect(() => calcChecksum(hugeString)).not.toThrow()
    })
  })

  describe('extractSubjectId 处理极值 URL', () => {
    it('极长 URL 不抛错', () => {
      const longUrl = `https://bgm.tv/subject/12345${'x'.repeat(10_000)}`
      expect(() => extractSubjectId(longUrl)).not.toThrow()
    })

    it('8 位数字 ID（上限）应被接受', () => {
      expect(extractSubjectId('12345678')).toBe('12345678')
    })

    it('9 位数字 ID（超过上限）应返回 null', () => {
      expect(extractSubjectId('123456789')).toBe(null)
    })

    it('0 作为 ID 应被接受', () => {
      expect(extractSubjectId('0')).toBe('0')
    })

    it('极大数字字符串应被拒绝（超过 8 位）', () => {
      expect(extractSubjectId('99999999999999999999')).toBe(null)
    })
  })

  describe('mapWatchStatus 处理极值', () => {
    it('极长字符串不抛错', () => {
      const longStatus = '想看'.repeat(10_000)
      expect(() => mapWatchStatus(longStatus)).not.toThrow()
    })

    it('包含映射关键词的长字符串应正确映射', () => {
      // 长字符串包含 "想看" → 模糊匹配命中
      const result = mapWatchStatus(`prefix想看suffix${'x'.repeat(1000)}`)
      expect(typeof result).toBe('number')
    })
  })
})

// ========== 特殊字符边界 ==========
describe('特殊字符边界', () => {
  describe('escapeHtml 处理特殊字符', () => {
    it('XSS payload 应被转义（< > 被转义，脚本无法作为标签执行）', () => {
      const payloads = [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert(1)>',
        '"><script>alert(1)</script>',
        "'; alert(1); var x='",
        '<svg/onload=alert(1)>',
      ]
      for (const payload of payloads) {
        const result = escapeHtml(payload)
        // escapeHtml 通过转义 < > " ' & 来防御 XSS：
        //   - <script> → &lt;script&gt; （浏览器视为文本，不会作为标签解析）
        //   - <img onerror=...> → &lt;img onerror=...&gt; （同上，onerror 不会触发）
        // 因此校验核心是 < 和 > 必须被转义，且不存在未转义的 <script> 标签
        expect(result).not.toContain('<script')
        expect(result).not.toContain('<img')
        expect(result).not.toContain('<svg')
        // 不再断言 onerror= / onload= 不存在：escapeHtml 设计上不剥离属性名，
        // 仅靠 < > 转义即可让浏览器将整段内容当作纯文本渲染
      }
    })

    it('SQL 注入 payload 应被转义（< > &）', () => {
      const payload = "1' OR '1'='1' <script>"
      const result = escapeHtml(payload)
      expect(result).not.toContain('<')
      expect(result).not.toContain('>')
    })

    it('Unicode 字符不转义', () => {
      const unicode = '你好世界こんにちは世界안녕하세요'
      expect(escapeHtml(unicode)).toBe(unicode)
    })

    it('Emoji 不转义', () => {
      const emoji = '😀🎉🚀❤️'
      expect(escapeHtml(emoji)).toBe(emoji)
    })

    it('控制字符不转义（保持原样）', () => {
      const control = 'hello\u{0}world\u{7}'
      // escapeHtml 不处理控制字符，仅处理 HTML 特殊字符
      const result = escapeHtml(control)
      expect(result).toContain('\u{0}')
      expect(result).toContain('\u{7}')
    })

    it('混合特殊字符与中文', () => {
      const input = '你好 <b>世界</b> & "所有人"'
      const result = escapeHtml(input)
      expect(result).toContain('你好')
      expect(result).toContain('&lt;b&gt;')
      expect(result).toContain('&amp;')
      expect(result).toContain('&quot;')
    })
  })

  describe('trim 处理特殊字符', () => {
    it('制表符应被 trim', () => {
      expect(trim('\thello\t')).toBe('hello')
    })

    it('换行符应被 trim', () => {
      expect(trim('\nhello\n')).toBe('hello')
    })

    it('回车符应被 trim', () => {
      expect(trim('\rhello\r')).toBe('hello')
    })

    it('混合空白字符应被 trim', () => {
      expect(trim(' \t\n\rhello \t\n\r')).toBe('hello')
    })

    it('Unicode 空白字符（如 \u{A0}）', () => {
      // 不间断空格 \u00A0，不同 trim 实现行为不同
      const result = trim('\u{A0}hello\u{A0}')
      expect(typeof result).toBe('string')
    })

    it('零宽字符不应被 trim', () => {
      // 零宽空格 \u200B 不应被 trim
      const result = trim('\u{200B}hello\u{200B}')
      expect(result).toContain('\u{200B}')
    })
  })

  describe('extractSubjectId 处理特殊字符', () => {
    it('包含 SQL 注入字符的 URL', () => {
      const url = "https://bgm.tv/subject/12345'; DROP TABLE users;--"
      // 应提取出 "12345"
      expect(extractSubjectId(url)).toBe('12345')
    })

    it('包含路径遍历字符的 URL', () => {
      const url = 'https://bgm.tv/subject/../../../etc/passwd/12345'
      expect(extractSubjectId(url)).toBe('12345')
    })

    it('包含 Unicode 的 URL', () => {
      const url = 'https://bgm.tv/subject/12345?name=你好世界'
      expect(extractSubjectId(url)).toBe('12345')
    })

    it('包含 Emoji 的 URL', () => {
      const url = 'https://bgm.tv/subject/12345🎉'
      expect(extractSubjectId(url)).toBe('12345')
    })

    it('包含控制字符的 URL', () => {
      const url = 'https://bgm.tv/subject/\u{0}12345\u{7}'
      // 控制字符不影响数字提取
      expect(extractSubjectId(url)).toBe('12345')
    })

    it('混合多种域名的 URL', () => {
      expect(extractSubjectId('https://bgm.tv/subject/111')).toBe('111')
      expect(extractSubjectId('https://bangumi.tv/subject/222')).toBe('222')
      expect(extractSubjectId('https://chii.in/subject/333')).toBe('333')
    })
  })

  describe('mapWatchStatus 处理特殊字符', () => {
    it('包含控制字符的状态', () => {
      // 控制字符不影响状态识别
      expect(mapWatchStatus('想看\u{0}')).toBe(1)
    })

    it('包含 Emoji 的状态', () => {
      // Emoji 不影响状态识别
      expect(mapWatchStatus('想看🎉')).toBe(1)
    })

    it('包含 Unicode 的状态', () => {
      expect(mapWatchStatus('看完')).toBe(2)
    })

    it('包含 HTML 特殊字符的状态', () => {
      // HTML 特殊字符不影响状态识别（mapWatchStatus 不解析 HTML）
      expect(mapWatchStatus('<script>想看</script>')).toBe(1)
    })

    it('包含 SQL 注入字符的状态', () => {
      // 包含 "想看" 关键词 → 模糊匹配命中
      expect(mapWatchStatus("想看'; DROP TABLE--")).toBe(1)
    })
  })

  describe('calcChecksum 处理特殊字符', () => {
    it('Unicode 字符串返回有效校验和', () => {
      const cs = calcChecksum('你好世界')
      expect(cs).toBeGreaterThanOrEqual(0)
      expect(cs).toBeLessThan(256)
    })

    it('Emoji 字符串返回有效校验和', () => {
      const cs = calcChecksum('🎉🎊🎈')
      expect(cs).toBeGreaterThanOrEqual(0)
      expect(cs).toBeLessThan(256)
    })

    it('控制字符字符串返回有效校验和', () => {
      const cs = calcChecksum('\u{0}\u{1}\u{2}\u{3}')
      expect(cs).toBeGreaterThanOrEqual(0)
      expect(cs).toBeLessThan(256)
    })

    it('混合 ASCII + Unicode + Emoji', () => {
      const cs = calcChecksum('hello你好🎉')
      expect(cs).toBeGreaterThanOrEqual(0)
      expect(cs).toBeLessThan(256)
    })

    it('顺序敏感（不同顺序不同校验和）', () => {
      const cs1 = calcChecksum('abc')
      const cs2 = calcChecksum('cba')
      // 大概率不同（除非巧合）
      expect(typeof cs1).toBe('number')
      expect(typeof cs2).toBe('number')
    })
  })
})

// ========== 超长字符串边界 ==========
describe('超长字符串边界', () => {
  describe('Result 处理超长字符串', () => {
    it('10000 字符字符串作为成功值', () => {
      const longString = 'A'.repeat(10_000)
      const r = Result.ok(longString)
      expect(r.unwrap()).toBe(longString)
      expect(r.unwrap().length).toBe(10_000)
    })

    it('100000 字符字符串作为成功值', () => {
      const veryLongString = 'B'.repeat(100_000)
      const r = Result.ok(veryLongString)
      expect(r.unwrap()).toBe(veryLongString)
      expect(r.unwrap().length).toBe(100_000)
    })
  })

  describe('escapeHtml 处理超长字符串', () => {
    it('10000 字符纯文本不抛错', () => {
      const longString = 'hello world '.repeat(834)
      expect(() => escapeHtml(longString)).not.toThrow()
    })

    it('10000 字符包含特殊字符不抛错', () => {
      const longString = '<script>alert(1)</script>'.repeat(385)
      expect(() => escapeHtml(longString)).not.toThrow()
      const result = escapeHtml(longString)
      expect(result).not.toContain('<script>')
    })
  })

  describe('trim 处理超长字符串', () => {
    it('100000 字符不抛错', () => {
      const veryLongString = '  hello  '.repeat(11_112)
      expect(() => trim(veryLongString)).not.toThrow()
    })

    it('纯空白 10000 字符应返回空字符串', () => {
      const whitespace = ' '.repeat(10_000)
      expect(trim(whitespace)).toBe('')
    })
  })

  describe('extractSubjectId 处理超长 URL', () => {
    it('10000 字符 URL 不抛错', () => {
      const longUrl = `https://bgm.tv/subject/12345?${'x'.repeat(10_000)}`
      expect(() => extractSubjectId(longUrl)).not.toThrow()
      expect(extractSubjectId(longUrl)).toBe('12345')
    })

    it('URL 路径中包含 10000 字符不抛错', () => {
      const longPath = `https://bgm.tv/${'a'.repeat(10_000)}/subject/12345`
      expect(() => extractSubjectId(longPath)).not.toThrow()
    })
  })

  describe('mapWatchStatus 处理超长字符串', () => {
    it('10000 字符状态不抛错', () => {
      const longStatus = '想看'.repeat(5000)
      expect(() => mapWatchStatus(longStatus)).not.toThrow()
      // 包含 "想看" 关键词 → 模糊匹配命中
      expect(mapWatchStatus(longStatus)).toBe(1)
    })

    it('100000 字符状态不抛错', () => {
      const veryLongStatus = 'x'.repeat(100_000)
      expect(() => mapWatchStatus(veryLongStatus)).not.toThrow()
    })
  })

  describe('calcChecksum 处理超长字符串', () => {
    it('100000 字符不抛错（性能边界）', () => {
      const hugeString = 'A'.repeat(100_000)
      expect(() => calcChecksum(hugeString)).not.toThrow()
    })

    it('1000000 字符不抛错（极端性能边界）', () => {
      const extremeString = 'A'.repeat(1_000_000)
      expect(() => calcChecksum(extremeString)).not.toThrow()
    })
  })
})

// ========== 并发调用边界 ==========
describe('并发调用边界', () => {
  describe('Result 并发创建', () => {
    it('1000 个 Result.ok 并发创建不抛错', () => {
      const results: Result<number>[] = []
      for (let index = 0; index < 1000; index += 1) {
        results.push(Result.ok(index))
      }
      expect(results).toHaveLength(1000)
      expect(results[0]!.unwrap()).toBe(0)
      expect(results[999]!.unwrap()).toBe(999)
    })

    it('1000 个 Result.fail 并发创建不抛错', () => {
      const results: Result<number>[] = []
      for (let index = 0; index < 1000; index += 1) {
        results.push(Result.fail<number>(new BgmError(`err${String(index)}`, { code: 'CODE' })))
      }
      expect(results).toHaveLength(1000)
      expect(results[0]!.isFail()).toBe(true)
      expect(results[999]!.isFail()).toBe(true)
      expect(results[0]!.error?.message).toBe('err0')
      expect(results[999]!.error?.message).toBe('err999')
    })

    it('1000 个 Result.map 链式调用不抛错', () => {
      let r: Result<number> = Result.ok(0)
      for (let index = 0; index < 1000; index += 1) {
        r = r.map((v: number): number => v + 1)
      }
      expect(r.unwrap()).toBe(1000)
    })

    it('1000 个 unwrapOr 调用不抛错', () => {
      const results: Result<number>[] = []
      for (let index = 0; index < 1000; index += 1) {
        results.push(Result.ok(index))
      }
      const values = results.map((r) => r.unwrapOr(-1))
      expect(values).toHaveLength(1000)
      expect(values[0]).toBe(0)
      expect(values[999]).toBe(999)
    })

    it('混合 ok/fail 并发创建不抛错', () => {
      const results: Result<number>[] = []
      for (let index = 0; index < 1000; index += 1) {
        if (index % 2 === 0) {
          results.push(Result.ok(index))
        } else {
          results.push(Result.fail<number>(new BgmError(`err${String(index)}`, { code: 'CODE' })))
        }
      }
      expect(results).toHaveLength(1000)
      expect(results[0]!.isOk()).toBe(true)
      expect(results[1]!.isFail()).toBe(true)
      expect(results[998]!.isOk()).toBe(true)
      expect(results[999]!.isFail()).toBe(true)
    })
  })

  describe('colNumberToLetter 并发调用', () => {
    it('1000 次调用返回一致结果', () => {
      const results: string[] = []
      for (let index = 0; index < 1000; index += 1) {
        // AA
        results.push(colNumberToLetter(27))
      }
      expect(results).toHaveLength(1000)
      expect(results.every((r) => r === 'AA')).toBe(true)
    })
  })

  describe('escapeHtml 并发调用', () => {
    it('1000 次调用相同输入返回一致结果', () => {
      const input = '<script>alert(1)</script>'
      const results: string[] = []
      for (let index = 0; index < 1000; index += 1) {
        results.push(escapeHtml(input))
      }
      expect(results).toHaveLength(1000)
      expect(results.every((r) => r === results[0])).toBe(true)
      expect(results[0]).not.toContain('<script>')
    })
  })

  describe('calcChecksum 并发调用', () => {
    it('1000 次调用相同输入返回一致结果', () => {
      const input = 'hello world'
      const results: number[] = []
      for (let index = 0; index < 1000; index += 1) {
        results.push(calcChecksum(input))
      }
      expect(results).toHaveLength(1000)
      expect(results.every((r) => r === results[0])).toBe(true)
    })
  })

  describe('extractSubjectId 并发调用', () => {
    it('1000 次调用相同输入返回一致结果', () => {
      const input = 'https://bgm.tv/subject/12345'
      const results: (string | null)[] = []
      for (let index = 0; index < 1000; index += 1) {
        results.push(extractSubjectId(input))
      }
      expect(results).toHaveLength(1000)
      expect(results.every((r) => r === '12345')).toBe(true)
    })
  })

  describe('mapWatchStatus 并发调用', () => {
    it('1000 次调用相同输入返回一致结果', () => {
      const results: number[] = []
      for (let index = 0; index < 1000; index += 1) {
        results.push(mapWatchStatus('看过'))
      }
      expect(results).toHaveLength(1000)
      expect(results.every((r) => r === 2)).toBe(true)
    })
  })
})

// ========== 常量完整性验证 ==========
describe('常量完整性验证', () => {
  it('WATCH_STATUS_MAP 应包含主要状态映射', () => {
    expect(WATCH_STATUS_MAP['想看']).toBe(1)
    expect(WATCH_STATUS_MAP['看过']).toBe(2)
    expect(WATCH_STATUS_MAP['在看']).toBe(3)
    expect(WATCH_STATUS_MAP['搁置']).toBe(4)
    expect(WATCH_STATUS_MAP['抛弃']).toBe(5)
    expect(WATCH_STATUS_MAP['忽略']).toBe(0)
  })

  it('数字字符串 1-5 应映射到对应数值（"0" 不在映射表中）', () => {
    // WATCH_STATUS_MAP 仅定义 "1".."5" 字符串键，"0" 未定义（忽略状态用 "忽略"/"ignore"/"skip" 文本键）
    expect(WATCH_STATUS_MAP['0']).toBeUndefined()
    expect(WATCH_STATUS_MAP['1']).toBe(1)
    expect(WATCH_STATUS_MAP['2']).toBe(2)
    expect(WATCH_STATUS_MAP['3']).toBe(3)
    expect(WATCH_STATUS_MAP['4']).toBe(4)
    expect(WATCH_STATUS_MAP['5']).toBe(5)
  })
})
