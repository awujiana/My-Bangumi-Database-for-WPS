/**
 * @fileoverview 设置页「检查更新」：查 GitHub Release → 弹窗 → 下载更新包（进度 + 日志）
 * @module ui/handlers/update-checker
 *
 * 交互（momo）：
 * 1. 点「检查更新」→ 查最新 Release；
 * 2. 有新版 → 弹模态窗，显示新版本号与更新简述；
 * 3. 点「下载并安装」→ 进度条 + 日志；
 * 4. 失败 → 弹可复制的日志与失败原因。
 *
 * 安装策略：下载 zip 后交给浏览器落盘，并给出「关闭 WPS → 解压覆盖 → 重新打开」
 * 的指引。不在运行期覆盖自身文件——文件锁与半途失败都可能把插件写坏。
 */

import { LOG_LEVELS, bgmLog, showToast } from '../../index.js'
import {
  CURRENT_VERSION,
  downloadReleaseAsset,
  fetchLatestRelease,
  isNewerVersion,
  saveZipViaBrowser,
  UPDATE_OWNER,
  UPDATE_REPO,
} from '../../tools/update-check.js'
import type { DownloadProgress, ReleaseInfo } from '../../tools/update-check.js'

/** 最近一次检查到的 Release（安装时复用，避免重复请求） */
let pendingRelease: ReleaseInfo | null = null

/** 按 id 取通用元素 */
function elementById(id: string): HTMLElement | null {
  return document.getElementById(id)
}

/** 按 id 取按钮元素 */
function buttonById(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null
}

/** 往日志区追加一行并滚到底 */
function appendLog(line: string): void {
  const log = elementById('updateLog')
  if (!log) return
  log.textContent = log.textContent === '' ? line : `${log.textContent}\n${line}`
  log.scrollTop = log.scrollHeight
}

/** 重置日志区 */
function setLog(lines: readonly string[]): void {
  const log = elementById('updateLog')
  if (log) log.textContent = lines.join('\n')
}

/** 设置进度条百分比（0~100） */
function setProgress(percent: number): void {
  const bar = document.getElementById('updateProgress') as HTMLProgressElement | null
  const text = elementById('updateProgressText')
  const wrapper = elementById('updateProgressWrap')
  if (wrapper) wrapper.hidden = false
  if (bar) bar.value = percent
  if (text) text.textContent = `${String(percent)}%`
}

/**
 * 兜底下载：把资产地址交给宿主 WebView 直接打开。
 *
 * `fetch` 下载依赖 CORS（GitHub 资产会 302 到 release-assets.githubusercontent.com，
 * 该域不返回 Access-Control-Allow-Origin），某些 WPS WebView 版本会直接拒绝。
 * 此时用导航方式打开下载链接，由 CEF 的下载器接管，不经过 CORS。
 */
