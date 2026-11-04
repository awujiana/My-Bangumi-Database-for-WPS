/**
 * @fileoverview `ts/plugins/plugin-manifest.ts` 单测
 *
 * 覆盖四块：
 * 1. **清单校验**：`PLUGIN-SPEC.md` §3.2 的每条失败原因都要能被触发，且一次报全
 *    （作者改一处不用来回试）；
 * 2. **来源解析**：`owner/repo` / URL / 本地路径三态判定，以及 base URL 拼接；
 * 3. **域名白名单**：`*.x` 只匹配一级子域，裸域与多级子域都不放行；
 * 4. **待签名串**：字段顺序、排序与「不受区域设置影响」都是签名契约的一部分，
 *    改动即等于让所有已签名的插件失效，所以逐字节断言。
 */

import { describe, expect, it } from 'vitest'

import {
  HOST_PLUGIN_API_VERSION,
  isHostAllowed,
  parsePluginManifest,
  parsePluginSource,
  pluginSignaturePayload,
  pluginSourceBaseUrl,
} from '../ts/plugins/plugin-manifest.js'
import type { PluginManifest } from '../ts/plugins/plugin-types.js'

const HOST_VERSION = '2.4.1'
const SHA = 'a'.repeat(64)

/** 一份合法清单（各用例只改自己关心的字段） */
function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'hmoe-new-anime',
    name: 'H萌新番',
    version: '1.0.0',
    apiVersion: HOST_PLUGIN_API_VERSION,
    minHostVersion: '2.4.0',
    description: '一键下载 H萌新番 Excel',
    author: 'awujiana',
    entry: 'plugin.js',
    permissions: [],
    checksum: { 'plugin.js': { sha256: SHA, size: 1024 } },
  }
}

/** 校验失败时的错误数组（断言失败必是失败） */
function errorsOf(input: unknown): string[] {
  const result = parsePluginManifest(input, HOST_VERSION)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors
}

/** 校验通过后的清单 */
function manifestOf(input: unknown): PluginManifest {
  const result = parsePluginManifest(input, HOST_VERSION)
  if (!result.ok) throw new Error(`期望通过，实际错误：${result.errors.join('；')}`)
  return result.manifest
}

describe('parsePluginManifest · 正常路径', () => {
  it('最小合法清单通过并归一化默认值', () => {
    const manifest = manifestOf(validManifest())
    expect(manifest.id).toBe('hmoe-new-anime')
    expect(manifest.entry).toBe('plugin.js')
    expect(manifest.updatePolicy).toBe('auto')
    expect(manifest.signature).toBeUndefined()
    expect(manifest.network).toBeUndefined()
    expect(manifest.features).toBeUndefined()
  })

  it('可选字段被带上，且 network 统一小写', () => {
    const manifest = manifestOf({
      ...validManifest(),
      homepage: 'https://github.com/awujiana/MBD-plugin-hmacg',
      license: 'MIT',
      network: ['Raw.GitHubusercontent.com'],
      updatePolicy: 'manual',
      features: [{ key: 'download', name: '一键下载', description: '拉最新番表' }],
    })
    expect(manifest.homepage).toContain('MBD-plugin-hmacg')
    expect(manifest.license).toBe('MIT')
    expect(manifest.network).toEqual(['raw.githubusercontent.com'])
    expect(manifest.updatePolicy).toBe('manual')
    expect(manifest.features).toEqual([
      { key: 'download', name: '一键下载', description: '拉最新番表' },
    ])
  })

  it('features 里结构不对的条目被丢掉，其余仍保留', () => {
    const manifest = manifestOf({
      ...validManifest(),
      features: [{ key: 'a', name: 'A' }, { key: 'b' }, 'nonsense', null],
    })
    expect(manifest.features).toEqual([{ key: 'a', name: 'A', description: '' }])
  })

  it('features 全部无效时归一成 undefined（不返回空数组）', () => {
    const manifest = manifestOf({ ...validManifest(), features: [{ key: 'only-key' }] })
    expect(manifest.features).toBeUndefined()
  })

  it('updatePolicy 写了不认识的值时退回 auto', () => {
    expect(manifestOf({ ...validManifest(), updatePolicy: 'sometimes' }).updatePolicy).toBe('auto')
  })

  it('permissions 去重', () => {
    const manifest = manifestOf({
      ...validManifest(),
      permissions: ['sheet.read', 'sheet.read', 'log'],
    })
    expect(manifest.permissions).toEqual(['sheet.read', 'log'])
  })

  it('声明 net.fetch 且给了 network 时通过', () => {
    const manifest = manifestOf({
      ...validManifest(),
      permissions: ['net.fetch'],
      network: ['raw.githubusercontent.com'],
    })
    expect(manifest.network).toEqual(['raw.githubusercontent.com'])
  })
})

