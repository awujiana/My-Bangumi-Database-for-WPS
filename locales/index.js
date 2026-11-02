/**
 * 语言包清单（**生成物，别手改**）。
 *
 * 由 `npm run i18n:index`（`scripts/gen-locale-index.mjs`）从 `locales/*/locale.js` 算出，
 * `check:i18n` 会校验它是否与实际文件一致——手改会在门禁里红。
 *
 * 为什么是 `.js` 不是 `.json`：安装态页面跑在 `file://` 下，`fetch` 读本地文件
 * 会被 CEF 拦掉，只有 ESM 的 `import()` 能读。内容仍是纯数据，不含任何逻辑。
 *
 * `sha256` / `bytes` 按 **LF 归一后**的内容计算：工作区是 CRLF 检出，
 * 发布出去的是 LF，只有归一后的值才和用户下载到的字节对得上。
 */
export default {
  "schemaVersion": 1,
  "sourceLocale": "zh-CN",
  "keyCount": 1609,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1609,
      "coverage": 100,
      "sha256": "8d6a2fc3e10ddc70d1bc3e74fc16fe290d2c2ac698eb832107409695bc3a4193",
      "bytes": 133594
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1609,
      "coverage": 100,
      "sha256": "92db7242b02550f2c47373fda1684a63ca2093547a74e8b91db9be1a232c4e34",
      "bytes": 133981
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1609,
      "coverage": 100,
      "sha256": "2e25792451ca6f36921b930ab5e2225843e73cfe364dc21e32ba2c704c06311d",
      "bytes": 139048
    }
  ]
};
