// vite.config.js
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { functionsScanner } from "wpsjs/vite_plugins"
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
    rollupOptions: {
      input: {
        main: 'index.html',
        taskpane: 'ui/taskpane.html'
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]'
      }
    }
  }
})