describe('parsePluginManifest · 失败路径', () => {
  it('非对象直接拒', () => {
    expect(errorsOf(null)).toEqual(['plugin.json 不是 JSON 对象'])
    expect(errorsOf('text')).toEqual(['plugin.json 不是 JSON 对象'])
    expect(errorsOf([])).toEqual(['plugin.json 不是 JSON 对象'])
  })

  it('schemaVersion 不匹配时报出收到的值', () => {
    const errors = errorsOf({ ...validManifest(), schemaVersion: 2 })
    expect(errors.some((item) => item.includes('schemaVersion 必须是 1'))).toBe(true)
  })

  it('id 形态：大写 / 下划线 / 连续连字符 / 首尾连字符都拒', () => {
    for (const id of ['Hmoe', 'hmoe_new', 'hmoe--new', '-hmoe', 'hmoe-']) {
      expect(errorsOf({ ...validManifest(), id })).toContain(
        'id 只能用小写字母、数字与连字符（如 hmoe-new-anime）',
      )
    }
  })

  it('缺必填字段时一次报全（不是遇到第一个就返回）', () => {
    const errors = errorsOf({ schemaVersion: 1 })
    expect(errors).toContain('缺少 id')
    expect(errors).toContain('缺少 name')
    expect(errors).toContain('缺少 version')
    expect(errors).toContain('缺少 apiVersion')
    expect(errors).toContain('缺少 minHostVersion')
    expect(errors).toContain('缺少 description')
    expect(errors).toContain('缺少 author')
    expect(errors).toContain('permissions 必须是数组（没有权限也要写 []）')
    expect(errors).toContain('checksum 缺失或不是对象')
  })

  it('version 不是语义化版本时拒', () => {
    expect(errorsOf({ ...validManifest(), version: '1' })).toContain(
      'version 必须是语义化版本，如 1.2.0',
    )
  })

  it('apiVersion 主版本与宿主不一致时拒', () => {
    const errors = errorsOf({ ...validManifest(), apiVersion: '2.0.0' })
    expect(errors.some((item) => item.includes('apiVersion 主版本需为 1.x'))).toBe(true)
  })

  it('minHostVersion 高于当前宿主时拒', () => {
    expect(errorsOf({ ...validManifest(), minHostVersion: '9.0.0' })).toContain(
      '需要 MBD ≥ 9.0.0（当前 2.4.1）',
    )
  })

  it('entry 不是 plugin.js 时拒', () => {
    expect(errorsOf({ ...validManifest(), entry: 'index.js' })).toContain(
      'entry 目前只支持 plugin.js',
    )
  })

  it('未知权限直接拒（不静默丢弃）', () => {
    expect(errorsOf({ ...validManifest(), permissions: ['root'] })).toContain(
      'permissions 里有未知权限：root',
    )
  })

  it('声明 net.fetch 却没给 network 时拒', () => {
    expect(errorsOf({ ...validManifest(), permissions: ['net.fetch'] })).toContain(
      '声明了 net.fetch 就必须在 network 里列出允许访问的域名',
    )
  })

  it('network 里有空项时拒', () => {
    expect(errorsOf({ ...validManifest(), permissions: ['net.fetch'], network: ['  '] })).toContain(
      'network 里存在空项',
    )
  })

  it('network 不是数组时拒', () => {
    expect(errorsOf({ ...validManifest(), network: 'raw.githubusercontent.com' })).toContain(
      'network 必须是字符串数组',
    )
  })

  it('checksum 缺 plugin.js 条目时拒', () => {
    const errors = errorsOf({
      ...validManifest(),
      checksum: { 'other.js': { sha256: SHA, size: 1 } },
    })
    expect(errors).toContain('checksum 必须包含 plugin.js')
  })

  it('checksum 的 sha256 不是 64 位小写十六进制时拒', () => {
    const expected = 'checksum.plugin.js.sha256 必须是 64 位小写十六进制'
    expect(
      errorsOf({ ...validManifest(), checksum: { 'plugin.js': { sha256: 'ABC', size: 1 } } }),
    ).toContain(expected)
    expect(
      errorsOf({
        ...validManifest(),
        checksum: { 'plugin.js': { sha256: 'A'.repeat(64), size: 1 } },
      }),
    ).toContain(expected)
  })

  it('checksum 的 size 非正数时拒', () => {
    expect(
      errorsOf({ ...validManifest(), checksum: { 'plugin.js': { sha256: SHA, size: 0 } } }),
    ).toContain('checksum.plugin.js 需要 sha256（64 位十六进制）与 size（正整数）')
  })

  it('checksum 条目不是对象时拒', () => {
    expect(errorsOf({ ...validManifest(), checksum: { 'plugin.js': 'abc' } })).toContain(
      'checksum.plugin.js 不是对象',
    )
  })
})

