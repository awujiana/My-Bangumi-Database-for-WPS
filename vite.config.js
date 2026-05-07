// vite.config.js
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  base: './',
  root: '.',
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'manifest.xml', dest: '.' },
        { src: 'ribbon.xml', dest: '.' },
        { src: 'images/*', dest: 'images' },
        { src: 'ui/*', dest: 'ui' },
        { src: 'main.js', dest: '.' },
        { src: 'node_modules/wpsjs-rpc-sdk-new/wpsjsrpcsdk.js', dest: '.' }
      ]
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html'
        // 移除 taskpane.html 入口，它由 viteStaticCopy 直接复制
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]'
      }
    }
  }
})