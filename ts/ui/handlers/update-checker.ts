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
} from '../../tools/update-check.js'
import type { ReleaseInfo } from '../../tools/update-check.js'

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
    showToast(`检查更新失败：${message}`, 'error')
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

  try {
    const bytes = await downloadReleaseAsset(release.asset.downloadUrl, (progress) => {
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
    })

    appendLog(`下载完成：${formatBytes(bytes.byteLength)}`)
    saveZipViaBrowser(bytes, release.asset.name)
    appendLog('✅ 更新包已保存到浏览器下载目录')
    appendLog('安装步骤：关闭 WPS → 解压更新包并覆盖加载项目录 → 重新打开 WPS')
    showToast('更新包已下载，请按日志中的步骤完成安装', 'success')
    revealCopyButton()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog(`❌ 下载失败：${message}`)
    appendLog('可能原因：网络中断 / GitHub 被拦截 / 该 Release 资产不可访问')
    revealCopyButton()
    bgmLog(LOG_LEVELS.ERROR, `[update] 下载失败：${message}`)
    showToast('下载更新失败，可复制日志排查', 'error')
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
