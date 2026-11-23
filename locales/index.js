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
      "updatedAt": "2026-11-23T21:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "ab7ea1d0b7c3dcbe8dcee13b97a4152aaf6637e793b1d411da49c9ed7b3a5d23",
      "bytes": 167793
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.6.0",
      "updatedAt": "2026-11-23T21:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "3ee798ac99a3f3d3ca0c63b7814d14f7f4ffb7e0f71bf30b5bf33a19db566676",
      "bytes": 168279
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.6.0",
      "updatedAt": "2026-11-23T21:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "45c93ba7c8e07326b746a31a5dabe4b43591aed9fba4c59c29a4cd7972b3a9ab",
      "bytes": 173996
    }
  ]
};