describe('parsePluginManifest · 签名块', () => {
  const signature = {
    algorithm: 'ecdsa-p256-sha256',
    keyId: 'awujiana-2026',
    value: 'AAAA',
  }

  it('合法签名块被带上', () => {
    expect(manifestOf({ ...validManifest(), signature }).signature).toEqual(signature)
  })

  it('signature 不是对象时拒', () => {
    expect(errorsOf({ ...validManifest(), signature: 'sig' })).toContain('signature 必须是对象')
  })

  it('缺字段时拒', () => {
    expect(errorsOf({ ...validManifest(), signature: { algorithm: 'x' } })).toContain(
      'signature 需要 algorithm / keyId / value 三个字符串字段',
    )
  })

  it('不支持的算法时拒', () => {
    expect(
      errorsOf({ ...validManifest(), signature: { ...signature, algorithm: 'rsa-pss' } }),
    ).toContain('signature.algorithm 只支持 ecdsa-p256-sha256')
  })
})

describe('pluginSignaturePayload', () => {
  it('字段顺序与排序固定（签名契约，改动即让已签名的插件全部失效）', () => {
    const manifest = manifestOf({
      ...validManifest(),
      permissions: ['sheet.write', 'data.read'],
      network: ['b.example.com', 'a.example.com'],
      checksum: {
        'plugin.js': { sha256: SHA, size: 10 },
        'a-helper.js': { sha256: 'b'.repeat(64), size: 5 },
      },
    })
    expect(pluginSignaturePayload(manifest)).toBe(
      [
        'mbd-plugin',
        'id:hmoe-new-anime',
        'version:1.0.0',
        'apiVersion:1.0.0',
        'minHostVersion:2.4.0',
        'entry:plugin.js',
        'permissions:data.read,sheet.write',
        'network:a.example.com,b.example.com',
        `checksum:a-helper.js:${'b'.repeat(64)}:5,plugin.js:${SHA}:10`,
      ].join('\n'),
    )
  })

  it('没有 network 时该行是空串（不是省略该行）', () => {
    const payload = pluginSignaturePayload(manifestOf(validManifest()))
    expect(payload).toContain('\nnetwork:\n')
  })
})

