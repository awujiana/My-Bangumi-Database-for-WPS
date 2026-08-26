/**
 * 富化功能 - 工作簿锁定模块
 * @module sync/enrichLock
 * @description 管理富化功能的 Bangumi 追踪表工作簿选择与锁定。
 *              与 Panel 的 BGM.sheet 锁定独立，使用 BGM.enrich 命名空间，
 *              通过 PluginStorage 键 `bgm_enrich_locked_workbook` 持久化。
 */
import { getApp, bgmLog, BGM, LOG_LEVELS, CONFIG_KEYS, showToast } from '../index.js';
// ========== 刷新工作簿列表 ==========
/**
 * 刷新所有打开的 Excel 工作簿列表到 UI 下拉框
 * @param selectId - 工作簿选择下拉框的 DOM ID
 */
export function refreshEnrichWorkbooks(selectId = 'enrichWorkbookSelect') {
    const select = document.getElementById(selectId);
    if (!select)
        return;
    const app = getApp();
    if (!app?.Workbooks) {
        bgmLog(LOG_LEVELS.WARN, 'refreshEnrichWorkbooks: 无法获取 Workbooks');
        return;
    }
    const wbs = app.Workbooks;
    const currentValue = select.value;
    select.textContent = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- 请选择 Bangumi 追踪表工作簿 --';
    select.appendChild(defaultOption);
    const activeWbName = app.ActiveWorkbook?.Name || '';
    let hasSelection = false;
    for (let i = 1; i <= wbs.Count; i++) {
        const option = document.createElement('option');
        const wb = wbs.Item(i);
        if (!wb)
            continue;
        option.value = wb.Name;
        option.text = wb.Name;
        if (BGM.enrich.isLocked && BGM.enrich.lockedWorkbookName === wb.Name) {
            option.selected = true;
            hasSelection = true;
        }
        else if (currentValue && currentValue === wb.Name) {
            option.selected = true;
            hasSelection = true;
        }
        else if (!currentValue && !BGM.enrich.isLocked && wb.Name === activeWbName) {
            option.selected = true;
            hasSelection = true;
        }
        select.appendChild(option);
    }
    if (!hasSelection) {
        select.value = '';
    }
    bgmLog(LOG_LEVELS.INFO, `[enrichLock] 刷新工作簿列表: ${wbs.Count} 个`);
}
// ========== 刷新工作表列表 ==========
/**
 * 刷新指定工作簿的工作表列表到 UI 下拉框
 * @param workbookName - 目标工作簿名称，为空则使用下拉框当前值
 * @param selectId - 工作表选择下拉框的 DOM ID
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 */
export function refreshEnrichSheets(workbookName, selectId = 'enrichSheetSelect', wbSelectId = 'enrichWorkbookSelect') {
    const select = document.getElementById(selectId);
    if (!select)
        return;
    const app = getApp();
    if (!app?.Workbooks) {
        bgmLog(LOG_LEVELS.WARN, 'refreshEnrichSheets: 无法获取 Workbooks');
        return;
    }
    const wbName = workbookName ?? document.getElementById(wbSelectId)?.value ?? '';
    if (!wbName) {
        select.textContent = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- 请先选择工作簿 --';
        select.appendChild(defaultOpt);
        return;
    }
    let workbook = null;
    for (let i = 1; i <= app.Workbooks.Count; i++) {
        const wb = app.Workbooks.Item(i);
        if (wb.Name === wbName) {
            workbook = wb;
            break;
        }
    }
    if (!workbook) {
        bgmLog(LOG_LEVELS.WARN, `refreshEnrichSheets: 工作簿 "${wbName}" 不存在`);
        return;
    }
    const sheets = workbook.Worksheets;
    const currentLockedSheet = BGM.enrich.isLocked ? BGM.enrich.lockedSheetName : null;
    select.textContent = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- 请选择工作表 --';
    select.appendChild(defaultOpt);
    let lockedFound = false;
    for (let i = 1; i <= sheets.Count; i++) {
        const option = document.createElement('option');
        const sheet = sheets.Item(i);
        if (!sheet)
            continue;
        option.value = String(i);
        option.text = sheet.Name;
        if (currentLockedSheet === sheet.Name && BGM.enrich.isLocked) {
            option.selected = true;
            lockedFound = true;
        }
        select.appendChild(option);
    }
    if (lockedFound) {
        BGM.enrich.lockedSheetIndex = parseInt(select.value, 10) || null;
    }
    bgmLog(LOG_LEVELS.INFO, `[enrichLock] 刷新工作表列表: ${wbName} 共 ${sheets.Count} 个工作表`);
}
// ========== 切换锁定状态 ==========
/**
 * 锁定/解锁富化目标 Bangumi 追踪表工作表
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param lockBtnId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export function toggleEnrichWorkbookLock(sheetSelectId = 'enrichSheetSelect', wbSelectId = 'enrichWorkbookSelect', lockBtnId = 'enrichLockBtn', statusId = 'enrichLockStatus') {
    const sheetSelect = document.getElementById(sheetSelectId);
    if (!sheetSelect)
        return;
    const sheetIndex = parseInt(sheetSelect.value, 10);
    if (isNaN(sheetIndex) || sheetIndex <= 0) {
        showToast('请先选择一个有效的 Bangumi 追踪表工作表', 'warn');
        return;
    }
    const wbSelect = document.getElementById(wbSelectId);
    const wbName = wbSelect?.value || '';
    if (!wbName) {
        showToast('请先选择一个有效的工作簿', 'warn');
        return;
    }
    if (BGM.enrich.isLocked &&
        BGM.enrich.lockedSheetIndex === sheetIndex &&
        BGM.enrich.lockedWorkbookName === wbName) {
        // 解锁
        BGM.enrich.lockedWorkbookName = null;
        BGM.enrich.lockedSheetName = null;
        BGM.enrich.lockedSheetIndex = null;
        BGM.enrich.isLocked = false;
        saveEnrichLockedWorkbook(null);
        showToast('已解锁目标工作表', 'info');
    }
    else {
        // 锁定
        const sheetName = sheetSelect.options[sheetSelect.selectedIndex]?.text || '';
        BGM.enrich.lockedWorkbookName = wbName;
        BGM.enrich.lockedSheetName = sheetName;
        BGM.enrich.lockedSheetIndex = sheetIndex;
        BGM.enrich.isLocked = true;
        const info = {
            workbookName: wbName,
            sheetName,
            sheetIndex,
        };
        saveEnrichLockedWorkbook(info);
        showToast(`已锁定: ${wbName} → ${sheetName}`, 'info');
    }
    updateEnrichLockButton(lockBtnId, statusId);
}
// ========== 更新锁定按钮 UI ==========
/**
 * 更新锁定按钮的文字和状态显示
 * @param lockBtnId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export function updateEnrichLockButton(lockBtnId = 'enrichLockBtn', statusId = 'enrichLockStatus') {
    const btn = document.getElementById(lockBtnId);
    const status = document.getElementById(statusId);
    if (btn) {
        if (BGM.enrich.isLocked) {
            btn.textContent = '🔓 解锁';
            btn.classList.add('locked');
        }
        else {
            btn.textContent = '🔒 锁定';
            btn.classList.remove('locked');
        }
    }
    if (status) {
        if (BGM.enrich.isLocked) {
            status.style.display = 'inline';
            status.textContent = `已锁定: ${BGM.enrich.lockedWorkbookName} → ${BGM.enrich.lockedSheetName}`;
        }
        else {
            status.style.display = 'none';
        }
    }
}
// ========== 持久化锁定状态 ==========
/**
 * 保存锁定信息到 PluginStorage
 * @param info - 锁定信息（null 表示清除）
 */
