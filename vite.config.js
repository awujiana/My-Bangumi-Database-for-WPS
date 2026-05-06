// vite.config.js
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { functionsScanner } from "wpsjs/vite_plugins"
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  base: './',
  root: '.',
  plugins: [
    functionsScanner({
      inputJsPath: 'js/functions.js',
      outputJsonPath: 'functions.json',
      namespace: 'HelloEt',
    }),
    viteStaticCopy({
      targets: [
        { 
          src: 'manifest.xml', 
          dest: '.',
          transform: (contents) => contents.toString().replace(/ui\/taskpane\.html/g, 'taskpane.html')
        },
        { 
          src: 'ribbon.xml', 
          dest: '.',
          transform: (contents) => contents.toString().replace(/ui\/taskpane\.html/g, 'taskpane.html')
        },
        { src: 'images/**/*', dest: 'images' },
        { src: 'ui/**/*', dest: 'ui' },
        { src: 'main.js', dest: '.' },
        { 
          src: 'node_modules/wpsjs-rpc-sdk-new/wpsjsrpcsdk.js', 
          dest: '.',
          rename: 'wpsjsrpcsdk.js'  // 确保重命名为正确的名字
        }
      ],
      silent: false
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./js', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3889
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        taskpane: 'ui/taskpane.html'
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'main') return 'assets/[name].js';
          return 'assets/[name].[hash].js';
        },
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'taskpane.html') {
            return '[name][extname]';
          }
          return 'assets/[name].[hash][extname]';
        }
      },
      // 将 WPS SDK 设为外部依赖，不进行打包
      external: ['wpsjsrpcsdk.js']
    }
  }
})