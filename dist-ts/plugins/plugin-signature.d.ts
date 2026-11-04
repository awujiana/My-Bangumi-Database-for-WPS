import type { PluginManifest, PluginSignatureStatus } from './plugin-types.js';
/**
 * 宿主内置的可信公钥表：`keyId` → base64 的 SPKI DER（ECDSA P-256）。
 *
 * 加新作者 = 在这里加一行 + 发版。不做「用户自选公钥」：那等于把信任决策
 * 转嫁给看不懂公钥的用户，还不如老实提示「未验证，是否无视风险安装」。
 */
export declare const TRUSTED_PLUGIN_KEYS: Readonly<Record<string, string>>;
/** base64 → 字节（非法 base64 返回 null） */
export declare function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null;
/**
 * 校验清单签名。
 *
 * @param trustedKeys 可信公钥表，默认用内置表；单测注入自造密钥
 * @returns `verified` 之外的所有结论都需要用户二次确认才能安装
 */
export declare function verifyPluginSignature(manifest: PluginManifest, trustedKeys?: Readonly<Record<string, string>>): Promise<PluginSignatureStatus>;
//# sourceMappingURL=plugin-signature.d.ts.map