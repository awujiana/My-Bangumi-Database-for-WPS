/**
 * @fileoverview 富化页面启动入口
 * @module ui/enrich-bootstrap
 * @description 绑定富化页面初始化逻辑，在 DOM 就绪后调用 initEnrichPage()。
 *
 * 注意：参考 taskpane-bootstrap.js 和 settings-bootstrap.js 的模式，
 * bootstrap 文件从 dist-ts/ 目录导入已编译的模块。
 */

import { initEnrichPage } from '../dist-ts/taskpane/enrich.js'

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initEnrichPage()
  })
} else {
  initEnrichPage()
}