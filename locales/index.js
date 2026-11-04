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
  "keyCount": 2008,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.5.0",
      "updatedAt": "2026-11-04T21:36",
      "keyCount": 2008,
      "coverage": 100,
      "sha256": "fee09d9bfa34054007a3be59acdd820feab9e8ec09178feb6bdea86a7325a3ef",
      "bytes": 164360
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.5.0",
      "updatedAt": "2026-11-04T21:36",
      "keyCount": 2008,
      "coverage": 100,
      "sha256": "bde8a9add05be80e8a0045941906b41d3c4f81c89da9b4b89f603802a3f362ce",
      "bytes": 164816
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.5.0",
      "updatedAt": "2026-11-04T21:36",
      "keyCount": 2008,
      "coverage": 100,
      "sha256": "04d9c7d6717261bdc14875c4e639850c98f7d02fa47c5933a755b06d5c8e11d3",
      "bytes": 170550
    }
  ]
};
