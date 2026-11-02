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
  "keyCount": 1860,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1860,
      "coverage": 100,
      "sha256": "0067a04336ec6757cf6ed687294b1ae1de176045ea455b971a75f503000fe9d5",
      "bytes": 153916
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1860,
      "coverage": 100,
      "sha256": "ee3e23bff1a0a07a8c6d537b9a8f0b875affbbe6e19f162687719618fa5a0db0",
      "bytes": 154330
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1860,
      "coverage": 100,
      "sha256": "a31daba20fdb35dec3ddb3a1e04a8dafbca760b15ccdf53a6becdc162d9f5d12",
      "bytes": 160330
    }
  ]
};
