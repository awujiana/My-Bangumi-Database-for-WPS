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
  "keyCount": 480,
  "locales": [
    {
      "code": "zh-CN",
      "name": "Simplified Chinese",
      "nativeName": "简体中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 480,
      "coverage": 100,
      "sha256": "efccdca0456dbacc05cb68772b9dbbb79fba8186ae2d5bf2f13fd482b3d29290",
      "bytes": 42400
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 480,
      "coverage": 100,
      "sha256": "2394f1b3898529d1c5fd9f07b136248463399d71d846e11431ac9ad94d6d1e53",
      "bytes": 42555
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.3.0",
      "updatedAt": "2026-11-01",
      "keyCount": 480,
      "coverage": 100,
      "sha256": "a619cd5a3a0c7e8ab2a8045c8aa95a4c5e429888873014aa2b05b85eda83c9f0",
      "bytes": 43951
    }
  ]
};
