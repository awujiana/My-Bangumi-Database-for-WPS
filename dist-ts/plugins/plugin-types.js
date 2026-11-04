/**
 * @fileoverview 插件系统的共享类型与权限表
 * @module plugins/pluginTypes
 * @description 定义插件清单结构、权限枚举与人类可读说明。本模块只含数据与纯函数，
 *   不依赖 WPS、不依赖 i18n 运行时 —— 权限说明走语言包 key，由界面层翻译，
 *   与 `sheet-cleaning` 的 `skippedReasonKey` 同一套思路。
 */
/** 清单格式版本。宿主遇到更高版本会拒绝安装并提示升级宿主。 */
export const PLUGIN_SCHEMA_VERSION = 1;
/**
 * 插件可声明的权限。
 *
 * 顺序即界面展示顺序（读 → 写 → 联网 → 存储 → 界面），与 `PLUGIN-SPEC.md` §6 一致。
 */
export const PLUGIN_PERMISSIONS = [
    'sheet.read',
    'sheet.write',
    'data.read',
    'data.write',
    'net.fetch',
    'storage',
    'ui.toast',
    'ui.pane',
    'log',
];
/**
 * 权限 → 语言包 key 前缀。
 *
 * 界面用 `plugin.permission.<id>.name` / `.risk` 取译文；语言包缺 key 时退回
 * `PLUGIN_PERMISSION_FALLBACK` 的中文原文（与 `tOr` 的兜底策略一致）。
 */
export const PLUGIN_PERMISSION_KEY_PREFIX = 'plugin.permission.';
/** 权限的中文兜底文案（语言包未加载时显示） */
export const PLUGIN_PERMISSION_FALLBACK = {
    'sheet.read': { name: '读取工作表', risk: '可以读取你工作簿里的任何内容' },
    'sheet.write': { name: '修改工作表', risk: '可以修改或删除你工作簿里的内容' },
    'data.read': { name: '读取番组数据', risk: '可以读取你的番组记录' },
    'data.write': { name: '修改番组数据', risk: '可以修改你的番组记录' },
    'net.fetch': { name: '联网访问', risk: '会联网访问清单里列出的域名' },
    storage: { name: '本地存储', risk: '会在本机保存插件自己的数据' },
    'ui.toast': { name: '界面提示', risk: '会弹出提示、确认框与进度条' },
    'ui.pane': { name: '打开宿主页面', risk: '可以打开 MBD 的其他页面' },
    log: { name: '写入日志', risk: '会往日志面板写内容' },
};
/**
 * 唯一支持的签名算法。
 *
 * 选 ECDSA P-256 + SHA-256 而不是 Ed25519：WPS 内嵌的 CEF 版本不保证有 Ed25519，
 * 而 P-256 在 WebCrypto 里是必备算法。签名值用 IEEE P1363 的 raw `r||s`（64 字节），
 * 与 Node `crypto.sign(..., { dsaEncoding: 'ieee-p1363' })` 一致。
 */
export const PLUGIN_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256';
