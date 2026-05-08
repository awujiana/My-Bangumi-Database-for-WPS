// vite.config.js
// 说明：Vite 构建配置，仅用于 `npm run build` 打包时使用
// 开发调试请用 `npm run debug`（wpsjs），不使用 Vite 服务器
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  base: './',                              // 相对路径基础
  root: '.',                               // 项目根目录
  plugins: [
    viteStaticCopy({                       // 构建时将指定文件复制到 dist
      targets: [
        { src: 'manifest.xml', dest: '.' },// WPS 加载项清单
        { src: 'ribbon.xml', dest: '.' },   // 功能区按钮配置
        { src: 'images/*', dest: 'images' },// 按钮图标
        { src: 'ui/*', dest: 'ui' },        // 任务面板 HTML + 样式
        { src: 'main.js', dest: '.' },      // 动态模块加载器
        { src: 'node_modules/wpsjs-rpc-sdk-new/wpsjsrpcsdk.js', dest: '.' } // WPS SDK
      ]
    })
  ],
  server: {
    host: '0.0.0.0',                       // 允许局域网访问
    port: 3889,                            // 开发服务器端口（仅 `npm run dev`）
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