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
  "keyCount": 1944,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1944,
      "coverage": 100,
      "sha256": "fae5456b6b7c3742c7e57b86ba3099c5b0375db22e59aaaf035ddb70049a74fe",
      "bytes": 159665
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1944,
      "coverage": 100,
      "sha256": "969c9d1d1adf5d029075d0b4e889968332aa88cd1a21cf5286ba693667217cc6",
      "bytes": 160094
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1944,
      "coverage": 100,
      "sha256": "eb0345e65a65b9afa507c70ecf66f9a2b442c247e9f44966ea73453b00ba0b90",
      "bytes": 165861
    }
  ]
};
