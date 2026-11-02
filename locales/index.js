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
  "keyCount": 1923,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1923,
      "coverage": 100,
      "sha256": "9cc9351618138f2bd4538999cebe654140c352d1cff1dc9c67626f139bb3045b",
      "bytes": 158252
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1923,
      "coverage": 100,
      "sha256": "1659004137ce2a7e9f161f3183b866e1b494e8b29957f8b35deec7143833ba76",
      "bytes": 158678
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1923,
      "coverage": 100,
      "sha256": "873ac05a271fd51ac22f88ce06d4dfd788968116e37f8a1f9f0020376f4f0a43",
      "bytes": 164478
    }
  ]
};
