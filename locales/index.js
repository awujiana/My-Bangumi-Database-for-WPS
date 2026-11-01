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
  "keyCount": 415,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 415,
      "coverage": 100,
      "sha256": "38ff13bd5e5c6c4e53d4451a3f6e5631425fbca16835479d7362ddd9fd7f9cfa",
      "bytes": 37430
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 415,
      "coverage": 100,
      "sha256": "4e49508aa2f6489c5a99ab3f6cddd06e566e64f0fcc60d7a98689314a377e19a",
      "bytes": 37558
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 415,
      "coverage": 100,
      "sha256": "d2a3348ca7ed070a0f40e6ae30a0b7fdccc6454cfd0abeae2873dd5d5998cd26",
      "bytes": 38737
    }
  ]
};
