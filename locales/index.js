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
  "keyCount": 576,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 576,
      "coverage": 100,
      "sha256": "7af9a325bfd21b6c23a264c2756a80d2b8682ce3d9c866121ab15a2737d2fe4f",
      "bytes": 50062
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 576,
      "coverage": 100,
      "sha256": "bb164561854dada7bdbe612c7007f8373083d035cf4270a0a582f2c93d651ff3",
      "bytes": 50226
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 576,
      "coverage": 100,
      "sha256": "7832f7bd28f2dce9f8f9fd13e7a24011e53c67ae03f02cac137e31ff17d38dfa",
      "bytes": 51862
    }
  ]
};
