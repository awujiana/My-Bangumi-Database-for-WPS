// ========== UI 事件处理模块 ==========
// 功能：面板操作处理、按钮绑定、事件处理
// 依赖：bangumi.js, syncRecord.js, dialog.js

// ========== 面板操作处理 ==========
/**
 * 处理面板操作
 * @param {string} action - 操作类型
 */
function onAction(action) {
    switch (action) {
        case "sync":
            syncFromPanel();
            break;
        case "test":
            testSingleUpdate();
            break;
        case "clear":
            showConfirmDialog("确定要清除所有标记吗？", () => {
                clearRowColors();
                refreshData();
            });
            break;
        case "setToken":
            showTokenDialog(loadBgToken() || "");
            break;
        case "preview":
            previewSyncContent();
            break;
        case "showUserIdDialog":
            showUserIdDialog();
            break;
        case "showClearConfirm":
            showConfirmDialog("确定要清除所有标记吗？", () => {
                clearRowColors();
                refreshData();
            });
            break;
        case "tokenUpdated":
            updateTokenStatus();
            break;
        case "userIdUpdated":
            updateUserIdStatus();
            break;
    }
}

// ========== 从面板同步 ==========
/**
 * 从面板执行同步
 */
function syncFromPanel() {
    bgmLog(BGM.LOG_LEVELS.INFO, "syncFromPanel 开始执行");
    
    // 检查必需函数是否已加载
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined' || typeof getLastRow === 'undefined') {
        bgmLog(BGM.LOG_LEVELS.ERROR, "syncFromPanel - 必需函数未加载");
        showAlertDialog("提示", "正在加载脚本，请稍后重试...");
        return;
    }
    
    bgmLog(BGM.LOG_LEVELS.INFO, "syncFromPanel - 必需函数已加载，开始同步...");

    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Bangumi Token！");
        showTokenDialog("");
        return;
    }

    // 激活同步记录工作表（方便查看同步过程）
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        let syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            try {
                syncSheet.Activate();
            } catch (e) {
                bgmLog(BGM.LOG_LEVELS.WARN, "无法激活同步记录表: " + e.message);
            }
        }
    }

    // 执同步
    if (typeof SyncToBangumi === 'function') {
        try {
            SyncToBangumi();
        } catch (e) {
            bgmLog(BGM.LOG_LEVELS.ERROR, "SyncToBangumi 出错: " + e.message);
            showAlertDialog("执行出错", e.message);
        }
    }
}

// ========== 测试单个更新 ==========
/**
 * 测试单个条目更新
 */
function testSingleUpdate() {
    if (typeof findHeaderRow === 'undefined') {
        setTimeout(testSingleUpdate, 500);
        return;
    }
    
    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Bangumi Token！");
        return;
    }
    
    if (typeof testSingleUpdateBangumi === 'function') {
        testSingleUpdateBangumi();
    }
}

// ========== 从BGM同步收藏标记 ==========
/**
 * 从BGM同步收藏标记
 */
function syncCollectionFromBgm() {
    try {
        let select = document.getElementById("sheetSelect");
        let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;
        
        bgmLog(BGM.LOG_LEVELS.INFO, "开始从BGM同步收藏标记，工作表索引: " + sheetIndex);

        let token = loadBgToken();
        if (!token) {
            showAlertDialog("提示", "请先设置 Bangumi Token！");
            return;
        }

        // 使用 API 方式同步
        syncFromBgmByAPI(sheetIndex);
    } catch (e) {
        console.error("syncCollectionFromBgm 出错:", e);
        showAlertDialog("操作出错", e.message);
    }
}

// ========== API 方式同步 ==========
/**
 * 通过 API 方式同步收藏
 * @param {number} sheetIndex - 工作表索引
 */
function syncFromBgmByAPI(sheetIndex) {
    bgmLog(BGM.LOG_LEVELS.INFO, "syncFromBgmByAPI 开始");

    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Token！");
        return;
    }

    let userId = _getBgmUserId();
    if (!userId) {
        showAlertDialog("提示", "请先设置用户ID！");
        showUserIdDialog();
        return;
    }

    setSyncRunning(true);
    setStatus("正在获取收藏列表...", "info");

    // 获取用户收藏
    fetchAllUserCollections(token, userId, (collections) => {
        if (collections && collections.length > 0) {
            // 写入同步记录表
            if (typeof fetchAndRecordBgCollections === 'function') {
                fetchAndRecordBgCollections(token, userId, collections);
            }

            // 标记到工作表
            markUploadedItems(sheetIndex, collections);
        } else {
            showAlertDialog("提示", "未获取到收藏数据，请检查 Token 和用户ID！");
        }
        setSyncRunning(false);
        setStatus("同步完成", "success");
    }, (error) => {
        showAlertDialog("获取收藏失败", error);
        setSyncRunning(false);
        setStatus("同步失败", "error");
    });
}

/**
 * 标记已上传的条目到工作表
 * @param {number} sheetIndex - 工作表索引
 * @param {Array} collections - 收藏数据
 */
function markUploadedItems(sheetIndex, collections) {
    if (typeof markUploadedItemsInSheet === 'function') {
        markUploadedItemsInSheet(sheetIndex, collections);
    }
}

/**
 * 清除工作表标记
 * @param {number} sheetIndex - 工作表索引
 */
function clearSheetMarks(sheetIndex) {
    if (typeof clearSheetMarksInSheet === 'function') {
        clearSheetMarksInSheet(sheetIndex);
    }
}
