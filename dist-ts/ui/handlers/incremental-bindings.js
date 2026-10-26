/**
 * 增量同步 / 冲突策略 UI 绑定
 * @module ui/handlers/incremental-bindings
 * @description 从 handlers/index.ts 抽出：增量同步与跳过冲突的复选框回写（含重试）、
 *              冲突策略单选切换、同步记录开关回写，以及从 Ribbon 恢复初始状态。
 */
import { BGM, LOG_LEVELS, bgmLog, isIncrementalSyncEnabled, isSkipConflictsEnabled, setIncrementalSync, setSkipConflicts, } from '../../index.js';
import { isPanelContext } from './panel-context.js';
import { trackedAddEventListener, trackedSetTimeout } from './resource-tracking.js';
export function tryUpdateIncrementalCheckbox(isChecked) {
    if (!isPanelContext())
        return;
    // 增量同步开关已统一收拢到设置页（#chkIncrementalSync），主面板不再有该复选框。
    // 元素不存在时为正常情况，静默跳过，避免每帧重试刷 ERROR 日志。
    const chkIncremental = document.getElementById('chkIncremental');
    if (!chkIncremental)
        return;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkIncremental.checked ? '开启' : '关闭'}`);
    chkIncremental.checked = isChecked;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步复选框已更新: ${isChecked ? '开启' : '关闭'}`);
}
// 尝试更新跳过冲突 UI（带重试机制）
export function tryUpdateSkipConflictsUI(shouldSkipConflicts, attempts = 0) {
    if (!isPanelContext())
        return;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 目标状态: ${shouldSkipConflicts ? '跳过冲突' : 'Excel覆盖'}`);
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 conflictStrategy select 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${conflictStrategySelect.value}`);
        conflictStrategySelect.value = shouldSkipConflicts ? 'skip' : 'excel';
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 select 已更新: ${conflictStrategySelect.value}`);
        return;
    }
    if (attempts < 3) {
        // 最多重试3次
        bgmLog(LOG_LEVELS.WARN, `[handlers] 未找到 conflictStrategy select 元素，延迟重试 (${String(attempts + 1)}/3)...`);
        trackedSetTimeout(() => {
            tryUpdateSkipConflictsUI(shouldSkipConflicts, attempts + 1);
        }, 100);
        return;
    }
    bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 conflictStrategy select 元素，尝试查找其他控件`);
    // 如果找不到，尝试查找其他类型的控件
    // 备用：查找 radio 按钮
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (skipRadio && overwriteRadio) {
        skipRadio.checked = shouldSkipConflicts;
        overwriteRadio.checked = !shouldSkipConflicts;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 radio 已更新`);
        return;
    }
    // 备用：如果是 checkbox
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (chkSkipConflicts) {
        chkSkipConflicts.checked = shouldSkipConflicts;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突复选框已更新`);
    }
}
// 尝试更新启用同步记录复选框（与另外两个开关保持一致）
export function tryUpdateEnableSyncRecordUI(isEnabled) {
    if (!isPanelContext())
        return;
    // 同步记录开关已统一收拢到设置页（#chkEnableSyncRecord），主面板不再有该复选框。
    // 元素不存在时为正常情况，静默跳过。
    const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord');
    if (!chkEnableSyncRecord)
        return;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkEnableSyncRecord.checked ? '开启' : '关闭'}，目标状态: ${isEnabled ? '开启' : '关闭'}`);
    chkEnableSyncRecord.checked = isEnabled;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录复选框已更新: ${isEnabled ? '开启' : '关闭'}`);
}
export const handleIncrementalChange = () => {
    const chkIncremental = document.getElementById('chkIncremental');
    if (!chkIncremental)
        return;
    const { checked } = chkIncremental;
    bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 增量同步状态变更 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handlers] 新状态: ${checked ? '开启' : '关闭'}`);
    try {
        const isResult = setIncrementalSync(checked);
        if (isResult) {
            bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步状态已成功同步到配置和 Ribbon`);
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[handlers] 增量同步状态同步失败`);
        }
    }
    catch (error) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 更新增量同步状态失败: ${error.message}`);
    }
};
export const handleConflictStrategyChange = () => {
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (!conflictStrategySelect)
        return;
    const selectedValue = conflictStrategySelect.value;
    const isSkip = selectedValue === 'skip';
    bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 冲突策略变更 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${selectedValue}`);
    bgmLog(LOG_LEVELS.INFO, `[handlers] 策略类型: ${isSkip ? '跳过冲突（保留Bangumi数据）' : 'Excel覆盖（用Excel数据覆盖）'}`);
    const isResult = setSkipConflicts(isSkip);
    if (isResult) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已成功同步到配置和 Ribbon`);
    }
    else {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 冲突策略同步失败`);
    }
};
export const handleSkipRadioChange = () => {
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    if (skipRadio?.checked) {
        setSkipConflicts(true);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: 跳过冲突`);
    }
};
export const handleOverwriteRadioChange = () => {
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (overwriteRadio?.checked) {
        setSkipConflicts(false);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: Excel覆盖`);
    }
};
export const handleChkSkipConflictsChange = () => {
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (!chkSkipConflicts)
        return;
    const { checked } = chkSkipConflicts;
    try {
        setSkipConflicts(checked);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突状态已更新: ${checked ? '跳过冲突' : 'Excel覆盖'}`);
    }
    catch (error) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 更新跳过冲突状态失败: ${error.message}`);
    }
};
// 从配置读取增量同步状态并初始化 checkbox
export function initializeIncrementalSyncFromRibbon() {
    if (!isPanelContext())
        return;
    // 冲突策略与增量同步开关是**两个独立功能**，必须先于下面的早退初始化：
    // 主面板 panel.html 只有 #conflictStrategy、没有 #chkIncremental（后者只在设置页的
    // #chkIncrementalSync），若放在函数尾部，增量复选框不存在时就会早退，
    // 导致冲突策略下拉的 change 监听永不注册 —— 用户改了下拉却不落 bgm_skip_conflicts 配置。
    initializeSkipConflictsFromRibbon();
    const chkIncremental = document.getElementById('chkIncremental');
    if (!chkIncremental)
        return;
    try {
        const isIncremental = isIncrementalSyncEnabled();
        chkIncremental.checked = isIncremental;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取增量同步状态: ${isIncremental ? '开启' : '关闭'}`);
    }
    catch (error) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 读取增量同步状态失败: ${error.message}`);
    }
    // 监听 checkbox 变化，同步到配置
    trackedAddEventListener(chkIncremental, 'change', handleIncrementalChange);
}
// 从配置读取跳过冲突状态并初始化 UI
export function initializeSkipConflictsFromRibbon() {
    if (!isPanelContext())
        return;
    try {
        const isSkipConflicts = isSkipConflictsEnabled();
        tryUpdateSkipConflictsUI(isSkipConflicts);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取跳过冲突状态: ${isSkipConflicts ? '跳过冲突' : 'Excel覆盖'}`);
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.WARN,
            context: 'initializeSkipConflictsFromRibbon',
        });
    }
    // 监听冲突策略 select 的变化（侧边栏使用的是 select 下拉框）
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        trackedAddEventListener(conflictStrategySelect, 'change', handleConflictStrategyChange);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 已注册冲突策略 select 变化监听器`);
        return;
    }
    // 备用：查找并监听 radio 按钮
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (skipRadio && overwriteRadio) {
        trackedAddEventListener(skipRadio, 'change', handleSkipRadioChange);
        trackedAddEventListener(overwriteRadio, 'change', handleOverwriteRadioChange);
        return;
    }
    // 备用：如果是 checkbox
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (chkSkipConflicts) {
        trackedAddEventListener(chkSkipConflicts, 'change', handleChkSkipConflictsChange);
    }
}
