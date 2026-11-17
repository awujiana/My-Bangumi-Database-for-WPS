#!/usr/bin/env node
/**
 * 发布前校验两个首批插件数据源仓库。
 *
 *   node --no-warnings scripts/verify-plugin-repos.mjs
 *
 * 校验的是「用户装插件时宿主真正会看到的东西」：
 * 1. 用**宿主编译产物** `dist-ts/plugins/plugin-signature.js` 验签，而不是自己复刻算法；
 * 2. 同时验一份删掉 `dataSourceVersion` 的清单 —— 已发布的旧宿主不认识这个展示字段，
 *    验签结果必须同样是 verified，否则线上插件会集体掉进「签名无效」；
 * 3. `plugin.js` 的实际字节与 `checksum` 对齐；
 * 4. 数据分片的 sha256 / 字节数 / 条数自洽；
 * 5. `plugin.json.dataSourceVersion` 与 `data/manifest.json.dataVersion` 逐字符一致。
 *
 * Node 22 会自动把无 `type` 字段包里的 ESM 语法 `.js` 重新解析成 ES module，
 * 所以可以直接 import 编译产物；`--no-warnings` 只是压掉那条性能提示。
 * 跑之前记得先 `npm run build:ts`，否则验的是上一版产物。
 */

import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (globalThis.crypto === undefined) globalThis.crypto = webcrypto

const hostRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoriesRoot = join(hostRoot, '..')
const repositories = ['MBD-plugin-hmacg', 'MBD-plugin-yucwiki']

const moduleUrl = new URL('../dist-ts/plugins/plugin-signature.js', import.meta.url)
const { verifyPluginSignature } = await import(moduleUrl.href)

function hashOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

let failures = 0
for (const name of repositories) {
  const directory = join(repositoriesRoot, name)
  const manifest = JSON.parse(readFileSync(join(directory, 'plugin.json'), 'utf8'))
  const data = JSON.parse(readFileSync(join(directory, 'data', 'manifest.json'), 'utf8'))

  const signatureStatus = await verifyPluginSignature(manifest)
  const legacy = { ...manifest }
  delete legacy.dataSourceVersion
  const legacyStatus = await verifyPluginSignature(legacy)

  const entryBytes = readFileSync(join(directory, 'plugin.js'))
  const entryChecksum = manifest.checksum['plugin.js']
  const entryOk =
    entryChecksum.sha256 === hashOf(entryBytes) && entryChecksum.size === entryBytes.length

  const shard = data.shards[0]
  const shardBytes = readFileSync(join(directory, 'data', shard.file))
  const shardOk =
    shard.sha256 === hashOf(shardBytes) &&
    shard.bytes === shardBytes.length &&
    shard.recordCount === data.recordCount
  const versionsOk = manifest.dataSourceVersion === data.dataVersion

  const checks = {
    签名: signatureStatus,
    旧宿主无展示字段: legacyStatus,
    入口字节: entryOk ? 'ok' : 'MISMATCH',
    数据分片: shardOk ? 'ok' : 'MISMATCH',
    三项版本对齐: versionsOk ? 'ok' : 'MISMATCH',
  }
  const ok =
    signatureStatus === 'verified' &&
    legacyStatus === 'verified' &&
    entryOk &&
    shardOk &&
    versionsOk
  if (!ok) failures += 1

  console.log(`${ok ? '✔' : '✗'} ${name}`)
  console.log(
    `   插件 v${manifest.version} · 数据源 v${manifest.dataSourceVersion} · 支持 MBD ≥ ${manifest.minHostVersion}`,
  )
  for (const [label, value] of Object.entries(checks)) {
    console.log(`   ${label}：${value}`)
  }
}

if (failures > 0) {
  console.error(`✗ ${String(failures)} 个仓库校验失败`)
  process.exitCode = 1
} else {
  console.log('✔ 两个插件仓库端到端校验通过')
}
