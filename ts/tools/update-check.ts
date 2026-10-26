/**
 * @fileoverview 从 GitHub Release 检查更新 / 下载更新包（纯逻辑 + 网络，零 WPS 依赖）
 * @module tools/update-check
 * @description
 *   流程：查 `releases/latest` → 比对版本 → 下载 zip（带进度回调）。
 *
 *   为什么只做到「下载」而不自动覆盖加载项目录：任务窗格运行期覆盖自身文件
 *   可能因文件锁失败、且半途失败会把插件写坏。下载完成后由页面给出「关闭 WPS
 *   → 解压覆盖 → 重新打开」的明确指引，把破坏性操作交给用户确认。
 *
 *   版本号口径：去掉 `v` 前缀，按 `.` / `-` / `+` 切段，逐段比数字；缺失段按 0
 *   处理（`2.1` == `2.1.0`），预发布后缀（`2.1.0-beta.1`）按数字段继续比较。
 */

/** 当前插件版本（与 package.json / manifest.xml 的展示版本保持一致） */
export const CURRENT_VERSION = '2.1.0'

/** 更新来源仓库 */
export const UPDATE_OWNER = 'awujiana'
export const UPDATE_REPO = 'My-Bangumi-Database-for-WPS'

/** GitHub 最新 Release 接口 */
const RELEASE_API = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`

/**
 * API 不可用时的兜底版本来源。
 *
 * `api.github.com` 未认证请求按 IP 限流（60 次/小时），超限返回 403；
 * 部分网络环境下还会被拦截。`raw.githubusercontent.com` 允许跨域且不限流，
 * 因此用主分支 package.json 的 version 作为兜底。
 * 注意：主分支版本可能领先于已发布 Release，故兜底只用于「提示有更新」，
 * 资产地址按仓库既有的 `vX.Y.Z` 命名约定拼接。
 */
const RAW_PACKAGE_JSON = `https://raw.githubusercontent.com/${UPDATE_OWNER}/${UPDATE_REPO}/main/package.json`

/** raw package.json 的最小读取子集 */
interface RawPackageJson {
  version?: string
}

/** 按命名约定构造发布包信息（用于 API 限流时的兜底） */
function buildReleaseFromVersion(version: string): ReleaseInfo {
  const tag = version.startsWith('v') ? version : `v${version}`
  const assetName = `${UPDATE_REPO}-${tag}.zip`
  return {
    version: tag,
    notes: '',
    publishedAt: '',
    htmlUrl: `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/tag/${tag}`,
    asset: {
      name: assetName,
      size: 0,
      downloadUrl: `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/download/${tag}/${assetName}`,
    },
  }
}

/** 从 raw.githubusercontent.com 读取 package.json 版本（无 API 限流） */
async function fetchLatestReleaseFromRaw(fetchFunction: typeof fetch): Promise<ReleaseInfo> {
  const response = await fetchFunction(RAW_PACKAGE_JSON, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`兜底版本源返回 HTTP ${String(response.status)} ${response.statusText}`)
  }
  const data = (await response.json()) as RawPackageJson
  const version = data.version ?? ''
  if (version === '') throw new Error('兜底版本源缺少 version 字段')
  return buildReleaseFromVersion(version)
}

/** 发布包信息 */
export interface ReleaseAsset {
  /** 文件名（如 `My-Bangumi-Database-for-WPS-v2.2.0.zip`） */
  name: string
  /** 字节数（0 = 未知） */
  size: number
  /** 下载地址 */
  downloadUrl: string
}

/** 一次「检查更新」的结果 */
export interface ReleaseInfo {
  /** 版本号（tag_name，如 `v2.2.0`） */
  version: string
  /** Release 正文（更新简述） */
  notes: string
  /** 发布时间（ISO 字符串，可能为空） */
  publishedAt: string
  /** Release 页面地址 */
  htmlUrl: string
  /** 匹配到的 zip 资产；没有 zip 时为 null */
  asset: ReleaseAsset | null
}

/** 下载进度 */
export interface DownloadProgress {
  /** 已下载字节 */
  loaded: number
  /** 总字节（0 = 未知） */
  total: number
}

/**
 * 解析版本号为数字段数组
 *
 * `v2.1.0` → `[2, 1, 0]`；`2.1.0-beta.1` → `[2, 1, 0, 1]`。
 */