function openExternalDownload(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noreferrer noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

/** 字节数 → 可读大小 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 显示 / 隐藏模态窗，并在显示时锚定遮罩到当前可见区 */
function setModalVisible(isVisible: boolean): void {
  const modal = elementById('updateModal')
  if (!modal) return
  modal.hidden = !isVisible
  if (!isVisible) return
  const mask = modal.querySelector<HTMLElement>('.update-modal__mask')
  // WPS 任务窗格 fixed 包含块不是视口：遮罩用 absolute + top=scrollY 锚定可见区
  mask?.style.setProperty('top', `${String(window.scrollY)}px`)
}

/** 显示「复制日志」按钮 */
function revealCopyButton(): void {
  const copyButton = buttonById('updateCopyLogBtn')
  if (copyButton) copyButton.hidden = false
}

/** 复制日志（clipboard 不可用时降级为选中文本） */
async function copyLog(): Promise<void> {
  const log = elementById('updateLog')
  const text = log?.textContent ?? ''
  if (text === '') {
    showToast('日志为空', 'info')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    showToast('日志已复制到剪贴板', 'success')
  } catch {
    // file:// 下 clipboard API 可能被拒：退化为选中文本，让用户 Ctrl+C
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      if (log) range.selectNodeContents(log)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    showToast('已选中日志，请按 Ctrl+C 复制', 'info')
  }
}

/** 把 Release 信息填进模态窗 */
function fillModal(release: ReleaseInfo): void {
  const versionLine = elementById('updateVersionLine')
  if (versionLine) {
    versionLine.textContent = `当前 v${CURRENT_VERSION} → 最新 ${release.version}`
  }
  const notes = elementById('updateNotes')
  if (notes) {
    const body = release.notes.trim()
    notes.textContent = body === '' ? '（该版本没有提供更新说明）' : body
  }
  const installButton = buttonById('updateInstallBtn')
  if (installButton) installButton.hidden = release.asset === null
  const progressWrapper = elementById('updateProgressWrap')
  if (progressWrapper) progressWrapper.hidden = true
  const copyButton = buttonById('updateCopyLogBtn')
  if (copyButton) copyButton.hidden = true
  setLog([`当前版本 v${CURRENT_VERSION}`, `发现新版本 ${release.version}`])
}

/**
 * 按错误文本给出可操作的原因推测（只覆盖真机上最常见的三种）
 *
 * 之所以要「猜」：浏览器只给一句 `HTTP 403` / `Failed to fetch`，
 * 用户看到这句话完全不知道该改什么。这里把它翻译成「接下来做什么」。
 */
function diagnoseFailure(message: string): string[] {
  const hints: string[] = []
  if (message.includes('403')) {
    hints.push(
      '· HTTP 403 多为 GitHub API 限流：未登录时每小时只有 60 次，稍等几分钟再试，或换个网络（手机热点）验证。',
    )
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    hints.push(
      '· Failed to fetch 表示请求没到达服务器：检查网络 / 代理 / 防火墙；公司网络常拦截 api.github.com。',
    )
  }
  if (message.includes('404')) {
    hints.push('· HTTP 404 表示仓库或 Release 不存在：可能被改名、转为私有，或还没有任何 Release。')
  }
  hints.push(`· 也可以直接打开 https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases 手动查看。`)
  return hints
}

/** 组装诊断日志（能贴进 Issue 的最小集合） */
function buildDiagnostics(message: string, error: unknown): string[] {
  const lines = [
    `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `当前版本：v${CURRENT_VERSION}`,
    `接口：https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`,
    `错误：${message}`,
  ]
  if (error instanceof Error) {
    lines.push(`错误名：${error.name}`)
    const stack = (error.stack ?? '').split('\n').slice(0, 6).join('\n')
    if (stack !== '') lines.push(`调用栈：\n${stack}`)
  }
  if (typeof navigator !== 'undefined') {
    const isOffline = !navigator.onLine
    lines.push(`UA：${navigator.userAgent}`, `在线状态：${isOffline ? '离线' : '在线'}`)
  }
  return lines
}

/**
 * 检查更新失败 → 弹「可复制日志」的模态框（momo：失败要能按日志排查）
 *
 * 只弹 toast 的问题是：3 秒后消失、且只给一句「HTTP 403」，用户既看不到
 * 请求地址也拿不到可粘贴给维护者的信息。这里复用下载进度那套模态框，
 * 把「失败原因 + 常见成因 + 诊断日志」一次给全。
 */
function showFailureModal(message: string, error: unknown): void {
  const versionLine = elementById('updateVersionLine')
  if (versionLine) versionLine.textContent = `当前 v${CURRENT_VERSION} · 检查更新失败`

  const notes = elementById('updateNotes')
  if (notes) {
    notes.textContent = [`失败原因：${message}`, ...diagnoseFailure(message)].join('\n')
  }

  const installButton = buttonById('updateInstallBtn')
  if (installButton) installButton.hidden = true
  const progressWrapper = elementById('updateProgressWrap')
  if (progressWrapper) progressWrapper.hidden = true
  const copyButton = buttonById('updateCopyLogBtn')
  if (copyButton) copyButton.hidden = false

  setLog(buildDiagnostics(message, error))
  setModalVisible(true)
}

/** 检查更新主流程 */
async function checkForUpdates(): Promise<void> {
  const button = buttonById('checkUpdateBtn')
  if (button) button.disabled = true
  try {
    setLog([`当前版本 v${CURRENT_VERSION}`, '正在查询 GitHub 最新 Release…'])
    const release = await fetchLatestRelease()
    pendingRelease = release

    if (!isNewerVersion(release.version, CURRENT_VERSION)) {
      showToast(`已是最新版本（v${CURRENT_VERSION}）`, 'success')
      bgmLog(LOG_LEVELS.INFO, `[update] 已是最新版本：latest=${release.version}`)
      return
    }

    fillModal(release)
    setModalVisible(true)
    bgmLog(LOG_LEVELS.INFO, `[update] 发现新版本 ${release.version}`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[update] 检查更新失败：${message}`)
    showFailureModal(message, error)
  } finally {
    if (button) button.disabled = false
  }
}

