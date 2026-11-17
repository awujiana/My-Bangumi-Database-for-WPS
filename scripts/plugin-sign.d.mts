/**
 * `plugin-sign.mjs` 的类型声明。
 *
 * 宿主仓库是 CommonJS 包（`package.json` 无 `type`），工具脚本必须用 `.mjs`。
 * 而 `tests/*.ts` 会直接 import 它的 `buildPayload` 做「签名契约逐字节一致」断言，
 * 没有这份声明时 TS 把这个导入推成 `any`，类型检查规则会整片报错。
 */

import type { PluginManifest } from '../ts/plugins/plugin-types.js'

/** 生成待签名字符串（必须与宿主 `pluginSignaturePayload` 逐字节相同） */
export declare function buildPayload(manifest: PluginManifest): string

/** 按实际文件重算 checksum，返回**整份**清单（不是 checksum 表） */
export declare function computeChecksum(
  manifest: PluginManifest,
  manifestPath: string,
): PluginManifest

/** 唯一支持的算法标识 */
export declare const ALGORITHM: string
