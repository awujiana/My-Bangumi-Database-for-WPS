// @vitest-environment node
/**
 * @fileoverview `ts/tools/accounts.ts` 多账号档案单测
 *
 * 守住的东西：
 * 1. 按 userId 去重（同账号重复记录只更新，不新增）；
 * 2. 坏数据 / 缺字段 / 重复项在读的时候被丢掉（自愈，不需要迁移）；
 * 3. 切换 = 把档案写回 `bgm_token` / `bgm_user_id`，且切过的提到最前；
 * 4. 未记录的账号返回 null（调用方提示，不静默成功）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: {
    TOKEN: 'bgm_token',
    USER_ID: 'bgm_user_id',
    ACCOUNTS: 'bgm_accounts',
  },
  getConfig: (key: string, fallback = ''): string => mockState.store.get(key) ?? fallback,
  setConfig: (key: string, value: string): boolean => {
    mockState.store.set(key, value)
    return true
  },
}))

import {
  didUpsertAccount,
  getActiveUserId,
  listAccounts,
  MAX_ACCOUNTS,
  removeAccount,
  switchAccount,
} from '../ts/tools/accounts.js'

beforeEach(() => {
  mockState.store.clear()
})

describe('账号档案', () => {
  it('记录后可按 userId 去重更新', () => {
    expect(didUpsertAccount({ userId: '1', token: 'a', username: '甲' })).toBe(true)
    expect(didUpsertAccount({ userId: '1', token: 'b', username: '甲2' })).toBe(true)
    const accounts = listAccounts(true)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.token).toBe('b')
    expect(accounts[0]?.username).toBe('甲2')
  })

  it('缺 userId 或 token 时拒绝写入', () => {
    expect(didUpsertAccount({ userId: '', token: 'a', username: '' })).toBe(false)
    expect(didUpsertAccount({ userId: '1', token: '', username: '' })).toBe(false)
    expect(listAccounts(true)).toHaveLength(0)
  })

  it('坏数据自愈：非法 JSON / 非数组 / 缺字段 / 重复项都被丢掉', () => {
    mockState.store.set('bgm_accounts', 'not-json')
    expect(listAccounts(true)).toEqual([])

    mockState.store.set('bgm_accounts', JSON.stringify({ a: 1 }))
    expect(listAccounts(true)).toEqual([])

    mockState.store.set(
      'bgm_accounts',
      JSON.stringify([
        { userId: '1', token: 'a' },
        { userId: '1', token: 'b' },
        { userId: '', token: 'c' },
        { userId: '2' },
        'oops',
      ]),
    )
    const accounts = listAccounts(true)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.userId).toBe('1')
  })

  it('切换把 Token / userId 写回生效配置，并把该账号提到最前', () => {
    didUpsertAccount({ userId: '1', token: 'token-1', username: '甲' })
    didUpsertAccount({ userId: '2', token: 'token-2', username: '乙' })

    const switched = switchAccount('1')

    expect(switched?.userId).toBe('1')
    expect(mockState.store.get('bgm_token')).toBe('token-1')
    expect(getActiveUserId(true)).toBe('1')
    expect(listAccounts(true)[0]?.userId).toBe('1')
  })

  it('切换未记录的账号返回 null 且不动生效配置', () => {
    mockState.store.set('bgm_token', 'keep')
    expect(switchAccount('999')).toBeNull()
    expect(mockState.store.get('bgm_token')).toBe('keep')
  })

  it('删除只移出档案，不改当前 Token', () => {
    didUpsertAccount({ userId: '1', token: 'token-1', username: '' })
    mockState.store.set('bgm_token', 'token-1')

    expect(removeAccount('1')).toBe(true)
    expect(listAccounts(true)).toHaveLength(0)
    expect(mockState.store.get('bgm_token')).toBe('token-1')
  })

  it('超过上限时只保留最新的 N 条', () => {
    for (let index = 0; index < MAX_ACCOUNTS + 2; index += 1) {
      didUpsertAccount({ userId: String(index), token: `t${String(index)}`, username: '' })
    }
    expect(listAccounts(true)).toHaveLength(MAX_ACCOUNTS)
  })
})