export function saveEnrichLockedWorkbook(info) {
    const app = getApp();
    if (!app?.PluginStorage) {
        bgmLog(LOG_LEVELS.WARN, 'saveEnrichLockedWorkbook: PluginStorage 不可用');
        return;
    }
    if (info) {
        app.PluginStorage.setItem(CONFIG_KEYS.ENRICH_LOCKED_WORKBOOK, JSON.stringify(info));
        bgmLog(LOG_LEVELS.INFO, `[enrichLock] 保存锁定: ${info.workbookName} → ${info.sheetName}`);
    }
    else {
        app.PluginStorage.setItem(CONFIG_KEYS.ENRICH_LOCKED_WORKBOOK, '');
        bgmLog(LOG_LEVELS.INFO, '[enrichLock] 清除锁定持久化数据');
    }
}
// ========== 启动时恢复与校验 ==========
/**
 * 从 PluginStorage 恢复锁定状态，并校验工作簿/工作表是否仍存在
 * @returns 是否成功恢复
 */
export function restoreEnrichLockedWorkbook() {
    const app = getApp();
    if (!app?.PluginStorage) {
        bgmLog(LOG_LEVELS.WARN, 'restoreEnrichLockedWorkbook: PluginStorage 不可用');
        return false;
    }
    const raw = app.PluginStorage.getItem(CONFIG_KEYS.ENRICH_LOCKED_WORKBOOK);
    if (!raw)
        return false;
    try {
        const info = JSON.parse(raw);
        // 校验工作簿是否仍存在
        if (!app.Workbooks) {
            bgmLog(LOG_LEVELS.WARN, 'restoreEnrichLockedWorkbook: Workbooks 不可用');
            clearEnrichLock();
            return false;
        }
        const wb = findWorkbookByName(info.workbookName);
        if (!wb) {
            bgmLog(LOG_LEVELS.WARN, `[restoreEnrichLockedWorkbook] 锁定的工作簿 "${info.workbookName}" 已不存在`);
            clearEnrichLock();
            return false;
        }
        // 校验工作表是否仍存在于工作簿中
        let sheetFound = false;
        for (let i = 1; i <= wb.Worksheets.Count; i++) {
            const ws = wb.Worksheets.Item(i);
            if (ws && ws.Name === info.sheetName) {
                sheetFound = true;
                break;
            }
        }
        if (!sheetFound) {
            bgmLog(LOG_LEVELS.WARN, `[restoreEnrichLockedWorkbook] 锁定的工作表 "${info.sheetName}" 在工作簿 "${info.workbookName}" 中已不存在`);
            clearEnrichLock();
            return false;
        }
        // 恢复锁定状态
        BGM.enrich.lockedWorkbookName = info.workbookName;
        BGM.enrich.lockedSheetName = info.sheetName;
        BGM.enrich.lockedSheetIndex = info.sheetIndex;
        BGM.enrich.isLocked = true;
        bgmLog(LOG_LEVELS.INFO, `[restoreEnrichLockedWorkbook] 成功恢复锁定: ${info.workbookName} → ${info.sheetName}`);
        return true;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `restoreEnrichLockedWorkbook: 解析锁定数据失败: ${String(e)}`);
        clearEnrichLock();
        return false;
    }
}
// ========== 获取锁定的工作表引用 ==========
/**
 * 获取当前锁定的 Bangumi 追踪表工作簿和工作表引用
 * @returns [WpsWorkbook, WpsWorksheet] 元组，未锁定或引用失效返回 null
 */
