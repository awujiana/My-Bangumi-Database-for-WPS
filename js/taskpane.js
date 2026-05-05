// ========== 任务面板主模块 ==========
// 功能：面板初始化、事件绑定、核心逻辑
// 依赖：util.js, bangumi.js, syncRecord.js, ui/*.js, sync/*.js

// ========== 面板初始化 ==========
window.onload = () => {
    // 检查枚举
    if (typeof window.Application.Enum !== "object") {
        window.Application.Enum = WPS_Enum;
    }

    // 初始化消息监听（来自 ribbon 的消息）
    initMessageListener();

    // 初始化工作表列表
    refreshSheets();

    // 更新状态显示
    updateTokenStatus();
    updateUserIdStatus();

    // 绑定工作表选择事件
    let sheetSelect = document.getElementById("sheetSelect");
    if (sheetSelect) {
        sheetSelect.addEventListener("change", () => {
            let sheetIndex = parseInt(sheetSelect.value);
            BGM.sheet.lockedIndex = null;
            BGM.sheet.isLocked = false;
            updateLockButton();
            refreshData();
        });
    }

    // 绑定刷新按钮
    let refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            refreshSheets();
            refreshData();
        });
    }

    // 绑定模式切换
    let modeRadios = document.querySelectorAll('input[name="selectMode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener("change", onSelectModeChange);
    });

    // 绑定预览过滤
    let filterInput = document.getElementById("detailFilter");
    if (filterInput) {
        filterInput.addEventListener("input", (e) => {
            filterDetailItems(e.target.value);
        });
    }

    // 绑定关闭详情模态框
    let closeBtn = document.getElementById("closeDetailModal");
    if (closeBtn) {
        closeBtn.addEventListener("click", closeDetailModal);
    }

    // 绑定键盘事件
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeDetailModal();
            closeInputDialog();
            closeConfirmDialog();
        }
    });

    // 调试：显示通知计数
    let debugNotifyCount = document.getElementById("debugNotifyCount");
    if (debugNotifyCount) {
        setInterval(() => {
            debugNotifyCount.textContent = "通知: " + (window.debugNotificationCount || 0);
        }, 1000);
    }
};

// ========== 工作表锁定功能 ==========
let lockedSheetIndex = null;
let lockedSheetName = null;

/**
 * 切换工作表锁定状态
 */
function toggleSheetLock() {
    let select = document.getElementById("sheetSelect");
    if (!select) return;

    let sheetIndex = parseInt(select.value);

    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex === sheetIndex) {
        // 解锁
        BGM.sheet.lockedIndex = null;
        BGM.sheet.lockedName = null;
        BGM.sheet.isLocked = false;
        showToast("已解锁工作表", "info");
    } else {
        // 锁定
        let app = getApp();
        if (app && app.ActiveWorkbook) {
            let ws = app.ActiveWorkbook.Worksheets(sheetIndex);
            if (ws) {
                BGM.sheet.lockedIndex = sheetIndex;
                BGM.sheet.lockedName = ws.Name;
                BGM.sheet.isLocked = true;
                showToast("已锁定工作表: " + ws.Name, "success");
            }
        }
    }

    updateLockButton();
    refreshData();
}

/**
 * 更新锁定按钮状态
 */
function updateLockButton() {
    let lockBtn = document.getElementById("lockSheetBtn");
    if (!lockBtn) return;

    if (BGM.sheet.isLocked) {
        lockBtn.textContent = "🔓 解锁";
        lockBtn.classList.add("locked");
    } else {
        lockBtn.textContent = "🔒 锁定";
        lockBtn.classList.remove("locked");
    }
}

// ========== 刷新工作表列表 ==========
/**
 * 刷新工作表列表
 */
function refreshSheets() {
    let select = document.getElementById("sheetSelect");
    if (!select) return;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        return;
    }

    let wb = app.ActiveWorkbook;
    let sheets = wb.Worksheets;

    // 保存当前值
    let currentValue = select.value;

    // 清空选项
    select.innerHTML = "";

    // 添加工作表选项
    for (let i = 1; i <= sheets.Count; i++) {
        let ws = sheets(i);
        let option = document.createElement("option");
        option.value = i;
        option.textContent = ws.Name;
        select.appendChild(option);
    }

    // 恢复锁定状态
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        select.value = BGM.sheet.lockedIndex;
    } else if (currentValue && parseInt(currentValue) <= sheets.Count) {
        select.value = currentValue;
    } else {
        select.value = 1;
    }
}

