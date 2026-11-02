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
  "keyCount": 1876,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1876,
      "coverage": 100,
      "sha256": "5529a3781f06f382aa066f58c12e81d37b7fc8d3c98e30787600ebcc427888a2",
      "bytes": 155002
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1876,
      "coverage": 100,
      "sha256": "02afa0681e3ec6b83725b9db1cadaa5ac96f1ed7a58b907ae6c535c30c9bbb50",
      "bytes": 155419
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1876,
      "coverage": 100,
      "sha256": "41fe4d2041371220a15ef2291fba282da3240d87be867a819ab61cba13076fe2",
      "bytes": 161426
    }
  ]
};
