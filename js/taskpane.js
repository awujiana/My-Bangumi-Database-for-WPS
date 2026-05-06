/**
 * 任务面板主模块
 * @module taskpane
 * @description 面板初始化、事件绑定、核心逻辑
 */

import { BGM } from './util.js';
import { getApp } from './util.js';
import { initMessageListener, setSyncRunning, setStatus } from './ui/message.js';
import { 
    markUploadedItems, clearSheetMarks
} from './ui/handlers.js';
import { 
    updateTokenStatus, updateUserIdStatus, 
    showAlert, closeAlertDialog, closeInputDialog, closeConfirmDialog,
    showToast, showTokenDialog, showUserIdDialog
} from './ui/dialog.js';
import { previewSyncContent, closeDetailModal } from './ui/preview.js';
import { clearSyncRecords as _clearSyncRecords } from './syncRecord.js';

// ========== 工作表锁定功能 ==========
// 注意：工作表锁定状态已迁移到 BGM.sheet 命名空间
// - BGM.sheet.lockedIndex: 锁定的工作表索引
// - BGM.sheet.lockedName: 锁定的工作表名称
// - BGM.sheet.isLocked: 是否已锁定

/**
 * 切换工作表锁定状态，并缓存到 PluginStorage
 */
function toggleSheetLock() {
    let select = document.getElementById("sheetSelect");
    if (!select) return;

    let sheetIndex = parseInt(select.value);

    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === sheetIndex) {
        BGM.sheet.lockedIndex = null;
        BGM.sheet.lockedName = null;
        BGM.sheet.isLocked = false;
        saveLockedSheet(null);  // 清除缓存
        showToast("已解锁工作表", "info");
    } else {
        let sheetName = select.options[select.selectedIndex]?.text || "";
        BGM.sheet.lockedIndex = sheetIndex;
        BGM.sheet.lockedName = sheetName;
        BGM.sheet.isLocked = true;
        saveLockedSheet({ index: sheetIndex, name: sheetName });  // 写入缓存
        showToast("已锁定工作表: " + sheetName, "info");
    }
    updateLockButton();
    refreshData();
}

/**
 * 保存锁定的工作表到 PluginStorage
 */
function saveLockedSheet(info) {
    let app = getApp();
    if (app?.PluginStorage) {
        app.PluginStorage.setItem("bgm_locked_sheet", info ? JSON.stringify(info) : "");
    }
}

/**
 * 从 PluginStorage 恢复锁定的工作表
 */
function restoreLockedSheet() {
    let app = getApp();
    if (app?.PluginStorage) {
        let raw = app.PluginStorage.getItem("bgm_locked_sheet");
        if (raw) {
            try {
                let info = JSON.parse(raw);
                BGM.sheet.lockedIndex = info.index || null;
                BGM.sheet.lockedName = info.name || null;
                BGM.sheet.isLocked = !!(info.index && info.name);
                return true;
            } catch (e) {
                // 缓存数据损坏，清除
                saveLockedSheet(null);
            }
        }
    }
    return false;
}

/**
 * 更新锁定按钮状态
 */
function updateLockButton() {
    let btn = document.getElementById("lockSheetBtn");
    let status = document.getElementById("lockStatus");
    
    if (btn) {
        if (BGM.sheet.isLocked) {
            btn.textContent = "🔓 解锁";
            btn.classList.add("locked");
        } else {
            btn.textContent = "🔒 锁定";
            btn.classList.remove("locked");
        }
    }
    
    if (status) {
        if (BGM.sheet.isLocked) {
            status.style.display = "inline";
            status.textContent = "已锁定: " + BGM.sheet.lockedName;
        } else {
            status.style.display = "none";
        }
    }
}

/**
 * 刷新工作表列表
 */
function refreshSheets() {
    let select = document.getElementById("sheetSelect");
    if (!select) return;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        console.warn("refreshSheets: 无法获取 ActiveWorkbook");
        return;
    }

    let sheets = app.ActiveWorkbook.Worksheets;
    select.innerHTML = '<option value="">-- 请选择 --</option>';

    for (let i = 1; i <= sheets.Count; i++) {
        let option = document.createElement("option");
        option.value = i;
        option.text = sheets.Item(i).Name;
        
        if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === i) {
            option.selected = true;
        }
        
        select.appendChild(option);
    }

    updateLockButton();
}

/**
 * 刷新数据预览
 */
function refreshData() {
    // 实现数据刷新逻辑
    let select = document.getElementById("sheetSelect");
    let previewBox = document.getElementById("previewBox");
    
    if (previewBox) {
        let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;
        previewBox.innerHTML = `<p class="hint">已选择工作表索引: ${sheetIndex}，点击"刷新数据"加载预览</p>`;
    }
}

/**
 * 模式切换处理
 */
function onSelectModeChange() {
    let manualInputs = document.getElementById("manualRangeInputs");
    let autoInfo = document.getElementById("autoRangeInfo");
    let modeRadios = document.querySelectorAll('input[name="selectMode"]');
    
    for (let radio of modeRadios) {
        if (radio.checked) {
            if (radio.value === "manual") {
                manualInputs.style.display = "block";
                autoInfo.style.display = "none";
            } else {
                manualInputs.style.display = "none";
                autoInfo.style.display = "block";
            }
            break;
        }
    }
}

// ========== 初始化 ==========
/**
 * 面板初始化
 */
