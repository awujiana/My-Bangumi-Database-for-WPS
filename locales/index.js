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
  "keyCount": 1381,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1381,
      "coverage": 100,
      "sha256": "29ce9f5dde5aefa0d5eb99dcbccf4d6240d581b5c102721199b4f345f62e3f2f",
      "bytes": 115846
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1381,
      "coverage": 100,
      "sha256": "f0d218dce3ef1f4f79cfa93cf291907afca48ea3bd7eecdc53876d9feaf7a937",
      "bytes": 116191
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1381,
      "coverage": 100,
      "sha256": "667abf365c3da363c1b21ecc408c8405b405a27d2496a2187dcffefb739dd343",
      "bytes": 120803
    }
  ]
};
