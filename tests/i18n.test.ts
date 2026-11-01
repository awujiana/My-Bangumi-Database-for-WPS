// @vitest-environment jsdom
/**
 * @fileoverview `ts/i18n/**` 行为单测
 *
 * 覆盖：占位符替换、回退链、加载失败与脏包拒绝、`data-i18n*` 替换、
 * 系统语言识别、切语言持久化。
 *
 * 语言包与源码的一致性（key 是否存在、占位符是否相等、`ribbon.xml` 的 label
 * 是否对得上）**不在这里**：跨文件一致性归 `scripts/check-i18n-consistency.mjs`
 * ——本目录测试不允许 `import node:fs`（分工说明见 tests/ribbon.test.ts 文件头）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: vi.fn(),
}))

// 配置层整体打桩：i18n 只用到 CONFIG_KEYS.LANGUAGE 与读写两个函数
vi.mock('../ts/tools/config.js', () => {
  const store = new Map<string, string>()
  return {
    CONFIG_KEYS: { LANGUAGE: 'bgm_language' },
    getConfig: (key: string, defaultValue = ''): string => store.get(key) ?? defaultValue,
    setConfig: (key: string, value: string): boolean => {
      store.set(key, value)
      return true
    },
  }
})

vi.mock('../ts/tools/config-poll.js', () => ({
  subscribeConfigPoll: vi.fn(() => vi.fn()),
}))

import { bgmLog } from '../ts/tools/util/index.js'
import { CONFIG_KEYS, getConfig, setConfig } from '../ts/tools/config.js'

import { applyI18n, canApplyI18n } from '../ts/i18n/dom.js'
import { detectSystemLocale, getLanguage, initializeI18n, setLocale } from '../ts/i18n/index.js'
import {
  LOCALE_SCHEMA_VERSION,
  loadLocale,
  localeUrl,
  resetLocaleStoreForTest,
  getActiveLocale,
  primeLocaleForTest,
  setLocaleImporterForTest,
  t,
  useLocale,
} from '../ts/i18n/locale-store.js'
import type { LocaleBundle } from '../ts/i18n/locale-store.js'
import {
  LOCALE_CODES,
  computeCoverage,
  extractPlaceholders,
  interpolate,
  isLocaleCode,
} from '../ts/i18n/translate.js'

/** 造一个最小语言包 */
function makeBundle(code: string, messages: Record<string, string>): LocaleBundle {
  return {
    schemaVersion: LOCALE_SCHEMA_VERSION,
    code,
    name: code,
    nativeName: code,
    version: '0.0.1',
    updatedAt: '2026-11-01',
    messages,
  }
}

/** 造一个「成功导入」的替身：等价于 `export default {…}` 的模块 */
function stubModule(payload: unknown) {
  const importer = vi.fn(async () => ({ default: payload }))
  setLocaleImporterForTest(importer)
  return importer
}

beforeEach(() => {
  resetLocaleStoreForTest()
  // 语言包加载器复位成真实的 import()：用例里替换掉的替身不能漏到下一个用例
  setLocaleImporterForTest(null)
  // 语言配置写回空串（= 未选择，回落到系统语言）；config 的 store 是模块级 Map，会跨用例残留
  setConfig(CONFIG_KEYS.LANGUAGE, '')
  vi.mocked(bgmLog).mockClear()
})

describe('interpolate：占位符替换', () => {
  it('替换已知变量', () => {
    expect(interpolate('已关闭 {count} 个页面', { count: 3 })).toBe('已关闭 3 个页面')
  })

  it('数字变量按字符串插入', () => {
    expect(interpolate('{percent}%', { percent: 82 })).toBe('82%')
  })

  it('同名占位符出现多次全部替换', () => {
    expect(interpolate('{a}-{a}', { a: 'x' })).toBe('x-x')
  })

  it('**未知占位符原样保留**（漏传参数要看得见，不能悄悄变空串）', () => {
    expect(interpolate('已关闭 {count} 个页面')).toBe('已关闭 {count} 个页面')
    expect(interpolate('已关闭 {count} 个页面', { other: 1 })).toBe('已关闭 {count} 个页面')
  })

  it('不传 vars 时原样返回', () => {
    expect(interpolate('纯文本 {x}')).toBe('纯文本 {x}')
  })
})

