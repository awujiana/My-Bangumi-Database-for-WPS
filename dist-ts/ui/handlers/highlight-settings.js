/**
 * 高亮页功能开关（设置页「⚙️ 功能开关」区块）的加载 / 保存 / 放弃修改。
 *
 * 这两个开关原先散在「番剧高亮」页内（高亮模式切换按钮 + 自动关注复选框），
 * 现集中到设置页统一管理。高亮页改为每次加载工作表前重读配置（init 与
 * reloadSheet 各调一次 applyFeatureTogglesFromConfig），不依赖跨窗格同步 ——
 * postMessage 推不到作为兄弟窗格的高亮页（与富化预览同策略，见
 * enrich-preview-settings.ts 注释）。
 *
 * 配置键（与 ts/panel/highlight-page.ts 读取口径一致，均取 CONFIG_KEYS）：
 *   - highlight.mode       高亮模式（'auto' 自动 / 'manual' 手动，默认 auto）
 *   - highlight.autoWatch  自动关注（'1' 开 / '0' 关，默认关）
 *
 * @module ui/handlers/highlight-settings
 */
import { CONFIG_KEYS, getConfig, setConfig } from '../../tools/config.js';
import { BGM } from '../../tools/util/index.js';
/** 从配置读取并填充表单（页面加载 / 放弃修改共用） */
export function loadHighlightSettingsIntoForm() {
    const modeSelect = document.getElementById('highlightMode');
    const watchBox = document.getElementById('highlightAutoWatch');
    if (!modeSelect && !watchBox)
        return;
    try {
        if (modeSelect) {
            const mode = getConfig(CONFIG_KEYS.HIGHLIGHT_MODE, 'auto', true);
            modeSelect.value = mode === 'manual' ? 'manual' : 'auto';
        }
        if (watchBox) {
            watchBox.checked = getConfig(CONFIG_KEYS.HIGHLIGHT_AUTO_WATCH, '0', true) === '1';
        }
    }
    catch {
        // 读取失败时保持表单默认值
    }
}
/** 保存表单到配置 */
export function saveHighlightSettings() {
    const modeSelect = document.getElementById('highlightMode');
    const watchBox = document.getElementById('highlightAutoWatch');
    try {
        if (modeSelect) {
            setConfig(CONFIG_KEYS.HIGHLIGHT_MODE, modeSelect.value === 'manual' ? 'manual' : 'auto');
        }
        if (watchBox) {
            setConfig(CONFIG_KEYS.HIGHLIGHT_AUTO_WATCH, watchBox.checked ? '1' : '0');
        }
        BGM.Dialog.alert('成功', '功能开关已保存，下次加载工作表即生效');
    }
    catch (error) {
        BGM.handleError(error, { context: 'saveHighlightSettings', showAlert: true });
    }
}
/** 放弃修改：重新从配置读取并覆盖表单 */
export function reloadHighlightSettings() {
    loadHighlightSettingsIntoForm();
}