export function getLockedEnrichSheet() {
    if (!BGM.enrich.isLocked)
        return null;
    const app = getApp();
    if (!app?.Workbooks)
        return null;
    const wb = findWorkbookByName(BGM.enrich.lockedWorkbookName);
    if (!wb) {
        bgmLog(LOG_LEVELS.WARN, `getLockedEnrichSheet: 锁定的工作簿 "${BGM.enrich.lockedWorkbookName}" 已不存在`);
        clearEnrichLock();
        return null;
    }
    let ws = null;
    for (let i = 1; i <= wb.Worksheets.Count; i++) {
        const sheet = wb.Worksheets.Item(i);
        if (sheet && sheet.Name === BGM.enrich.lockedSheetName) {
            ws = sheet;
            break;
        }
    }
    if (!ws) {
        bgmLog(LOG_LEVELS.WARN, `getLockedEnrichSheet: 锁定的工作表 "${BGM.enrich.lockedSheetName}" 已不存在`);
        clearEnrichLock();
        return null;
    }
    return [wb, ws];
}
// ========== 辅助函数 ==========
/**
 * 根据工作簿名称查找 WpsWorkbook 对象
 * @param name - 工作簿名称
 * @returns WpsWorkbook 对象或 null
 */
export function findWorkbookByName(name) {
    if (!name)
        return null;
    const app = getApp();
    if (!app?.Workbooks)
        return null;
    for (let i = 1; i <= app.Workbooks.Count; i++) {
        const wb = app.Workbooks.Item(i);
        if (wb && wb.Name === name)
            return wb;
    }
    return null;
}
/**
 * 在指定工作簿中查找工作表
 * @param wbName - 工作簿名称
 * @param sheetName - 工作表名称
 * @returns WpsWorksheet 对象或 null
 */
export function findSheetInWorkbook(wbName, sheetName) {
    const wb = findWorkbookByName(wbName);
    if (!wb)
        return null;
    for (let i = 1; i <= wb.Worksheets.Count; i++) {
        const ws = wb.Worksheets.Item(i);
        if (ws && ws.Name === sheetName)
            return ws;
    }
    return null;
}
/**
 * 清除富化锁定状态（内存 + 持久化）
 */
function clearEnrichLock() {
    BGM.enrich.lockedWorkbookName = null;
    BGM.enrich.lockedSheetName = null;
    BGM.enrich.lockedSheetIndex = null;
    BGM.enrich.isLocked = false;
    saveEnrichLockedWorkbook(null);
}
/**
 * 初始化富化锁定模块（启动时调用）
 * @param wbSelectId - 工作簿选择下拉框的 DOM ID
 * @param sheetSelectId - 工作表选择下拉框的 DOM ID
 * @param lockBtnId - 锁定按钮的 DOM ID
 * @param statusId - 锁定状态显示的 DOM ID
 */
export function initEnrichLock(wbSelectId = 'enrichWorkbookSelect', sheetSelectId = 'enrichSheetSelect', lockBtnId = 'enrichLockBtn', statusId = 'enrichLockStatus') {
    refreshEnrichWorkbooks(wbSelectId);
    const restored = restoreEnrichLockedWorkbook();
    if (restored) {
        // 恢复成功：设置下拉框选中值
        const wbSelect = document.getElementById(wbSelectId);
        if (wbSelect && BGM.enrich.lockedWorkbookName) {
            wbSelect.value = BGM.enrich.lockedWorkbookName;
        }
        refreshEnrichSheets(BGM.enrich.lockedWorkbookName || undefined, sheetSelectId, wbSelectId);
        const sheetSelect = document.getElementById(sheetSelectId);
        if (sheetSelect && BGM.enrich.lockedSheetIndex) {
            sheetSelect.value = String(BGM.enrich.lockedSheetIndex);
        }
        bgmLog(LOG_LEVELS.INFO, '[enrichLock] 锁定状态已恢复');
    }
    else {
        // 未恢复：刷新当前活动工作簿的工作表列表
        refreshEnrichSheets(undefined, sheetSelectId, wbSelectId);
    }
    updateEnrichLockButton(lockBtnId, statusId);
}
