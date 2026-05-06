import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { functionsScanner } from "wpsjs/vite_plugins"
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
    base: './',
    plugins: [
        functionsScanner({
            inputJsPath: 'js/functions.js',
            outputJsonPath: 'functions.json',
            namespace: 'HelloEt',
        }),
        viteStaticCopy({
            targets: [
                { src: 'manifest.xml', dest: '.' },
                { src: 'ribbon.xml', dest: '.' },
                { src: 'images', dest: '.' },
                { src: 'ui', dest: '.' },
                { src: 'js', dest: '.' },
                { src: 'main.js', dest: '.' },
                { src: 'node_modules/wpsjs-rpc-sdk-new/wpsjsrpcsdk.js', dest: '.' }
            ]
        })
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        host: '0.0.0.0',
        port: 3891   // 与 package.json dev 脚本的 3889 统一？按实际情况保留一个即可，这里保持 3891
    }
})