/** 下载并安装 */
async function installUpdate(): Promise<void> {
  const release = pendingRelease
  if (!release?.asset) return

  const installButton = buttonById('updateInstallBtn')
  if (installButton) installButton.disabled = true

  setLog([`开始下载 ${release.asset.name}`, `大小 ${formatBytes(release.asset.size)}`])
  setProgress(0)
  let lastLoggedPercent = -10

  const onProgress = (progress: DownloadProgress): void => {
    const percent =
      progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0
    setProgress(percent)
    // 每 10% 记一行，避免日志被逐块刷屏
    if (percent - lastLoggedPercent >= 10) {
      lastLoggedPercent = percent
      appendLog(
        `下载中 ${String(percent)}%（${formatBytes(progress.loaded)} / ${formatBytes(
          progress.total,
        )}）`,
      )
    }
  }

  try {
    let bytes: Uint8Array<ArrayBuffer>
    try {
      // 主源：仓库内 download/ 的 raw 地址（允许跨域，最稳）
      bytes = await downloadReleaseAsset(release.asset.downloadUrl, onProgress)
    } catch (primaryError: unknown) {
      const fallbackUrl = release.asset.fallbackDownloadUrl
      if (fallbackUrl === undefined) throw primaryError
      const primaryMessage =
        primaryError instanceof Error ? primaryError.message : String(primaryError)
      appendLog(`主下载源失败：${primaryMessage}`)
      appendLog('改用 GitHub Release 资产重试…')
      bytes = await downloadReleaseAsset(fallbackUrl, onProgress)
    }

    appendLog(`下载完成：${formatBytes(bytes.byteLength)}`)
    saveZipViaBrowser(bytes, release.asset.name)
    appendLog('✅ 更新包已保存到浏览器下载目录')
    appendLog('安装步骤：关闭 WPS → 解压更新包并覆盖加载项目录 → 重新打开 WPS')
    showToast('更新包已下载，请按日志中的步骤完成安装', 'success')
    revealCopyButton()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog(`❌ 下载失败：${message}`)
    appendLog('可能原因：网络中断 / GitHub 被拦截 / 更新包地址不可访问')
    // fetch 失败最常见的原因是 CORS 或 WebView 限制：交给宿主直接下载作为兜底
    appendLog('已尝试改用浏览器直接下载，请在浏览器的下载目录中查找更新包…')
    openExternalDownload(release.asset.downloadUrl)
    revealCopyButton()
    bgmLog(LOG_LEVELS.ERROR, `[update] 下载失败：${message}，已回退到浏览器直连下载`)
    showToast('下载更新失败，已尝试浏览器直接下载', 'error')
  } finally {
    if (installButton) installButton.disabled = false
  }
}

/**
 * 绑定设置页「检查更新」相关事件（元素不存在时静默跳过，面板页无副作用）
 */
export function setupUpdateChecker(): void {
  const checkButton = buttonById('checkUpdateBtn')
  if (!checkButton) return

  const versionLabel = elementById('aboutVersion')
  if (versionLabel) versionLabel.textContent = `v${CURRENT_VERSION}`

  checkButton.addEventListener('click', () => {
    void checkForUpdates()
  })

  for (const closer of document.querySelectorAll<HTMLElement>('[data-update-close]')) {
    closer.addEventListener('click', () => {
      setModalVisible(false)
    })
  }

  // 点遮罩空白处关闭（点面板内部不关）
  const mask = document.querySelector<HTMLElement>('.update-modal__mask')
  mask?.addEventListener('click', (event) => {
    if (event.target === mask) setModalVisible(false)
  })

  const copyButton = buttonById('updateCopyLogBtn')
  copyButton?.addEventListener('click', () => {
    void copyLog()
  })

  const installButton = buttonById('updateInstallBtn')
  installButton?.addEventListener('click', () => {
    void installUpdate()
  })
}
