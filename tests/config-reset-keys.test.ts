/**
 * @fileoverview 「重置全部配置」键筛选单测
 *
 * 会话态键（锁定工作表状态 `bgm_locked_sheet_<page>`）按前缀匹配、不参与重置，
 * 以免用户一次「重置全部配置」就把当前锁定的目标工作表也清掉。
 */

import { describe, it, expect } from 'vitest'
import {
  SESSION_STATE_KEY_PREFIXES,
  isSessionStateKey,
  getResettableConfigKeys,
} from '../ts/ui/handlers/config-reset-keys.js'
import { CONFIG_KEYS } from '../ts/tools/config.js'

describe('config-reset-keys', () => {
  it('会话态键前缀恰为锁定工作表（bgm_locked_sheet_）', () => {
    expect([...SESSION_STATE_KEY_PREFIXES]).toEqual(['bgm_locked_sheet_'])
  })

  it('isSessionStateKey 按前缀识别锁定工作表键', () => {
    expect(isSessionStateKey('bgm_locked_sheet_panel')).toBe(true)
    expect(isSessionStateKey('bgm_locked_sheet_enrich')).toBe(true)
    // 普通偏好键不是会话态
    expect(isSessionStateKey(CONFIG_KEYS.THEME)).toBe(false)
    expect(isSessionStateKey('bgm_token')).toBe(false)
  })

  it('可重置键不含任何会话态键（含带前缀的真实锁定键）', () => {
    for (const key of getResettableConfigKeys()) {
      expect(isSessionStateKey(key)).toBe(false)
    }
  })

  it('可重置键覆盖全部 CONFIG_KEYS（当前无 CONFIG_KEYS 项是会话态前缀）', () => {
    const all = Object.values(CONFIG_KEYS)
    const resettable = getResettableConfigKeys()
    expect(resettable).toHaveLength(all.length)
    for (const key of all) expect(resettable).toContain(key)
  })

  it('覆盖典型偏好键（主题 / 排序 / 列表类型 / 日志级别）', () => {
    const resettable = getResettableConfigKeys()
    expect(resettable).toContain(CONFIG_KEYS.THEME)
    expect(resettable).toContain(CONFIG_KEYS.NAV_ORDER)
    expect(resettable).toContain(CONFIG_KEYS.LIST_TYPE)
    expect(resettable).toContain(CONFIG_KEYS.LOG_LEVEL)
  })

  it('结果无重复', () => {
    const resettable = getResettableConfigKeys()
    expect(new Set(resettable).size).toBe(resettable.length)
  })
})
