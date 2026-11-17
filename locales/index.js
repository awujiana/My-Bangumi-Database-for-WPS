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
      "version": "2.5.1",
      "updatedAt": "2026-11-17T17:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "9c5d3f1b22c4a7b71eda04a1aa230501a669aaf04df6a4a3601fbb4b1f03e35d",
      "bytes": 167793
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.5.1",
      "updatedAt": "2026-11-17T17:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "b224c3412ca6619bd0954d1d346366ed2921984f1789183d627b683e85841c52",
      "bytes": 168279
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.5.1",
      "updatedAt": "2026-11-17T17:40",
      "keyCount": 2075,
      "coverage": 100,
      "sha256": "6aefc17193c117cab3553f225cd67b342ba3ddb1fe7518fb9ebeec9bd2831b50",
      "bytes": 173996
    }
  ]
};
