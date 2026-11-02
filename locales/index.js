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
  "keyCount": 1858,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1858,
      "coverage": 100,
      "sha256": "b5bbcd13b56b32258055dce47f8fe219106ea1d5e57a1509086b0ae4926468c0",
      "bytes": 153681
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1858,
      "coverage": 100,
      "sha256": "71e2d6e7ff586a3c9e3b2fefbf8ce6984a6d62e57704acedae4ba4cebedbbecf",
      "bytes": 154095
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.4.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1858,
      "coverage": 100,
      "sha256": "36f18980213824bd0c57ed07006435083538400dd58925645f9dc3e4ab9aac8a",
      "bytes": 160077
    }
  ]
};