describe('extractPlaceholders：占位符集合', () => {
  it('去重并排序', () => {
    expect(extractPlaceholders('{b} {a} {b}')).toEqual(['a', 'b'])
  })

  it('没有占位符时返回空数组', () => {
    expect(extractPlaceholders('纯文本')).toEqual([])
  })
})

describe('computeCoverage：覆盖率', () => {
  const source = { a: '1', b: '2', c: '3', d: '4' }

  it('源语言自身 100%', () => {
    expect(computeCoverage(source, source)).toEqual({ translated: 4, total: 4, percent: 100 })
  })

  it('部分翻译按有非空译文的 key 计数（向下取整）', () => {
    expect(computeCoverage(source, { a: '1', b: '', c: '3' })).toEqual({
      translated: 2,
      total: 4,
      percent: 50,
    })
  })

  it('目标语言没加载 → 0%', () => {
    expect(computeCoverage(source, undefined)).toEqual({ translated: 0, total: 4, percent: 0 })
  })

  it('源语言为空 → 100%（没有可翻的，不算 0%）', () => {
    expect(computeCoverage({}, undefined)).toEqual({ translated: 0, total: 0, percent: 100 })
  })
})

describe('t：回退链', () => {
  it('当前语言命中直接用', () => {
    primeLocaleForTest(makeBundle('zh-CN', { 'ribbon.tab': 'Bangumi同步' }))
    primeLocaleForTest(makeBundle('en', { 'ribbon.tab': 'Bangumi' }))
    useLocale('en')
    expect(t('ribbon.tab')).toBe('Bangumi')
  })

  it('当前语言缺 key → 回退简体', () => {
    primeLocaleForTest(makeBundle('zh-CN', { a: '甲', b: '乙' }))
    primeLocaleForTest(makeBundle('en', { a: 'A' }))
    useLocale('en')
    expect(t('a')).toBe('A')
    expect(t('b')).toBe('乙')
  })

  it('简体也没有 → 返回 key 本身（界面上能一眼看出是哪个 key 漏了）', () => {
    primeLocaleForTest(makeBundle('zh-CN', {}))
    useLocale('zh-CN')
    expect(t('nope.missing')).toBe('nope.missing')
  })

  it('缺失 key 只告警一次（每帧都 warn 会把日志刷爆）', () => {
    primeLocaleForTest(makeBundle('zh-CN', {}))
    useLocale('zh-CN')
    t('nope.missing')
    t('nope.missing')
    t('nope.missing')
    expect(vi.mocked(bgmLog)).toHaveBeenCalledTimes(1)
  })

  it('回退时也做占位符替换', () => {
    primeLocaleForTest(makeBundle('zh-CN', { k: '共 {n} 条' }))
    primeLocaleForTest(makeBundle('en', {}))
    useLocale('en')
    expect(t('k', { n: 7 })).toBe('共 7 条')
  })
})

