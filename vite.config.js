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
        { src: 'ui/**/*.html', dest: 'ui' },
        { src: 'main.js', dest: '.' },
        { src: 'node_modules/wpsjs-rpc-sdk-new/wpsjsrpcsdk.js', dest: '.' },
        // 单独处理 taskpane.html，确保路径正确
        { 
          src: 'ui/taskpane.html', 
          dest: '.',
          rename: 'taskpane.html',
          transform: (contents) => {
            let html = contents.toString();
            // 确保路径正确
            html = html.replace('src="./wpsjsrpcsdk.js"', 'src="./wpsjsrpcsdk.js"');
            return html;
          }
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
      }
    }
  }
})