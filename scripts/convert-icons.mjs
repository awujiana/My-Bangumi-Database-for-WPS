/**
 * 将 images 目录下的 SVG 图标批量转换为 PNG
 * WPS Ribbon getImage 使用 GDI+（IPictureDisp），只支持位图格式
 * 因此 SVG 必须先栅格化为 PNG 才能在 Ribbon 按钮上正常显示
 *
 * 用法：node scripts/convert-icons.mjs [size]
 *   size: 输出 PNG 边长（像素，默认 64）
 */
import { Resvg } from '@resvg/resvg-js'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, parse, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const SRC_DIR = join(ROOT, 'images')
const SIZE = parseInt(process.argv[2] || '64', 10)

function convertOne(svgPath, pngPath, size) {
  const svgContent = readFileSync(svgPath, 'utf-8')
  // 使用 resvg 渲染 SVG；fitTo 保证等比缩放到 size×size 的画布中央
  const opts = {
    fitTo: {
      mode: 'width', // 先按宽度缩放，高度会按比例计算
      value: size,
    },
    font: {
      fontFiles: [],
      loadSystemFonts: false,
      defaultFontFamily: 'sans-serif',
    },
    shapeRendering: 2, // optimizeQuality
    textRendering: 2,
    imageRendering: 1, // optimizeQuality
    logLevel: 'error',
  }
  const resvg = new Resvg(svgContent, opts)
  // 计算原始 SVG 的固有尺寸，再手动决定 fitTo 模式
  const computed = resvg.computeBBox()
  // 若原始宽高比 > 1（宽>高），按宽度缩放；否则按高度
  const bbox = computed || { width: size, height: size }
  const ratio = (bbox.width || size) / (bbox.height || size)
  // 重新构造以最长边为准的 fitTo 选项
  let resvg2
  if (ratio >= 1) {
    resvg2 = new Resvg(svgContent, { ...opts, fitTo: { mode: 'width', value: size } })
  } else {
    resvg2 = new Resvg(svgContent, { ...opts, fitTo: { mode: 'height', value: size } })
  }
  const rendered = resvg2.render()
  const imgW = rendered.width
  const imgH = rendered.height
  // 将渲染出的 RGBA 位图居中粘贴到透明的 size×size 画布
  const outPixels = new Uint8ClampedArray(size * size * 4).fill(0)
  const srcPixels = rendered.pixels
  const srcStride = imgW * 4
  const dstStride = size * 4
  const ox = Math.round((size - imgW) / 2)
  const oy = Math.round((size - imgH) / 2)
  for (let y = 0; y < imgH; y++) {
    const srcOff = y * srcStride
    const dstOff = (oy + y) * dstStride + ox * 4
    outPixels.set(srcPixels.subarray(srcOff, srcOff + srcStride), dstOff)
  }
  // 构造 PNG：使用最小 PNG 编码器（避免新依赖）
  const pngBuffer = encodePng(outPixels, size, size)
  writeFileSync(pngPath, pngBuffer)
  console.log(`  ✓ ${parse(svgPath).name}.svg  →  ${parse(pngPath).base} (${imgW}x${imgH}@${size}x${size})`)
}

// ============= 最小 PNG 编码器 =============
// 仅支持 8-bit RGBA，依赖 node:zlib
import { deflateSync } from 'node:zlib'
import { Buffer } from 'node:buffer'

function crc32(buf) {
  let crc = -1
  const table = (crc32.table ||= (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })())
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type: RGBA
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace
  // 原始图像数据：每行前加 1 字节 filter type = 0
  const rowLen = w * 4
  const raw = Buffer.alloc(h * (rowLen + 1))
  for (let y = 0; y < h; y++) {
    const off = y * (rowLen + 1)
    raw[off] = 0
    raw.set(Buffer.from(rgba.buffer, rgba.byteOffset + y * rowLen, rowLen), off + 1)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}
// ==========================================

async function main() {
  console.log(`[convert-icons] 从 ${SRC_DIR} 读取 SVG，输出 PNG ${SIZE}x${SIZE}`)
  if (!existsSync(SRC_DIR)) {
    console.error('images 目录不存在！')
    process.exit(1)
  }
  const files = readdirSync(SRC_DIR).filter(f => extname(f).toLowerCase() === '.svg')
  console.log(`[convert-icons] 发现 ${files.length} 个 SVG 文件`)
  for (const f of files) {
    const svgPath = join(SRC_DIR, f)
    const pngPath = join(SRC_DIR, `${parse(f).name}.png`)
    try {
      convertOne(svgPath, pngPath, SIZE)
    } catch (e) {
      console.error(`  ✗ ${f} 转换失败: ${e.message}`)
      process.exitCode = 1
    }
  }
  console.log('[convert-icons] 完成')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
