/**
 * @fileoverview 页面标识归一的单测（ts/tools/page-key.ts）
 * @module tests/pageKey
 * @description 2.4.0 把页面标识 `panel` 改名成 `sync-panel`，已发布的 2.3.0
 *              用旧标识写过 PluginStorage。本文件钉住三件事：
 *   1. 旧标识能归一到新标识，新标识幂等；
 *   2. `{ 页面: … }` 映射迁移后**删掉旧键** —— 否则「重置排序 / 清空折叠状态」
 *      这类靠 `delete map[page]` 实现的写操作会被下一次读自动补回来；
 *   3. 迁移不覆盖已存在的新键，避免把升级后写入的状态回退成旧值。
 */

import { describe, expect, it } from 'vitest'
import { applyPageKeyAliases, legacyPageKeys, normalizePageKey } from '../ts/tools/page-key.js'

describe('normalizePageKey', () => {
  it('旧标识 panel 归一到 sync-panel', () => {
    expect(normalizePageKey('panel')).toBe('sync-panel')
  })

  it('新标识幂等（重复调用不会变成 sync-sync-panel）', () => {
    expect(normalizePageKey('sync-panel')).toBe('sync-panel')
    expect(normalizePageKey(normalizePageKey('panel'))).toBe('sync-panel')
  })

  it('没登记过的标识原样返回', () => {
    expect(normalizePageKey('enrich')).toBe('enrich')
    expect(normalizePageKey('')).toBe('')
  })
})

describe('legacyPageKeys', () => {
  it('sync-panel 的历史标识是 panel', () => {
    expect(legacyPageKeys('sync-panel')).toEqual(['panel'])
  })

  it('传旧标识也能拿到历史列表（先归一再查）', () => {
    expect(legacyPageKeys('panel')).toEqual(['panel'])
  })

  it('没有历史标识的页面返回空数组', () => {
    expect(legacyPageKeys('enrich')).toEqual([])
  })
})

describe('applyPageKeyAliases', () => {
  it('把旧键的值迁到新键，并删掉旧键', () => {
    const map: Record<string, unknown> = { panel: ['a', 'b'], enrich: ['c'] }
    expect(applyPageKeyAliases(map)).toEqual({ 'sync-panel': ['a', 'b'], enrich: ['c'] })
    expect(Object.hasOwn(map, 'panel')).toBe(false)
  })

  it('新键已存在时不覆盖（升级后新写入的状态优先）', () => {
    const map: Record<string, unknown> = { panel: ['old'], 'sync-panel': ['new'] }
    expect(applyPageKeyAliases(map)).toEqual({ 'sync-panel': ['new'] })
  })

  it('新键已存在时仍然删掉旧键（否则重置排序后旧值会被补回来）', () => {
    const map: Record<string, unknown> = { panel: ['old'], 'sync-panel': ['new'] }
    applyPageKeyAliases(map)
    expect(Object.hasOwn(map, 'panel')).toBe(false)
  })

  it('没有旧键时不动其它页面', () => {
    const map: Record<string, unknown> = { enrich: ['a'], clean: ['b'] }
    expect(applyPageKeyAliases(map)).toEqual({ enrich: ['a'], clean: ['b'] })
  })

  it('就地修改并返回同一个对象（调用方依赖返回值接着 parse）', () => {
    const map: Record<string, unknown> = { panel: ['a'] }
    expect(applyPageKeyAliases(map)).toBe(map)
  })
})