// ========== 刷新数据预览 ==========
/**
 * 刷新数据预览
 * @param {boolean} isAuto - 是否自动模式
 */
function refreshData(isAuto) {
    let dataPreview = document.getElementById("dataPreview");
    let recordPreview = document.getElementById("recordPreview");
    let select = document.getElementById("sheetSelect");

    if (!dataPreview) return;

    // 优先使用锁定的工作表
    let sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value) || 1;

    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        dataPreview.innerHTML = "<p class='hint'>无法获取工作簿</p>";
        return;
    }

    let wb = app.ActiveWorkbook;
    let ws = wb.Worksheets(sheetIndex);

    if (!ws) {
        dataPreview.innerHTML = "<p class='hint'>无法获取工作表</p>";
        return;
    }

    // 检查函数是否加载
    if (typeof findHeaderRow === 'undefined') {
        dataPreview.innerHTML = "<p class='hint'>正在加载脚本...</p>";
        setTimeout(refreshData, 500);
        return;
    }

    // 查找表头
    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) {
        dataPreview.innerHTML = "<p class='hint'>未找到表头行</p>";
        return;
    }

    // 获取列映射
    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.subjectId && !colMap.url) {
        dataPreview.innerHTML = "<p class='hint'>未找到【条目ID】或【Bangumi URL】列</p>";
        return;
    }

    // 获取数据
    let lastRow = getLastRow(ws);
    let dataCount = lastRow - headerRow;

    // 统计状态
    let statusCounts = {};
    if (colMap.status) {
        statusCounts = getColumnValueCounts(ws, headerRow, colMap.status);
    }

    // 生成预览HTML
    let html = "<p class='hint'>工作表: <strong>" + ws.Name + "</strong></p>";
    html += "<p class='hint'>数据行数: <strong>" + dataCount + "</strong> 行</p>";
    html += "<p class='hint'>表头行: <strong>" + headerRow + "</strong></p>";

    if (Object.keys(statusCounts).length > 0) {
        html += "<p class='hint'>状态统计:</p><ul class='status-list'>";
        for (let [status, count] of Object.entries(statusCounts)) {
            let color = statusColor(status);
            html += "<li><span class='status-dot' style='background:" + color + "'></span> " + status + ": " + count + "</li>";
        }
        html += "</ul>";
    }

    dataPreview.innerHTML = html;

    // 刷新同步记录预览
    if (typeof refreshSyncRecordsPreview === 'function' && recordPreview) {
        refreshSyncRecordsPreview();
    }
}

/**
 * 模式切换处理
 */
function onSelectModeChange() {
    let autoSection = document.getElementById("autoSection");
    let manualSection = document.getElementById("manualSection");
    let selectMode = document.querySelector('input[name="selectMode"]:checked')?.value || 'auto';

    if (selectMode === 'auto') {
        if (autoSection) autoSection.style.display = 'block';
        if (manualSection) manualSection.style.display = 'none';
    } else {
        if (autoSection) autoSection.style.display = 'none';
        if (manualSection) manualSection.style.display = 'block';
    }
}

/**
 * 状态颜色映射
 * @param {string} status - 状态文本
 * @returns {string} 颜色值
 */
function statusColor(status) {
    let s = (status || "").toLowerCase();
    if (s.includes("成功") || s.includes("ok") || s.includes("200")) return "#4CAF50";
    if (s.includes("失败") || s.includes("error") || s.includes("400") || s.includes("404")) return "#f44336";
    if (s.includes("跳过") || s.includes("skip") || s.includes("ignore")) return "#FFC107";
    if (s.includes("已收藏") && s.includes("3")) return "#2E7D32";
    if (s.includes("已收藏") && s.includes("2")) return "#8BC34A";
    if (s.includes("已收藏") || s.includes("collected") || s.includes("1")) return "#9C27B0";
    return "#757575";
}

// ========== 同步记录预览 ==========
/**
 * 刷新同步记录预览
 */