describe('parsePluginSource / pluginSourceBaseUrl', () => {
  it('空串返回 null', () => {
    expect(parsePluginSource(' '.repeat(3))).toBeNull()
  })

  it('owner/repo 判成 github', () => {
    expect(parsePluginSource('awujiana/MBD-plugin-hmacg')).toEqual({
      kind: 'github',
      value: 'awujiana/MBD-plugin-hmacg',
    })
  })

  it('http(s) URL 判成 api', () => {
    expect(parsePluginSource('https://example.com/plugins/')).toEqual({
      kind: 'api',
      value: 'https://example.com/plugins/',
    })
  })

  it('盘符路径判成 local', () => {
    expect(parsePluginSource(String.raw`D:\plugins\hmoe`)).toEqual({
      kind: 'local',
      value: String.raw`D:\plugins\hmoe`,
    })
  })

  it('github 来源拼成 raw CDN 地址', () => {
    expect(pluginSourceBaseUrl({ kind: 'github', value: '/awujiana/MBD-plugin-hmacg/' })).toBe(
      'https://raw.githubusercontent.com/awujiana/MBD-plugin-hmacg/main',
    )
  })

  it('github 来源形态不对时返回空串', () => {
    expect(pluginSourceBaseUrl({ kind: 'github', value: 'just-one-segment' })).toBe('')
  })

  it('api 来源必须是 HTTPS，末尾斜杠被去掉', () => {
    expect(pluginSourceBaseUrl({ kind: 'api', value: 'https://example.com/p/' })).toBe(
      'https://example.com/p',
    )
    expect(pluginSourceBaseUrl({ kind: 'api', value: 'http://example.com/p' })).toBe('')
  })

  it('api 来源放行 127.0.0.1 的明文地址（本地调试）', () => {
    expect(pluginSourceBaseUrl({ kind: 'api', value: 'http://127.0.0.1:8080/p' })).toBe(
      'http://127.0.0.1:8080/p',
    )
    expect(pluginSourceBaseUrl({ kind: 'api', value: 'http://localhost:8080' })).toBe('')
  })

  it('api 来源不是合法 URL 时返回空串', () => {
    expect(pluginSourceBaseUrl({ kind: 'api', value: 'https://' })).toBe('')
  })

  it('local 来源不走网络', () => {
    expect(pluginSourceBaseUrl({ kind: 'local', value: String.raw`D:\plugins` })).toBe('')
  })
})

describe('isHostAllowed', () => {
  it('白名单为空时一律拒', () => {
    expect(isHostAllowed('https://a.com/x', undefined)).toBe(false)
    expect(isHostAllowed('https://a.com/x', [])).toBe(false)
  })

  it('精确匹配域名', () => {
    expect(
      isHostAllowed('https://raw.githubusercontent.com/a/b', ['raw.githubusercontent.com']),
    ).toBe(true)
  })

  it('匹配时忽略大小写与前后空格', () => {
    expect(isHostAllowed('https://RAW.github.com/a', [' Raw.GitHub.com '])).toBe(true)
  })

  it('*.x 匹配所有子域，但不含裸域', () => {
    const network = ['*.example.com']
    expect(isHostAllowed('https://a.example.com/x', network)).toBe(true)
    expect(isHostAllowed('https://a.b.example.com/x', network)).toBe(true)
    expect(isHostAllowed('https://example.com/x', network)).toBe(false)
  })

  it('非法 URL 返回 false 而不是抛错', () => {
    expect(isHostAllowed('not-a-url', ['example.com'])).toBe(false)
  })

  it('其他域名不在白名单内', () => {
    expect(isHostAllowed('https://evil.com/x', ['example.com'])).toBe(false)
  })
})
