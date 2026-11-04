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
  "keyCount": 2003,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.5.0",
      "updatedAt": "2026-11-04",
      "keyCount": 2003,
      "coverage": 100,
      "sha256": "32146c7703ff87dda2b508a122388e334d4903aff5c294e7604656445367b940",
      "bytes": 163823
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.5.0",
      "updatedAt": "2026-11-04",
      "keyCount": 2003,
      "coverage": 100,
      "sha256": "e57dd891ae9910b7c34f188618bd59e48af281003ec3abb8c23e03b59000acf7",
      "bytes": 164279
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.5.0",
      "updatedAt": "2026-11-04",
      "keyCount": 2003,
      "coverage": 100,
      "sha256": "c469907e2b62d9c38f800135fe84e2ffcc8bf090cc8cd59e3332aba5a69e5458",
      "bytes": 170001
    }
  ]
};
