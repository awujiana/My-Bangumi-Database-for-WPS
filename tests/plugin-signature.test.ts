/**
 * @fileoverview `ts/plugins/plugin-signature.ts` 单测
 *
 * 签名是「信任」的唯一硬证据，所以这里不只测分支，还做**真实签名往返**：
 * 现场生成 P-256 密钥对 → 用 `pluginSignaturePayload` 签 → 验签必须 `verified`；
 * 改一个字节（版本 / 权限 / 文件哈希）就必须变 `invalid`。
 *
 * 关键取舍：`verifyPluginSignature` 的公钥表是**可注入参数**，否则只能测
 * 「未签名 / 未知 keyId」这类边角，永远测不到真正的验签路径。
 */

import { describe, expect, it } from 'vitest'

import {
  base64ToBytes,
  verifyPluginSignature,
  TRUSTED_PLUGIN_KEYS,
} from '../ts/plugins/plugin-signature.js'
import { pluginSignaturePayload } from '../ts/plugins/plugin-manifest.js'
// eslint-disable-next-line n/no-missing-import -- 工具脚本是 .mjs（包为 CJS），TS 解析器只认 .mts，文件本身真实存在
import { buildPayload, computeChecksum } from '../scripts/plugin-sign.mjs'
import type { PluginManifest } from '../ts/plugins/plugin-types.js'

const SHA = 'a'.repeat(64)

/** 待签名的清单（不带 signature 字段，签名时再挂上） */
function unsignedManifest(): PluginManifest {
  return {
    schemaVersion: 1,
    id: 'hmoe-new-anime',
    name: 'H萌新番',
    version: '1.0.0',
    apiVersion: '1.0.0',
    minHostVersion: '2.4.0',
    description: '一键下载 H萌新番 Excel',
    author: 'awujiana',
    entry: 'plugin.js',
    permissions: ['sheet.write', 'net.fetch'],
    network: ['raw.githubusercontent.com'],
    updatePolicy: 'auto',
    checksum: { 'plugin.js': { sha256: SHA, size: 1024 } },
  }
}

/** 字节 → base64（测试侧自备，不复用被测代码） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCodePoint(byte)
  // eslint-disable-next-line unicorn/prefer-uint8array-base64 -- Node 22 与 WPS/CEF 都还没有 Uint8Array#toBase64
  return btoa(binary)
}

/** 现场生成密钥对，并把公钥按 SPKI DER 转成 base64 */
async function createKeyPair(): Promise<{
  keyId: string
  keys: Record<string, string>
  sign: (payload: string) => Promise<string>
}> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  const keyId = 'test-key'
  return {
    keyId,
    keys: { [keyId]: bytesToBase64(new Uint8Array(spki)) },
    sign: async (payload: string) => {
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(payload),
      )
      return bytesToBase64(new Uint8Array(signature))
    },
  }
}

describe('base64ToBytes', () => {
  it('正常 base64 解出字节', () => {
    expect(base64ToBytes('AQID')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('非法 base64 返回 null 而不是抛错', () => {
    expect(base64ToBytes('!!!!')).toBeNull()
  })

  it('空串解出空数组', () => {
    expect(base64ToBytes('')?.length).toBe(0)
  })
})

describe('verifyPluginSignature · 非验签分支', () => {
  it('没有 signature 字段 → unsigned', async () => {
    expect(await verifyPluginSignature(unsignedManifest())).toBe('unsigned')
  })

  it('算法不认识 → invalid（不尝试别的算法）', async () => {
    const manifest = unsignedManifest()
    manifest.signature = { algorithm: 'rsa-pss', keyId: 'test-key', value: 'AQID' }
    expect(await verifyPluginSignature(manifest, { 'test-key': 'AQID' })).toBe('invalid')
  })

  it('keyId 不在可信表里 → untrusted-key', async () => {
    const manifest = unsignedManifest()
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId: 'stranger', value: 'AQID' }
    expect(await verifyPluginSignature(manifest)).toBe('untrusted-key')
  })

  it('签名值不是合法 base64 → invalid', async () => {
    const { keyId, keys } = await createKeyPair()
    const manifest = unsignedManifest()
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId, value: '!!!!' }
    expect(await verifyPluginSignature(manifest, keys)).toBe('invalid')
  })

  it('公钥不是合法 base64 → invalid', async () => {
    const manifest = unsignedManifest()
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId: 'broken', value: 'AQID' }
    expect(await verifyPluginSignature(manifest, { broken: '!!!!' })).toBe('invalid')
  })

  it('公钥字节不是 SPKI → invalid（importKey 抛错被吃掉）', async () => {
    const manifest = unsignedManifest()
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId: 'junk', value: 'AQID' }
    expect(await verifyPluginSignature(manifest, { junk: 'AQID' })).toBe('invalid')
  })

  it('内置可信表里确实有 awujiana-2026 这把公钥', () => {
    expect(Object.keys(TRUSTED_PLUGIN_KEYS)).toContain('awujiana-2026')
  })
})

