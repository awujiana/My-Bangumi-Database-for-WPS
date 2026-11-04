#!/usr/bin/env node
/**
 * 插件清单签名工具
 *
 * 用法：
 *   node scripts/plugin-sign.mjs --manifest plugin.json --key ~/.mbd-plugin-signing-key.pem
 *   node scripts/plugin-sign.mjs --manifest plugin.json --key <pem> --compute-checksum
 *
 * 做的事（顺序不能变）：
 *   1. 读 `plugin.json`
 *   2. `--compute-checksum` 时先按实际文件重算 `checksum`（默认只算 entry 指向的文件）
 *   3. 用 `buildPayload` 拼出待签名串
 *   4. 用 ECDSA P-256 + SHA-256 签（IEEE P1363 的 raw r||s，base64）
 *   5. 把 `signature` 写回 `plugin.json`
 *
 * ⚠️ `buildPayload` 是**签名契约的一半**，另一半在宿主
 * （`ts/plugins/plugin-manifest.ts` 的 `pluginSignaturePayload`）。
 * 两边的输出必须逐字节相同 —— 宿主仓库的 `tests/plugin-signature.test.ts` 会直接
 * import 本文件的 `buildPayload` 与宿主实现对比，改任一边而另一边没跟上就会红。
 */

import { createHash, sign } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

/** 唯一支持的算法标识（与宿主 `PLUGIN_SIGNATURE_ALGORITHM` 一致） */
export const ALGORITHM = 'ecdsa-p256-sha256'

/** 按 UTF-16 码位比较（不能用 localeCompare：签名必须与区域设置无关） */
function compareCodeUnits(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * 生成待签名字符串。
 *
 * @param {object} manifest `plugin.json` 的内容
 * @returns {string} 用 `\n` 连接、末尾不带换行
 */
export function buildPayload(manifest) {
  const checksumParts = []
  for (const file of Object.keys(manifest.checksum).sort(compareCodeUnits)) {
    const entry = manifest.checksum[file]
    checksumParts.push(`${file}:${entry.sha256}:${entry.size}`)
  }
  const permissions = [...manifest.permissions].sort(compareCodeUnits).join(',')
  const network = [...(manifest.network ?? [])].sort(compareCodeUnits).join(',')
  return [
    'mbd-plugin',
    `id:${manifest.id}`,
    `version:${manifest.version}`,
    `apiVersion:${manifest.apiVersion}`,
    `minHostVersion:${manifest.minHostVersion}`,
    `entry:${manifest.entry}`,
    `permissions:${permissions}`,
    `network:${network}`,
    `checksum:${checksumParts.join(',')}`,
  ].join('\n')
}

/** 读一个文件的 sha256（小写十六进制）与字节数 */
function hashFile(path) {
  const bytes = readFileSync(path)
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
}

/**
 * 重算 checksum（只算 entry 指向的入口文件，其余条目原样保留）。
 *
 * 返回值必须是**整份清单**而不是 checksum 表 —— `signManifest` 还要从里面读
 * id / version / permissions / network 拼待签名串，只回 checksum 会让
 * `--compute-checksum` 直接崩在 `Object.keys(undefined)`。
 */
export function computeChecksum(manifest, manifestPath) {
  const directory = dirname(manifestPath)
  const entry = manifest.entry ?? 'plugin.js'
  const entryPath = join(directory, entry)
  statSync(entryPath)
  return { ...manifest, checksum: { ...manifest.checksum, [entry]: hashFile(entryPath) } }
}

/**
 * 签一份清单并返回新的 `signature` 块。
 *
 * @param {object} manifest 已经算好 checksum 的清单
 * @param {string} privateKeyPem PKCS#8 的 PEM 私钥
 * @param {string} keyId 宿主内置公钥表里的键名
 */
export function signManifest(manifest, privateKeyPem, keyId) {
  const payload = buildPayload(manifest)
  const signature = sign('sha256', Buffer.from(payload, 'utf8'), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  })
  return { algorithm: ALGORITHM, keyId, value: signature.toString('base64') }
}

/** 从 `--name value` 形式取参数 */
function readOption(argv, name) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) return undefined
  return value
}

/** CLI 入口 */
function main() {
  const argv = process.argv.slice(2)
  const manifestPath = readOption(argv, 'manifest')
  const keyPath = readOption(argv, 'key') ?? process.env.MBD_PLUGIN_SIGNING_KEY
  const keyId = readOption(argv, 'key-id') ?? 'awujiana-2026'

  if (manifestPath === undefined || keyPath === undefined) {
    console.error(
      '用法：node scripts/plugin-sign.mjs --manifest plugin.json --key <私钥.pem> [--key-id awujiana-2026] [--compute-checksum]',
    )
    console.error('私钥也可以放在环境变量 MBD_PLUGIN_SIGNING_KEY 里。')
    process.exitCode = 1
    return
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const withChecksum = argv.includes('--compute-checksum')
    ? computeChecksum(manifest, manifestPath)
    : manifest
  const signature = signManifest(withChecksum, readFileSync(keyPath, 'utf8'), keyId)
  const next = { ...withChecksum, signature }
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

  console.log(`✔ 已签名 ${manifest.id} v${manifest.version}（keyId=${keyId}）`)
  console.log(`  待签名串 ${Buffer.byteLength(buildPayload(next), 'utf8')} 字节，签名值 ${signature.value.length} 字符`)
  if (withChecksum !== manifest) {
    console.log(`  checksum 已重算：${JSON.stringify(withChecksum.checksum)}`)
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('plugin-sign.mjs')) {
  main()
}