function initPanel() {
    // 检查枚举
    if (typeof window.Application.Enum !== "object") {
        window.Application.Enum = WPS_Enum;
    }

    // 初始化消息监听
    initMessageListener();

    // 恢复锁定的工作表缓存
    restoreLockedSheet();

    // 初始化工作表列表
    refreshSheets();

    // 更新状态显示
    updateTokenStatus();
    updateUserIdStatus();

    // 绑定工作表选择事件
    let sheetSelect = document.getElementById("sheetSelect");
    if (sheetSelect) {
        sheetSelect.addEventListener("change", () => {
            BGM.sheet.lockedIndex = null;
            BGM.sheet.lockedName = null;
            BGM.sheet.isLocked = false;
            saveLockedSheet(null);  // 手动切换工作表时清除锁定缓存
            updateLockButton();
            refreshData();
        });
    }

    // 绑定刷新数据按钮（通过 onclick 机制已处理）
    // refreshBtn 已在 HTML 中通过 onclick 绑定，无需重复绑定
    
    // 绑定模式切换
    let modeRadios = document.querySelectorAll('input[name="selectMode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener("change", onSelectModeChange);
    });

    // 绑定预览过滤（HTML中无detailFilter元素，跳过）
    
    // 绑定关闭详情模态框（通过 onclick 机制已处理）
    // closeDetailModal 已在 HTML 中通过 onclick 绑定，无需重复绑定
    
    // 绑定键盘事件
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeDetailModal();
            closeInputDialog();
            closeConfirmDialog();
        }
    });

    // 调试：显示通知计数（HTML中无debugNotifyCount元素，跳过）
}

/**
 * 获取 BGM 收藏数据
 */
function fetchBgCollectionRecords() {
    let token = loadBgToken();
    if (!token) {
        showAlert("请先设置 Token！");
        return;
    }

    let userId = _getBgmUserId();
    if (!userId) {
        showAlert("请先设置用户ID！");
        showUserIdDialog();
        return;
    }

    setSyncRunning(true);
    setStatus("正在获取收藏记录...", "info");

    if (typeof fetchAllUserCollections === 'function') {
        fetchAllUserCollections(token, userId, (collections) => {
            if (collections && collections.length > 0) {
                if (typeof fetchAndRecordBgCollections === 'function') {
                    fetchAndRecordBgCollections(token, userId, collections);
                }
                showAlert("已获取并记录 " + collections.length + " 条收藏", "完成");
            } else {
                showAlert("未获取到收藏数据");
            }
            setSyncRunning(false);
            setStatus("获取完成", "success");
        }, (error) => {
            showAlert(error, "获取失败");
            setSyncRunning(false);
            setStatus("获取失败", "error");
        });
    }
}

/**
 * 清除同步记录
 * 实际实现在 syncRecord.js 中，这里作为转发入口
 */
function clearSyncRecords() {
    if (typeof _clearSyncRecords === 'function') {
        _clearSyncRecords();
    } else {
        showAlert("清除同步记录功能未加载");
    }
}

/**
 * 获取当前用户选择的工作表名称
 * 优先返回锁定的工作表名，其次返回下拉框选中的工作表名
 */
function getSelectedSheetName() {
    if (BGM.sheet.isLocked && BGM.sheet.lockedName) {
        return BGM.sheet.lockedName;
    }
    let select = document.getElementById('sheetSelect');
    if (select && select.selectedIndex > 0) {
        return select.options[select.selectedIndex].text;
    }
    return null;
}

/**
 * 标记已上传条目（当前选择的工作表）
 */
function markUploadedItemsDefault() {
    let sheetName = getSelectedSheetName();
    if (!sheetName) {
        showAlert('请先选择工作表！');
        return;
    }
    markUploadedItems(sheetName);
}

/**
 * 清除工作表标记（当前选择的工作表）
 */
function clearSheetMarksDefault() {
    let sheetName = getSelectedSheetName();
    if (!sheetName) {
        showAlert('请先选择工作表！');
        return;
    }
    clearSheetMarks(sheetName);
}

// ========== 导出函数 ==========
export {
    initPanel,
    refreshSheets,
    refreshData,
    toggleSheetLock,
    onSelectModeChange,
    fetchBgCollectionRecords,
    clearSyncRecords,
    markUploadedItems,
    markUploadedItemsDefault,
    clearSheetMarks,
    clearSheetMarksDefault
};

// ========== 挂载到 window（向后兼容）==========
window.onload = initPanel;
window.initPanel = initPanel;
window.refreshSheets = refreshSheets;
window.refreshData = refreshData;
window.toggleSheetLock = toggleSheetLock;
window.onSelectModeChange = onSelectModeChange;
window.fetchBgCollectionRecords = fetchBgCollectionRecords;
window.clearSyncRecords = clearSyncRecords;
window.markUploadedItemsDefault = markUploadedItemsDefault;
window.clearSheetMarksDefault = clearSheetMarksDefault;

// 导出全局函数别名（仅挂载 handlers.js/dialog.js 未覆盖的函数）
window.previewSyncContent = previewSyncContent;
window.closeDetailModal = closeDetailModal;
window.showAlertDialog = showAlert;  // 兼容别名
window.closeAlertDialog = closeAlertDialog;
window.showToast = showToast;
window.showTokenDialog = showTokenDialog;
window.showUserIdDialog = showUserIdDialog;