describe('verifyPluginSignature · 真实签名往返', () => {
  it('同一份清单签名后验签通过', async () => {
    const { keyId, keys, sign } = await createKeyPair()
    const manifest = unsignedManifest()
    const value = await sign(pluginSignaturePayload(manifest))
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId, value }
    expect(await verifyPluginSignature(manifest, keys)).toBe('verified')
  })

  it('权限被加一条 → 验签失败（签名覆盖权限）', async () => {
    const { keyId, keys, sign } = await createKeyPair()
    const manifest = unsignedManifest()
    const value = await sign(pluginSignaturePayload(manifest))
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId, value }
    manifest.permissions = [...manifest.permissions, 'data.write']
    expect(await verifyPluginSignature(manifest, keys)).toBe('invalid')
  })

  it('域名白名单被放宽 → 验签失败', async () => {
    const { keyId, keys, sign } = await createKeyPair()
    const manifest = unsignedManifest()
    const value = await sign(pluginSignaturePayload(manifest))
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId, value }
    manifest.network = ['*']
    expect(await verifyPluginSignature(manifest, keys)).toBe('invalid')
  })

  it('版本号被改 → 验签失败（防止拿旧签名顶新版本）', async () => {
    const { keyId, keys, sign } = await createKeyPair()
    const manifest = unsignedManifest()
    const value = await sign(pluginSignaturePayload(manifest))
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId, value }
    manifest.version = '1.0.1'
    expect(await verifyPluginSignature(manifest, keys)).toBe('invalid')
  })

  it('入口文件哈希被改 → 验签失败（签名绑定的是文件内容）', async () => {
    const { keyId, keys, sign } = await createKeyPair()
    const manifest = unsignedManifest()
    const value = await sign(pluginSignaturePayload(manifest))
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId, value }
    manifest.checksum = { 'plugin.js': { sha256: 'b'.repeat(64), size: 1024 } }
    expect(await verifyPluginSignature(manifest, keys)).toBe('invalid')
  })

  it('展示性字段（name / description）不参与签名，改了仍通过', async () => {
    const { keyId, keys, sign } = await createKeyPair()
    const manifest = unsignedManifest()
    const value = await sign(pluginSignaturePayload(manifest))
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId, value }
    manifest.name = '改个名字'
    manifest.description = '改个描述'
    expect(await verifyPluginSignature(manifest, keys)).toBe('verified')
  })

  it('换成另一把私钥签 → 验签失败', async () => {
    const trusted = await createKeyPair()
    const attacker = await createKeyPair()
    const manifest = unsignedManifest()
    const value = await attacker.sign(pluginSignaturePayload(manifest))
    manifest.signature = { algorithm: 'ecdsa-p256-sha256', keyId: trusted.keyId, value }
    expect(await verifyPluginSignature(manifest, trusted.keys)).toBe('invalid')
  })
})

describe('签名工具与宿主的契约一致', () => {
  it('scripts/plugin-sign.mjs 的 buildPayload 与宿主实现逐字节相同', () => {
    const manifest = unsignedManifest()
    expect(buildPayload(manifest)).toBe(pluginSignaturePayload(manifest))
  })

  it('乱序的权限 / 白名单 / checksum 也拼出同一个串', () => {
    const ordered = unsignedManifest()
    const shuffled: PluginManifest = {
      ...ordered,
      permissions: [...ordered.permissions].reverse(),
      network: [...(ordered.network ?? [])].reverse(),
      checksum: {
        'plugin.js': ordered.checksum['plugin.js'] ?? { sha256: SHA, size: 1024 },
        'a-helper.js': { sha256: 'b'.repeat(64), size: 5 },
      },
    }
    expect(buildPayload(shuffled)).toBe(pluginSignaturePayload(shuffled))
    expect(buildPayload(shuffled)).toContain(`checksum:a-helper.js:${'b'.repeat(64)}:5,plugin.js:`)
  })

  it('没有 network 字段时两边都留空行', () => {
    const manifest = unsignedManifest()
    delete manifest.network
    expect(buildPayload(manifest)).toBe(pluginSignaturePayload(manifest))
    expect(buildPayload(manifest)).toContain('\nnetwork:\n')
  })

  it('computeChecksum 返回整份清单，--compute-checksum 才不会崩在 buildPayload', () => {
    const manifest = unsignedManifest()
    // 借用仓库里真实存在的 .mjs 当作入口文件：本目录测试不允许 import node:fs，
    // 也不想为一条断言新增 fixture 目录。vitest 的 cwd 就是包根，所以相对路径够用。
    manifest.entry = 'plugin-sign.mjs'
    const manifestPath = 'scripts/plugin-sign.d.mts'

    const result = computeChecksum(manifest, manifestPath)
    const recomputed = result.checksum['plugin-sign.mjs']

    expect(result.id).toBe(manifest.id)
    expect(result.version).toBe(manifest.version)
    expect(result.permissions).toEqual(manifest.permissions)
    expect(result.network).toEqual(manifest.network)
    expect(result.checksum['plugin.js']).toEqual({ sha256: SHA, size: 1024 })
    expect(recomputed?.sha256).toMatch(/^[\da-f]{64}$/)
    expect(recomputed?.size).toBeGreaterThan(0)
    expect(buildPayload(result)).toContain(
      `plugin-sign.mjs:${recomputed?.sha256 ?? 'missing'}:${String(recomputed?.size ?? -1)}`,
    )
  })
})
