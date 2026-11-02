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
  "keyCount": 1405,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1405,
      "coverage": 100,
      "sha256": "19a7fb5be070704c48b1c64585f5f9605db54e856c80c3f186991dbf48b9ea12",
      "bytes": 117545
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1405,
      "coverage": 100,
      "sha256": "16f736ff8048b817ae4e31553912307a7839770636d6eebc36b1d3e45db1d965",
      "bytes": 117890
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-02",
      "keyCount": 1405,
      "coverage": 100,
      "sha256": "baa97bf474dd1fd6f927360f95488c23c659ba138b7fd1e0921de85d97de67da",
      "bytes": 122698
    }
  ]
};
