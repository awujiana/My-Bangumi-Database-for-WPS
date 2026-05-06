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
        { src: 'node_modules/wpsjs-rpc-sdk-new/wpsjsrpcsdk.js', dest: '.' }
      ],
      silent: false
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./js', import.meta.url))
    },
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.json']
  },
  server: {
    host: '0.0.0.0',
    port: 3889,
    cors: true,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      input: {
        main: 'index.html',
        taskpane: 'ui/taskpane.html'
      },
      output: {
        // 分离第三方库
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
        entryFileNames: (chunkInfo) => {
          // 主入口文件保持原名
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
      }
    }
  }
})