/**
 * 富化预览设置（设置页「🎨 富化预览」区块）的加载 / 保存 / 放弃修改。
 *
 * 配置键（与 ts/panel/enrich-page.ts 的 getEnrichPreviewConfig 读取口径一致）：
 *   - bgm_enrich_ep_single        「单集」阈值（默认 1，橙色徽章）
 *   - bgm_enrich_ep_full          「完结」阈值（默认 12；等于无色，大于绿色，之间黄色）
 *   - bgm_enrich_filter_keywords  自定义噪声关键词（换行/逗号分隔，子串匹配即过滤）
 *
 * 富化页在每次页面加载时懒读取配置，因此设置页保存后无需跨页通知。
 *
 * @module ui/handlers/enrich-preview-settings
 */

import { CONFIG_KEYS, getConfig, setConfig } from '../../tools/config.js'
import { BGM } from '../../tools/util/index.js'

/** 与 enrich-page 的 DEFAULT_ENRICH_PREVIEW_CONFIG 保持一致 */
const DEFAULT_EP_SINGLE = 1
const DEFAULT_EP_FULL = 12

function safeGetInput(id: string): HTMLInputElement | HTMLTextAreaElement | null {
  return document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null
}

/** 从配置读取并填充表单（页面加载 / 放弃修改共用） */
export function loadEnrichPreviewSettingsIntoForm(): void {
  const singleInput = safeGetInput('enrichEpSingle')
  const fullInput = safeGetInput('enrichEpFull')
  const keywordsInput = safeGetInput('enrichFilterKeywords')
  if (!singleInput && !fullInput && !keywordsInput) return

  try {
    if (singleInput) {
      singleInput.value = getConfig(CONFIG_KEYS.ENRICH_EP_SINGLE, String(DEFAULT_EP_SINGLE), true)
    }
    if (fullInput) {
      fullInput.value = getConfig(CONFIG_KEYS.ENRICH_EP_FULL, String(DEFAULT_EP_FULL), true)
    }
    if (keywordsInput) {
      keywordsInput.value = getConfig(CONFIG_KEYS.ENRICH_FILTER_KEYWORDS, '', true)
    }
  } catch {
    // 读取失败时保持表单默认值
  }
}

/** 校验阈值输入：返回规范化后的整数字符串；非法时弹窗提示并返回 null */
function normalizeThreshold(raw: string, label: string, minimum: number): string | null {
  const value = Number(raw.trim())
  if (!Number.isSafeInteger(value) || value < minimum) {
    BGM.Dialog.alert('提示', `${label}必须为不小于 ${String(minimum)} 的整数`)
    return null
  }
  return String(value)
}

/** 保存表单到配置 */
export function saveEnrichPreviewSettings(): void {
  const singleInput = safeGetInput('enrichEpSingle')
  const fullInput = safeGetInput('enrichEpFull')
  const keywordsInput = safeGetInput('enrichFilterKeywords')

  const single = singleInput
    ? normalizeThreshold(singleInput.value, '「单集」阈值', 1)
    : String(DEFAULT_EP_SINGLE)
  if (single === null) return
  const full = fullInput
    ? normalizeThreshold(fullInput.value, '「完结」阈值', 2)
    : String(DEFAULT_EP_FULL)
  if (full === null) return

  // 完结阈值必须大于单集阈值，否则黄色区间为空、颜色语义混乱
  if (Number(full) <= Number(single)) {
    BGM.Dialog.alert('提示', '「完结」阈值必须大于「单集」阈值')
    return
  }

  try {
    setConfig(CONFIG_KEYS.ENRICH_EP_SINGLE, single)
    setConfig(CONFIG_KEYS.ENRICH_EP_FULL, full)
    if (keywordsInput) {
      // 规范化：按换行/逗号拆分 → 去空 → 去重 → 换行重组
      const keywords = [
        ...new Set(
          keywordsInput.value
            .split(/[\n,]/)
            .map((keyword) => keyword.trim())
            .filter((keyword) => keyword !== ''),
        ),
      ]
      setConfig(CONFIG_KEYS.ENRICH_FILTER_KEYWORDS, keywords.join('\n'))
      keywordsInput.value = keywords.join('\n')
    }

    BGM.Dialog.alert('成功', '富化预览设置已保存，重新打开富化页预览即生效')
  } catch (error: unknown) {
    BGM.handleError(error, { context: 'saveEnrichPreviewSettings', showAlert: true })
  }
}

/** 放弃修改：重新从配置读取并覆盖表单 */
export function reloadEnrichPreviewSettings(): void {
  loadEnrichPreviewSettingsIntoForm()
}
