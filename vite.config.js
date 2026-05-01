import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import { functionsScanner, copyFile } from "wpsjs/vite_plugins"

// https://vitejs.dev/config/
export default defineConfig({
    base: './',
    plugins: [
        copyFile({ src: 'manifest.xml', dest: 'manifest.xml', }),
        copyFile({ src: 'js', dest: 'js', }),
        copyFile({ src: 'images', dest: 'images', }),
        copyFile({ src: 'ui', dest: 'ui', }),
        copyFile({ src: 'main.js', dest: 'main.js', }),
        copyFile({ src: 'ribbon.xml', dest: 'ribbon.xml', }),
        functionsScanner({
            inputJsPath: 'js/functions.js',
            outputJsonPath: 'functions.json',
            namespace: 'HelloEt',
        }),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        host: '0.0.0.0',
        port: 3891,
        // 调试通知功能：/debugTemp/NotifyDemoUrl 路由
        setup(devServer) {
            devServer.middlewares.use('/.debugTemp/NotifyDemoUrl', (req, res) => {
                const timestamp = new Date().toLocaleString('zh-CN');
                const html = `
                    <div style="font-family: Arial, sans-serif; padding: 20px; background: #f0f0f0;">
                        <h2 style="color: #27ae60;">✓ WPS 加载项调试模式</h2>
                        <p><strong>通知时间:</strong> ${timestamp}</p>
                        <p><strong>状态:</strong> 开发服务器运行中</p>
                        <p><strong>提示:</strong> 您可以正常进行调试操作</p>
                    </div>
                `;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(html);
            });

            // 额外的调试端点
            devServer.middlewares.use('/.debugTemp/Ping', (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    status: 'ok',
                    timestamp: new Date().toISOString(),
                    message: 'WPS 调试服务器运行正常'
                }));
            });
        }
    }
})
