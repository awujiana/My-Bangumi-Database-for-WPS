/**
 * @fileoverview 插件清单的签名校验
 * @module plugins/pluginSignature
 * @description 验的是「清单签名」：签名覆盖 id / version / entry / 权限 / 域名白名单 /
 *   每个文件的 sha256。所以验签通过即等价于「这份清单，以及它指向的 plugin.js，
 *   都出自持有该私钥的作者」—— 不需要再对代码本身单独签名。
 *
 *   环境没有 WebCrypto 时返回 `unsupported`，**不冒充**「已验证」；界面按未签名处理，
 *   与更新链路的降级策略一致（缺能力就退化成人工确认，不是静默放行）。
 */
import { pluginSignaturePayload } from './plugin-manifest.js'
import { PLUGIN_SIGNATURE_ALGORITHM } from './plugin-types.js'
import type { PluginManifest, PluginSignatureStatus } from './plugin-types.js'

/**
 * 宿主内置的可信公钥表：`keyId` → base64 的 SPKI DER（ECDSA P-256）。
 *
 * 加新作者 = 在这里加一行 + 发版。不做「用户自选公钥」：那等于把信任决策
 * 转嫁给看不懂公钥的用户，还不如老实提示「未验证，是否无视风险安装」。
 */
export const TRUSTED_PLUGIN_KEYS: Readonly<Record<string, string>> = {
  'awujiana-2026':
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAETcRan68mI5Ss5GfV4aPQxjNbFNG7hf1xMEeVePgwAWez6wPNvopTpTWDNuqHa96SNbCnoIMMOtBIb6n47TF3pw==',
}

/** 取 WebCrypto 的 subtle（拿不到返回 null） */
function getSubtle(): SubtleCrypto | null {
  const host = globalThis as unknown as { crypto?: Crypto }
  return host.crypto?.subtle ?? null
}

/** base64 → 字节（非法 base64 返回 null） */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    // eslint-disable-next-line unicorn/prefer-uint8array-base64 -- `Uint8Array.fromBase64` 需要 Chrome 140+，WPS 内嵌 CEF 达不到；atob 是 ES5 起就有的唯一安全选择
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    let index = 0
    for (const character of binary) {
      bytes[index] = character.codePointAt(0) ?? 0
      index += 1
    }
    return bytes
  } catch {
    return null
  }
}

/**
 * 校验清单签名。
 *
 * @param trustedKeys 可信公钥表，默认用内置表；单测注入自造密钥
 * @returns `verified` 之外的所有结论都需要用户二次确认才能安装
 */
export async function verifyPluginSignature(
  manifest: PluginManifest,
  trustedKeys: Readonly<Record<string, string>> = TRUSTED_PLUGIN_KEYS,
): Promise<PluginSignatureStatus> {
  const { signature } = manifest
  if (signature === undefined) return 'unsigned'
  if (signature.algorithm !== PLUGIN_SIGNATURE_ALGORITHM) return 'invalid'
  const keyBase64 = trustedKeys[signature.keyId]
  if (keyBase64 === undefined) return 'untrusted-key'

  const subtle = getSubtle()
  if (subtle === null) return 'unsupported'

  const keyBytes = base64ToBytes(keyBase64)
  const signatureBytes = base64ToBytes(signature.value)
  if (keyBytes === null || signatureBytes === null) return 'invalid'

  try {
    const key = await subtle.importKey(
      'spki',
      keyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const payload = new TextEncoder().encode(pluginSignaturePayload(manifest))
    const isValid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signatureBytes,
      payload,
    )
    return isValid ? 'verified' : 'invalid'
  } catch {
    return 'invalid'
  }
}
