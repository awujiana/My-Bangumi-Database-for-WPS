#!/usr/bin/env node
/**
 * 探测窄任务窗格（默认 185px）下的**横向溢出元素**
 * 用法：node scripts/probe-overflow.mjs [页面名...] [宽度]
 */

import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const widthArg = args.find((a) => /^\d+$/.test(a))
const WIDTH = widthArg ? Number(widthArg) : 185
const pages = args.filter((a) => !/^\d+$/.test(a))
const PORT = 3893
const BASE = `http://127.0.0.1:${PORT}`

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, BASE).pathname)
    if (path.endsWith('/')) path += 'index.html'
    const data = await readFile(join(projectRoot, path), 'utf8')
    if (path.endsWith('.html')) {
      // 注入探针：① 去掉 CSP meta（否则内联脚本被 script-src 'self' 拦）② </body> 前插探针
      const stripped = data
        .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/gu, '')
        // 强制 layout viewport：headless 有最小窗口宽度（约 500px），185 会被截断
        .replace(/name="viewport"\s+content="[^"]*"/u, () => `name="viewport" content="width=${String(WIDTH)}"`)
        .replace(/content="width=device-width"\s+name="viewport"/u, () => `content="width=${String(WIDTH)}" name="viewport"`)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(stripped.replace(/<\/body>/u, `${PROBE}</body>`))
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404).end()
  }
})

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

/** 探针：800ms 后量出溢出元素并写回 DOM（dump-dom 拿结果） */
const PROBE = `
<script>
setTimeout(() => {
  const html = document.documentElement;
  const offenders = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (el.scrollWidth - html.clientWidth > 4 && el.getBoundingClientRect().width > 0) {
      offenders.push((el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '')) + ' sw=' + el.scrollWidth);
    }
  });
  const pre = document.createElement('pre');
  pre.id = '__overflowOut';
  pre.textContent = JSON.stringify({
    clientW: html.clientWidth,
    scrollW: html.scrollWidth,
    bodyScrollW: document.body ? document.body.scrollWidth : 0,
    offenders: offenders.slice(0, 12),
  });
  document.body.appendChild(pre);
}, 800);
</script>`

const pages_ = pages.length > 0 ? pages : ['clean', 'panel']

for (const page of pages_) {
  const html = await new Promise((resolve) => {
    execFile(
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--user-data-dir=C:/Users/Administrator/AppData/Local/Temp/chrome-diag',
        `--window-size=${String(WIDTH)},900`,
        '--virtual-time-budget=6000',
        '--dump-dom',
        `${BASE}/ui/${page}.html`,
      ],
      { timeout: 40000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout),
    )
  })
  const match = /<pre id="__overflowOut">([\s\S]*?)<\/pre>/u.exec(html)
  if (!match) {
    console.log(`${page}: 探针未回填（dump 长度 ${String(html.length)}）`)
    continue
  }
  const report = JSON.parse(
    match[1].replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&amp;/gu, '&'),
  )
  const isOverflow = report.scrollW - report.clientW > 4
  console.log(`\n=== ${page} @ ${String(WIDTH)}px ${isOverflow ? '⚠ 横向溢出' : '✓ 无溢出'} ===`)
  console.log(`  layoutViewport=${String(report.clientW)} scrollWidth=${String(report.scrollW)}`)
  if (report.offenders.length > 0) {
    console.log('  撑宽元素:')
    for (const line of report.offenders) console.log(`    - ${line}`)
  }
}

server.close()
process.exit(0)