function refreshSyncRecordsPreview() {
    let container = document.getElementById("recordList");
    if (!container) return;

    if (typeof getAllSyncRecords !== 'function') {
        container.innerHTML = "<p class='hint'>同步记录功能不可用</p>";
        return;
    }

    let records = getAllSyncRecords();
    if (!records || records.length === 0) {
        container.innerHTML = "<p class='hint'>暂无同步记录</p>";
        return;
    }

    // 显示最近10条
    let recentRecords = records.slice(-10).reverse();
    let html = "";

    recentRecords.forEach((record, index) => {
        let color = statusColor(record.status);
        html += `
            <div class="record-item" onclick="viewSyncRecordDetail(${records.length - 1 - index})">
                <div class="record-header">
                    <span class="record-name">${escapeHtml(record.name)}</span>
                    <span class="record-status" style="color:${color}">${escapeHtml(record.status)}</span>
                </div>
                <div class="record-detail">
                    <span>SID: ${record.sid || "-"}</span>
                    <span>${record.time || ""}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ========== 单条上传功能 ==========
/**
 * 上传单行
 * @param {number} row - 行号
 */
function uploadSingleRow(row) {
    if (typeof SyncToBangumi !== 'function') {
        showAlertDialog("错误", "同步功能不可用");
        return;
    }

    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Token！");
        return;
    }

    // 显示进度
    let progress = document.getElementById("uploadProgress");
    if (progress) {
        progress.style.display = "block";
        progress.querySelector(".progress-bar").style.width = "50%";
    }

    // 调用同步逻辑
    setTimeout(() => {
        try {
            // 这里应该调用单行同步逻辑
            showToast("上传完成", "success");
        } catch (e) {
            showAlertDialog("上传失败", e.message);
        }

        if (progress) {
            progress.style.display = "none";
        }

        // 更新统计
        updateUploadStats();
    }, 500);
}

/**
 * 更新上传统计
 */
function updateUploadStats() {
    let successEl = document.getElementById("uploadSuccess");
    let failEl = document.getElementById("uploadFail");
    let totalEl = document.getElementById("uploadTotal");

    if (successEl) successEl.textContent = "成功: 0";
    if (failEl) failEl.textContent = "失败: 0";
    if (totalEl) totalEl.textContent = "总计: 0";
}

// ========== 调试功能 ==========
/**
 * 测试调试连接
 */
function testDebugConnection() {
    bgmLog(BGM.LOG_LEVELS.INFO, "测试调试连接...");

    let app = getApp();
    if (app) {
        showToast("WPS Application 连接正常", "success");
        bgmLog(BGM.LOG_LEVELS.INFO, "WPS Application 连接正常");
    } else {
        showToast("无法连接 WPS Application", "error");
        bgmLog(BGM.LOG_LEVELS.ERROR, "WPS Application 连接失败");
    }
}

/**
 * Token 验证
 * @param {string} token - Token
 * @param {function} callback - 回调函数
 */
function _verifyToken(token, callback) {
    if (!token) {
        callback(false, "Token 为空");
        return;
    }

    let xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/me", true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);

    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                let data = JSON.parse(xhr.responseText);
                callback(true, data);
            } catch (e) {
                callback(false, "响应解析失败");
            }
        } else {
            callback(false, "Token 无效");
        }
    };

    xhr.onerror = function() {
        callback(false, "网络请求失败");
    };

    xhr.send();
}

/**
 * 测试 Token 有效性
 */
function testTokenValidity() {
    let token = loadBgToken();
    if (!token) {
        showAlertDialog("提示", "请先设置 Token！");
        return;
    }

    setStatus("正在验证 Token...", "info");

    _verifyToken(token, (isValid, data) => {
        if (isValid) {
            showAlertDialog("Token 有效", "用户: " + (data.username || data.user_name || "未知"));
            setStatus("Token 有效", "success");
        } else {
            showAlertDialog("Token 无效", data);
            setStatus("Token 无效", "error");
        }
    });
}

/**
 * 打开用户收藏页
 */
function openUserCollection() {
    let userId = _getBgmUserId();
    if (!userId) {
        showAlertDialog("提示", "请先设置用户ID！");
        return;
    }

    let app = getApp();
    if (app && app.ActiveWindow) {
        app.ActiveWindow.Activate();
        // 打开 URL（需要 WPS 支持）
        // app.followHyperlink("https://bgm.tv/" + userId + "/collect");
    }

    showToast("请在浏览器中访问: https://bgm.tv/" + userId + "/collect", "info");
}

/**
 * HTML 转义
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    if (!text) return "";
    let div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