export function parseVersion(text: string): number[] {
  const cleaned = text.trim().replace(/^v/iu, '')
  if (cleaned === '') return []
  return cleaned.split(/[.\-+]/u).map((part) => {
    const match = /^\d+/u.exec(part)
    return match ? Number(match[0]) : 0
  })
}

/**
 * 比较两个版本号
 * @returns 1 = a 更新；-1 = b 更新；0 = 相同
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0
    const rightPart = right[index] ?? 0
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1
  }
  return 0
}

/** 最新版是否比当前版新 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

/** GitHub Release 接口返回体的最小子集 */
interface GitHubReleaseJson {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  assets?: {
    name?: string
    size?: number
    browser_download_url?: string
  }[]
}

/** 从资产列表里挑第一个 zip */
function pickZipAsset(assets: GitHubReleaseJson['assets']): ReleaseAsset | null {
  if (!assets) return null
  for (const asset of assets) {
    const name = asset.name ?? ''
    const downloadUrl = asset.browser_download_url ?? ''
    if (downloadUrl !== '' && name.toLowerCase().endsWith('.zip')) {
      return { name, size: asset.size ?? 0, downloadUrl }
    }
  }
  return null
}

/**
 * 查询最新 Release
 *
 * @param fetchImpl 可注入的 fetch（测试用；默认全局 fetch）
 * @throws 网络错误 / 非 2xx / 响应缺版本号
 */
export async function fetchLatestRelease(
  fetchFunction: typeof fetch = fetch,
): Promise<ReleaseInfo> {
  try {
    const response = await fetchFunction(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    })
    if (response.status === 404) {
      throw new Error('仓库还没有发布任何 Release')
    }
    if (!response.ok) {
      throw new Error(`GitHub 接口返回 HTTP ${String(response.status)} ${response.statusText}`)
    }
    const data = (await response.json()) as GitHubReleaseJson
    const version = data.tag_name ?? data.name ?? ''
    if (version === '') throw new Error('Release 缺少版本号（tag_name）')
    return {
      version,
      notes: data.body ?? '',
      publishedAt: data.published_at ?? '',
      htmlUrl: data.html_url ?? '',
      asset: pickZipAsset(data.assets),
    }
  } catch (error: unknown) {
    // 404 是明确的业务状态，不应被兜底掩盖
    if (error instanceof Error && error.message.includes('还没有发布')) throw error
    try {
      return await fetchLatestReleaseFromRaw(fetchFunction)
    } catch {
      // 兜底也失败时保留原始错误，便于用户定位（限流 / 网络拦截 / 仓库不可达）
      throw error
    }
  }
}

/** 把分块合并成一个连续 Uint8Array */
function mergeChunks(chunks: readonly Uint8Array[], totalLength: number): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/**
 * 下载更新包（带进度回调）
 *
 * @param url 资产下载地址
 * @param onProgress 每次读到一块数据时回调（`total` 未知时为 0）
 * @param fetchImpl 可注入的 fetch（测试用）
 */
export async function downloadReleaseAsset(
  url: string,
  onProgress: (progress: DownloadProgress) => void,
  fetchFunction: typeof fetch = fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetchFunction(url)
  if (!response.ok) {
    throw new Error(`下载更新包失败：HTTP ${String(response.status)} ${response.statusText}`)
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    onProgress({ loaded: bytes.byteLength, total: bytes.byteLength })
    return bytes
  }

  const totalHeader = response.headers.get('content-length')
  const total = totalHeader === null ? 0 : Number(totalHeader)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let isDone = false
  while (!isDone) {
    const result = await reader.read()
    if (result.done) {
      isDone = true
    } else {
      const chunk = result.value
      chunks.push(chunk)
      loaded += chunk.byteLength
      onProgress({ loaded, total })
    }
  }
  return mergeChunks(chunks, loaded)
}

/**
 * 触发浏览器下载（落 CEF 下载目录），二进制安全
 *
 * @param bytes 文件内容
 * @param fileName 建议文件名
 */
export function saveZipViaBrowser(bytes: Uint8Array<ArrayBuffer>, fileName: string): void {
  const blob = new Blob([bytes], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}
