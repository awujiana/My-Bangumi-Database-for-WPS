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
  "keyCount": 1400,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1400,
      "coverage": 100,
      "sha256": "4a256412984e1c26919fba1544a2d2f1e26a55b66e50b1c5eda0596c8f23467b",
      "bytes": 117290
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1400,
      "coverage": 100,
      "sha256": "7eb79d1f5fd07c7b5a762d10656e4bb7eb598e8b9511ae409bdc94c0247b7187",
      "bytes": 117635
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1400,
      "coverage": 100,
      "sha256": "320c3658dce2977a60f2fc01c106eac1953623d2fa36a3280f8cef871e808840",
      "bytes": 122216
    }
  ]
};
