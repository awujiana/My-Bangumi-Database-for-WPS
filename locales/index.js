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
      "version": "2.4.1",
      "updatedAt": "2026-11-02",
      "keyCount": 1944,
      "coverage": 100,
      "sha256": "ceaf13e451ac2a79d2d9cd88f177624ac80d5fd682db67c6548aee7dac8d1d1e",
      "bytes": 159665
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.4.1",
      "updatedAt": "2026-11-02",
      "keyCount": 1944,
      "coverage": 100,
      "sha256": "912618c02a515cdb71c85d9908e41b84b38decaca5583f67405b9609f81bda0c",
      "bytes": 160094
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.4.1",
      "updatedAt": "2026-11-02",
      "keyCount": 1944,
      "coverage": 100,
      "sha256": "9f974deb84840dfe9c8fac2e879f1eb0abb23197de039d8cfa4eef825edcf1d9",
      "bytes": 165861
    }
  ]
};
