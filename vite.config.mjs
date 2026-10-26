// vite.config.js
/* global URL */
// 说明：Vite 构建配置，仅用于 `npm run build` 打包时使用
// 开发调试请用 `npm run debug`（wpsjs），不使用 Vite 服务器
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  // 关闭 SPA 回退：开发服务器对缺失的静态文件直接 404（响亮报错），
  // 而不是静默返回 index.html（HTTP 200 / text/html），否则 main.js 加载的
  // dist-ts/*.js 缺失时会被当成 HTML，出现「MIME 拒绝」式误导。
  appType: 'custom',
  base: './',                              // 相对路径基础
  root: '.',                               // 项目根目录
  plugins: [
    viteStaticCopy({                       // 构建时将指定文件复制到 dist
      targets: [
        { src: 'manifest.xml', dest: '.' },// WPS 加载项清单
        { src: 'ribbon.xml', dest: '.' },   // 功能区按钮配置
        // 修复嵌套问题：src 保留完整路径，dest 是前缀
        // 原 { src: 'images/*', dest: 'images' } 会复制到 dist/images/images/，导致路径错误
        { src: 'images/*', dest: '.' },     // 按钮图标 → dist/images/*.svg
        { src: 'ui/*', dest: '.' },         // 任务面板 HTML → dist/ui/panel.html
        { src: 'main.js', dest: '.' },      // 动态模块加载器
        { src: 'node_modules/wpsjs-rpc-sdk-new/wpsjsrpcsdk.js', dest: '.' }, // WPS SDK
        // 新增：复制 dist-ts 目录（TS 编译产物，main.js 和 panel.html 均依赖）
        { src: 'dist-ts/**/*.js', dest: '.' }, // → dist/dist-ts/core/constants.js 等
        // 新增：复制 css 目录（panel.html 通过 ../css/ 引用）
        { src: 'css/*', dest: '.' },           // → dist/css/styles.css
        // 新增：复制 libs 目录（purify.js 等，panel.html 通过 ../libs/ 引用）
        { src: 'libs/*', dest: '.' }           // → dist/libs/purify.js
      ]
    })
  ],
  resolve: {
    alias: {
      // 路径别名：@/ 映射到 ts/ 目录，与 tsconfig.json 的 paths 保持一致
      '@': fileURLToPath(new URL('./ts', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',                       // 允许局域网访问
    // 注意：务必与 wpsjs debug 的端口（默认 3889）错开，避免两者抢同一端口——
    // 否则 vite 占用 3889 后 wpsjs 启动失败，WPS 仍连到 vite 触发 SPA 回退。
    port: 5173,                            // 开发服务器端口（仅 `npm run dev`，与 debug 的 3889 错开）
    fs: {
      allow: ['.']                         // 允许访问项目根目录外的文件
    }
  },
  build: {
    outDir: 'dist',                        // 构建输出目录
    emptyOutDir: true,                     // 构建前清空输出目录
    rollupOptions: {
      input: { main: 'index.html' },       // 入口 HTML
      output: {
        entryFileNames: 'assets/[name].[hash].js',     // 入口 JS 命名
        chunkFileNames: 'assets/[name].[hash].js',     // 代码分块命名
        assetFileNames: 'assets/[name].[hash][extname]'// 资源文件命名
      }
    }
  }
})
