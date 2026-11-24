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
  "keyCount": 2075,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.6.0",
      "updatedAt": "2026-11-24T13:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "b0da207b0f951a992123cd45da9f55371097ca55d1e780d8904b1c0dc3932ca1",
      "bytes": 167805
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.6.0",
      "updatedAt": "2026-11-24T13:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "12e84bffec6be6f1b62496fcac0df3211f24c7834e811ffa68cc3f9758034cef",
      "bytes": 168291
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.6.0",
      "updatedAt": "2026-11-24T13:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "a0a44d6cbb063e1357c7d8a4a5f367f723a1c4f1aeadad7bdc7b6395536057e0",
      "bytes": 174008
    }
  ]
};
