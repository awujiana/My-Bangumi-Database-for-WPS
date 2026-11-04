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
      "version": "2.5.1",
      "updatedAt": "2026-11-04T21:57",
      "keyCount": 2008,
      "coverage": 100,
      "sha256": "226a080fae7304c305c54b561136cfeeb93a1cd0036e6b69006f07887acb6e92",
      "bytes": 164360
    },
    {
      "code": "zh-TW",
      "name": "Traditional Chinese",
      "nativeName": "繁體中文",
      "version": "2.5.1",
      "updatedAt": "2026-11-04T21:57",
      "keyCount": 2008,
      "coverage": 100,
      "sha256": "4333b397bc1afe5c797b935897851b4c52510290f008b97840e49696d94ad1d1",
      "bytes": 164816
    },
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "version": "2.5.1",
      "updatedAt": "2026-11-04T21:57",
      "keyCount": 2008,
      "coverage": 100,
      "sha256": "9a9b9c06531cc90dc62eb409cfd10dd5e0f2c0582141bdcf24e93d63ccc143a5",
      "bytes": 170550
    }
  ]
};
