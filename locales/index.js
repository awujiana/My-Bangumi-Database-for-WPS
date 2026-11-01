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
  "keyCount": 797,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 797,
      "coverage": 100,
      "sha256": "e48c1b3eac76ed1025946a31278b23b35b0af4b7982690f1f2b5f76e96959473",
      "bytes": 64379
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 797,
      "coverage": 100,
      "sha256": "55cbadac6e3236c68a820dcd44865611d0bb9f3a733c77acd7f03693a22615a7",
      "bytes": 64601
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 797,
      "coverage": 100,
      "sha256": "9a1ef857ede022200647ddc3455e67812274a7057fc430aa2b8b9d26e3ff5ad1",
      "bytes": 66092
    }
  ]
};
