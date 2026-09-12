/**
 * @fileoverview 「重置全部配置」键筛选单测
 *
 * 回归背景：`resetAllConfig` 曾直接遍历 `Object.values(CONFIG_KEYS)` 并逐个删除，
 * 把会话态键 `bgm_locked_sheet` / `bgm_locked_workbook` 也一并清掉 ——
 * 用户点一次「重置全部配置」会同时丢失当前锁定的目标工作表，
 * 与其自身注释「仅保留会话态」以及 config-service 的导出白名单相矛盾。
 */

import { describe, it, expect } from 'vitest'
import {
  SESSION_STATE_KEYS,
  getResettableConfigKeys,
} from '../ts/ui/handlers/config-reset-keys.js'
import { CONFIG_KEYS } from '../ts/tools/config.js'

describe('config-reset-keys', () => {
  it('会话态键集合恰为锁定工作表 / 工作簿', () => {
    expect([...SESSION_STATE_KEYS].sort((a, b) => a.localeCompare(b))).toEqual(
      [CONFIG_KEYS.LOCKED_SHEET, CONFIG_KEYS.LOCKED_WORKBOOK].sort((a, b) => a.localeCompare(b)),
    )
  })

  it('可重置键中不含任何会话态键', () => {
    for (const key of getResettableConfigKeys()) {
      expect(SESSION_STATE_KEYS.has(key)).toBe(false)
    }
  })

  it('可重置键 + 会话态键 == 全部配置键（无遗漏）', () => {
    const all = Object.values(CONFIG_KEYS)
    const resettable = getResettableConfigKeys()
    expect(resettable).toHaveLength(all.length - SESSION_STATE_KEYS.size)
    const union = new Set([...resettable, ...SESSION_STATE_KEYS])
    expect(union.size).toBe(all.length)
    for (const key of all) expect(union.has(key)).toBe(true)
  })

  it('覆盖典型偏好键（主题 / 排序 / Token 无关的同步偏好）', () => {
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
