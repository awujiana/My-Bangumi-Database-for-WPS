import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BGM,
  storeBgToken,
  clearBgToken,
  storeTokenExpires,
  loadTokenExpires,
  clearTokenExpires,
  loadBgToken,
  bgmLog,
} from '../ts/tools/util/index.js'
import { logger } from '../ts/tools/logger.js'

/** 捕获模块级 BGM.LOG_LEVEL 初始值，便于用例结束后还原，避免跨文件污染 */
const ORIGINAL_LOG_LEVEL = BGM.LOG_LEVEL
/** 直接变更模块级 BGM.LOG_LEVEL（vi.stubGlobal 对非 configurable 全局无效，且此处是模块内 const） */
const setBgmLogLevel = (level: number): void => {
  BGM.LOG_LEVEL = level
}

describe('util Token 存储（window.Application 注入）', () => {
  let storage: Record<string, string>

  const installApp = (hasStorage: boolean): void => {
    const fakeApp = {
      ActiveWorkbook: {},
      PluginStorage: hasStorage
        ? {
            getItem: (key: string) => (Object.hasOwn(storage, key) ? storage[key] : null),
            setItem: (key: string, value: string) => {
              storage[key] = value
            },
          }
        : undefined,
    }
    vi.stubGlobal('window', { Application: fakeApp })
  }

  beforeEach(() => {
    storage = {}
    // 还原 BGM.LOG_LEVEL，避免 bgmLog 用例改过后泄漏到本 describe 其它用例
    setBgmLogLevel(ORIGINAL_LOG_LEVEL)
    installApp(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('storeBgToken 写入并返回 true；clearBgToken 清空', () => {
    expect(storeBgToken('tok')).toBe(true)
    expect(storage.bgm_token).toBe('tok')
    expect(clearBgToken()).toBe(true)
    expect(storage.bgm_token).toBe('')
  })

  it('storeTokenExpires / loadTokenExpires / clearTokenExpires 往返', () => {
    storeTokenExpires(1_700_000_000)
    expect(storage.bgm_token_expires).toBe('1700000000')
    expect(loadTokenExpires()).toBe(1_700_000_000)
    clearTokenExpires()
    expect(storage.bgm_token_expires).toBe('')
    expect(loadTokenExpires()).toBe(null)
  })

  it('loadTokenExpires 对非法值返回 null', () => {
    storage.bgm_token_expires = 'oops'
    expect(loadTokenExpires()).toBe(null)
    storage.bgm_token_expires = '-3'
    expect(loadTokenExpires()).toBe(null)
  })

  it('无 PluginStorage 时安全降级（不抛错）', () => {
    installApp(false)
    expect(storeBgToken('x')).toBe(false)
    expect(clearBgToken()).toBe(false)
    expect(() => storeTokenExpires(1)).not.toThrow()
    expect(loadTokenExpires()).toBe(null)
    expect(() => clearTokenExpires()).not.toThrow()
  })

  it('loadBgToken 读取已存 Token；缺失返回 null', () => {
    storage.bgm_token = 'tok'
    expect(loadBgToken()).toBe('tok')
    delete storage.bgm_token
    expect(loadBgToken()).toBe(null)
  })
})

const spyOnLogger = (method: 'debug' | 'info' | 'warn' | 'error') =>
  vi.spyOn(logger, method)

describe('bgmLog 日志级别分发', () => {
  beforeEach(() => {
    setBgmLogLevel(0)
  })

  afterEach(() => {
    setBgmLogLevel(ORIGINAL_LOG_LEVEL)
  })

  it('按级别分发到 logger 对应方法；未知级别回退 info', () => {
    setBgmLogLevel(0)
    const debugSpy = spyOnLogger('debug')
    const infoSpy = spyOnLogger('info')
    const warnSpy = spyOnLogger('warn')
    const errorSpy = spyOnLogger('error')
    // 未知级别 9 走 default 分支 -> 回退 info
    bgmLog(0, 'd')
    bgmLog(1, 'i')
    bgmLog(2, 'w')
    bgmLog(3, 'e')
    bgmLog(9, 'x')
    expect(debugSpy).toHaveBeenCalledWith('d')
    expect(infoSpy).toHaveBeenCalledWith('i')
    expect(warnSpy).toHaveBeenCalledWith('w')
    expect(errorSpy).toHaveBeenCalledWith('e')
    expect(infoSpy).toHaveBeenCalledWith('x')
    vi.restoreAllMocks()
  })

  it('低于 BGM.LOG_LEVEL 的日志被过滤', () => {
    setBgmLogLevel(2)
    const infoSpy = spyOnLogger('info')
    const warnSpy = spyOnLogger('warn')
    // 级别 1 < 2 被过滤
    bgmLog(1, 'dropped')
    // 级别 2 >= 2 保留
    bgmLog(2, 'kept')
    bgmLog(3, 'kept2')
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('kept')
    vi.restoreAllMocks()
  })
})