describe('loadLocale：加载与校验', () => {
  it('正常解析：非字符串 / 空串的 message 被丢弃', async () => {
    stubModule({
      schemaVersion: LOCALE_SCHEMA_VERSION,
      name: 'English',
      nativeName: 'English',
      version: '1.2.3',
      updatedAt: '2026-11-01',
      messages: { a: 'A', b: '', c: 42 },
    })

    const bundle = await loadLocale('en')

    expect(bundle?.messages).toEqual({ a: 'A' })
    expect(bundle?.nativeName).toBe('English')
    expect(bundle?.version).toBe('1.2.3')
  })

  it('**导入失败 → null**（文件缺失 / 语法错误都不能抛给调用方）', async () => {
    setLocaleImporterForTest(
      vi.fn(async () => {
        throw new Error('Failed to fetch dynamically imported module')
      }),
    )
    expect(await loadLocale('en')).toBeNull()
  })

  it('模块没有 default 导出 → 拒绝（`export const messages` 这种写法不算语言包）', async () => {
    setLocaleImporterForTest(vi.fn(async () => ({})))
    expect(await loadLocale('en')).toBeNull()
  })

  it('schemaVersion 不匹配 → 拒绝（宁可回退，也不按猜的格式用）', async () => {
    stubModule({ schemaVersion: 99, messages: { a: 'A' } })
    expect(await loadLocale('en')).toBeNull()
  })

  it('没有 messages 字段 → 拒绝', async () => {
    stubModule({ schemaVersion: LOCALE_SCHEMA_VERSION })
    expect(await loadLocale('en')).toBeNull()
  })

  it('并发加载同一语言只导入一次', async () => {
    const importer = stubModule({ schemaVersion: LOCALE_SCHEMA_VERSION, messages: { a: 'A' } })

    await Promise.all([loadLocale('en'), loadLocale('en'), loadLocale('en')])

    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('localeUrl 以 /locales/<code>/locale.js 结尾（.js 不是 .json：file:// 下 fetch 被拦）', () => {
    expect(localeUrl('en')).toMatch(/\/locales\/en\/locale\.js$/u)
    expect(localeUrl('zh-TW')).toMatch(/\/locales\/zh-TW\/locale\.js$/u)
  })
})

describe('isLocaleCode / detectSystemLocale', () => {
  it('只认三个受支持的语言代码', () => {
    expect(LOCALE_CODES.map((code) => isLocaleCode(code))).toEqual([true, true, true])
    expect(isLocaleCode('ja')).toBe(false)
    expect(isLocaleCode('')).toBe(false)
  })

  it.each([
    [['zh-TW'], 'zh-TW'],
    [['zh-Hant-TW'], 'zh-TW'],
    [['zh-HK'], 'zh-TW'],
    [['zh-CN'], 'zh-CN'],
    [['zh'], 'zh-CN'],
    [['en-US'], 'en'],
    [['ja-JP'], 'zh-CN'],
    [[], 'zh-CN'],
  ])('系统语言 %j → %s', (languages, expected) => {
    vi.stubGlobal('navigator', { languages, language: languages[0] ?? '' })
    expect(detectSystemLocale()).toBe(expected)
    vi.unstubAllGlobals()
  })
})

describe('applyI18n：DOM 替换', () => {
  beforeEach(() => {
    primeLocaleForTest(
      makeBundle('zh-CN', {
        'a.text': '中文文本',
        'a.placeholder': '粘贴 Token',
        'a.title': '刷新',
        'a.aria': '折叠 / 展开',
        'a.value': '确定',
        'a.alt': '用户头像',
        'a.html': '带 <code>标记</code> 的文案',
        'a.collapse': '折叠 / 展开「{title}」',
      }),
    )
    useLocale('zh-CN')
  })

  it('data-i18n 写 textContent', () => {
    document.body.innerHTML = '<h3 data-i18n="a.text">旧文案</h3>'
    applyI18n(document)
    expect(document.querySelector('h3')?.textContent).toBe('中文文本')
  })

  it('四种属性各自写对目标属性', () => {
    document.body.innerHTML = `
      <input data-i18n-placeholder="a.placeholder" placeholder="旧" />
      <button data-i18n-title="a.title" title="旧"></button>
      <div data-i18n-aria-label="a.aria" aria-label="旧"></div>
      <input type="button" data-i18n-value="a.value" value="旧" />
      <img data-i18n-alt="a.alt" alt="旧" />
    `
    applyI18n(document)
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('粘贴 Token')
    expect(document.querySelector('button')?.getAttribute('title')).toBe('刷新')
    expect(document.querySelector('div')?.getAttribute('aria-label')).toBe('折叠 / 展开')
    expect(document.querySelector('input[type=button]')?.getAttribute('value')).toBe('确定')
    expect(document.querySelector('img')?.getAttribute('alt')).toBe('用户头像')
  })

  it('data-i18n-html 写 innerHTML（保留内联标签）', () => {
    document.body.innerHTML = '<p data-i18n-html="a.html">旧</p>'
    applyI18n(document)
    const paragraph = document.querySelector('p')
    expect(paragraph?.textContent).toBe('带 标记 的文案')
    expect(paragraph?.querySelector('code')?.textContent).toBe('标记')
  })

  it('aria-label 里的 {title} 取所在标题的文本（标题已先翻成当前语言）', () => {
    document.body.innerHTML = `
      <h3>
        <span data-i18n="a.text">旧标题</span>
        <button data-i18n-aria-label="a.collapse" aria-label="旧"></button>
      </h3>
    `
    applyI18n(document)
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe(
      '折叠 / 展开「中文文本」',
    )
  })

  it('{title} 剥掉标题开头的 emoji 图标（屏幕阅读器不该念图标）', () => {
    document.body.innerHTML = `
      <h3><span>🎯 选择清理的表格</span><button data-i18n-aria-label="a.collapse"></button></h3>
    `
    applyI18n(document)
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe(
      '折叠 / 展开「选择清理的表格」',
    )
  })

  it('可以只刷一个子树（不碰文档其它地方）', () => {
    document.body.innerHTML = `
      <div id="scope"><span data-i18n="a.text">旧</span></div>
      <span id="outside" data-i18n="a.text">旧</span>
    `
    const scope = document.getElementById('scope')
    expect(scope).not.toBeNull()
    applyI18n(scope!)
    expect(document.querySelector('#scope span')?.textContent).toBe('中文文本')
    expect(document.getElementById('outside')?.textContent).toBe('旧')
  })

  it('**源语言没加载成功时一个字都不改**（否则整页会变成 key）', () => {
    resetLocaleStoreForTest()
    expect(canApplyI18n()).toBe(false)
    document.body.innerHTML = '<h3 data-i18n="a.text">HTML 里的简体原文</h3>'
    applyI18n(document)
    expect(document.querySelector('h3')?.textContent).toBe('HTML 里的简体原文')
  })
})

describe('setLocale / getLanguage', () => {
  it('语言包导不进来 → 返回 false 且保持原语言', async () => {
    primeLocaleForTest(makeBundle('zh-CN', { a: '甲' }))
    useLocale('zh-CN')
    setLocaleImporterForTest(
      vi.fn(async () => {
        throw new Error('Failed to fetch dynamically imported module')
      }),
    )

    expect(await setLocale('en')).toBe(false)
    expect(getActiveLocale()).toBe('zh-CN')
  })

  it('切换成功后写入配置（持久化）', async () => {
    primeLocaleForTest(makeBundle('zh-CN', { a: '甲' }))
    primeLocaleForTest(makeBundle('en', { a: 'A' }))
    useLocale('zh-CN')

    expect(await setLocale('en')).toBe(true)
    expect(getActiveLocale()).toBe('en')
    expect(getLanguage()).toBe('en')
  })

  it('persist: false 时不写配置（轮询回调用它防自激）', async () => {
    primeLocaleForTest(makeBundle('zh-CN', { a: '甲' }))
    primeLocaleForTest(makeBundle('en', { a: 'A' }))
    useLocale('zh-CN')

    expect(await setLocale('en', { persist: false })).toBe(true)
    expect(getActiveLocale()).toBe('en')
    // 断言「配置里没写」，而不是 getLanguage()：没配置时它会按系统语言猜，
    // 在 jsdom 里 navigator.language 是 en-US，猜出来正好也是 'en'，测不出区别
    expect(getConfig('bgm_language', '')).toBe('')
  })

  it('initializeI18n 幂等（重复调用只跑一次）', () => {
    const importer = vi.fn(async () => ({
      default: { schemaVersion: LOCALE_SCHEMA_VERSION, messages: {} },
    }))
    setLocaleImporterForTest(importer)
    initializeI18n()
    initializeI18n()
    initializeI18n()
    // 三个页面入口各自调用一次也只会有一次源语言导入（isInitialized 短路）
    expect(importer.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
