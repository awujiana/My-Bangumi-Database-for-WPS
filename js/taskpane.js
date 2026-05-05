// ========== 面板初始化 ==========
window.onload = () => {
    // 检查枚举
    if (typeof window.Application.Enum !== "object") {
        window.Application.Enum = WPS_Enum;
    }

    // 更新Token状态
    updateTokenStatus();

    // 更新用户ID状态
    updateUserIdStatus();

    // 绑定Token设置按钮
    let setTokenBtn = document.getElementById("setTokenBtn");
    if (setTokenBtn) {
        setTokenBtn.onclick = () => showTokenDialog(loadBgToken() || "");
    }

    // 绑定测试Token按钮
    let testTokenBtn = document.getElementById("testTokenBtn");
    if (testTokenBtn) {
        testTokenBtn.onclick = () => testTokenValidity();
    }

    // 绑定用户ID设置按钮
    let setUserIdBtn = document.getElementById("setUserIdBtn");
    if (setUserIdBtn) {
        setUserIdBtn.onclick = () => showUserIdDialog();
    }

    // 绑定打开收藏页按钮
    let openCollectionBtn = document.getElementById("openCollectionBtn");
    if (openCollectionBtn) {
        openCollectionBtn.onclick = () => openUserCollection();
    }

    // 绑定预览按钮
    let previewBtn = document.getElementById("previewBtn");
    if (previewBtn) {
        previewBtn.onclick = () => previewSyncContent();
    }

    // 绑定查看同步记录按钮
    let viewRecordsBtn = document.getElementById("viewRecordsBtn");
    if (viewRecordsBtn) {
        viewRecordsBtn.onclick = () => openSyncRecordSheet();
    }

    // 绑定清除同步记录按钮（使用自定义确认对话框）
    let clearRecordsBtn = document.getElementById("clearRecordsBtn");
    if (clearRecordsBtn) {
        clearRecordsBtn.onclick = () => {
            showConfirmDialog("确定要清除所有同步记录吗？\n\n此操作不可恢复，将删除同步记录表中的所有数据。", () => {
                clearSyncRecords();
                if (typeof refreshSyncRecordsPreview === 'function') {
                    refreshSyncRecordsPreview();
                }
            });
        };
    }

    // 绑定工作表选择事件
    let sheetSelect = document.getElementById("sheetSelect");
    if (sheetSelect) {
        sheetSelect.onchange = () => {
            let selectedValue = sheetSelect.value;
            let selectedText = sheetSelect.options[sheetSelect.selectedIndex]?.textContent || "";
            
            if (selectedValue && selectedText !== "-- 请选择 --") {
                // 锁定选择的工作表
                window.lockedSheetIndex = parseInt(selectedValue);
                window.lockedSheetName = selectedText;
                window.isSheetLocked = true;
                
                // 保存到缓存
                window.Application.PluginStorage.setItem("bgm_sheet_index", selectedValue);
                window.Application.PluginStorage.setItem("bgm_sheet_name", selectedText);
                
                // 更新锁定按钮状态
                let lockBtn = document.getElementById("lockSheetBtn");
                let lockStatus = document.getElementById("lockStatus");
                if (lockBtn) {
                    lockBtn.textContent = "🔓 解锁";
                    lockBtn.classList.add("primary");
                }
                if (lockStatus) {
                    lockStatus.style.display = "inline-flex";
                lockStatus.textContent = "🔒 " + window.lockedSheetName;
                lockStatus.className = "lock-status locked";
            }
            
            console.log("已锁定工作表:", window.lockedSheetName, "索引:", window.lockedSheetIndex);
        }
        
        if (selectedText === "同步记录") {
                refreshSyncRecordsPreview();
            } else {
                refreshData();
            }
        };
    }

    // 对话框回车确认
    let dialogInput = document.getElementById("dialogInput");
    if (dialogInput) {
        dialogInput.onkeypress = (e) => {
            if (e.key === "Enter") {
                closeDialog(true);
            }
        };
    }

    // 绑定所有链接点击事件（使用 WPS 方式打开）
    document.addEventListener("click", (e) => {
        if (e.target.tagName === "A") {
            e.preventDefault();
            let url = e.target.href;
            if (url) {
                try {
                    window.Application.OAAssist.ShellExecute(url);
                } catch (err) {
                    window.open(url, "_blank");
                }
            }
        }
    });

    // 加载工作表列表（延迟加载，等待 DOM 完全就绪）
    setTimeout(() => {
        refreshSheets();
        onSelectModeChange(); // 初始化模式切换 UI
    }, 300);

    // 调试通知功能：向开发服务器发送请求
    if (typeof WpsInvoke !== "undefined") {
        try {
            var xmlReq = WpsInvoke.CreateXHR();
            var url = location.origin + "/.debugTemp/NotifyDemoUrl";
            xmlReq.open("GET", url);
            xmlReq.onload = function (res) {
                var node = document.getElementById("DemoSpan");
                if (node) {
                    node.innerHTML = res.target.responseText;
                    // 显示调试区域
                    var debugSection = document.getElementById("debugSection");
                    if (debugSection) {
                        debugSection.style.display = "block";
                    }
                }
            };
            xmlReq.onerror = function () {
                var debugSection = document.getElementById("debugSection");
                if (debugSection) {
                    debugSection.style.display = "none";
                }
            };
            xmlReq.send();
        } catch (e) {
            console.log("调试通知功能不可用:", e.message);
        }
    }
};

// ========== 自定义对话框 ==========
let dialogCallback = null;

function showInputDialog(title, message, defaultValue, callback) {
    let modal = document.getElementById("inputDialog");
    let titleEl = document.getElementById("dialogTitle");
    let messageEl = document.getElementById("dialogMessage");
    let inputEl = document.getElementById("dialogInput");

    if (!modal || !titleEl || !messageEl || !inputEl) {
        alert(message + "\n\n" + defaultValue);
        callback(defaultValue);
        return;
    }

    titleEl.textContent = title;
    messageEl.innerHTML = message.replace(/\n/g, "<br>");
    inputEl.value = defaultValue;
    dialogCallback = callback;

    modal.style.display = "flex";
    setTimeout(() => inputEl.focus(), 100);
    
    // ESC 键关闭
    let escHandler = (e) => {
        if (e.key === "Escape") {
            closeDialog(false);
            document.removeEventListener("keydown", escHandler);
        }
    };
    document.addEventListener("keydown", escHandler);
    
    // 点击背景关闭（点击模态框外部区域）
    let bgHandler = (e) => {
        if (e.target === modal) {
            closeDialog(false);
            modal.removeEventListener("click", bgHandler);
        }
    };
    modal.addEventListener("click", bgHandler);
}

function closeDialog(confirmed) {
    let modal = document.getElementById("inputDialog");
    let inputEl = document.getElementById("dialogInput");

    modal.style.display = "none";

    if (confirmed && dialogCallback) {
        dialogCallback(inputEl.value);
    }
    dialogCallback = null;
}

// ========== 自定义确认对话框（替换原生 confirm）==========
let _confirmCallback = null;

function showConfirmDialog(message, onYes, onCancel) {
    let modal = document.getElementById("confirmDialog");
    let titleEl = document.getElementById("confirmTitle");
    let msgEl = document.getElementById("confirmMessage");

    if (!modal || !msgEl) {
        // 兜底：用原生 confirm
        if (confirm(message)) {
            if (onYes) onYes();
        } else {
            if (onCancel) onCancel();
        }
        return;
    }
    titleEl.textContent = "确认";
    msgEl.innerHTML = message.replace(/\n/g, "<br>");
    _confirmCallback = { onYes, onCancel };
    modal.style.display = "flex";

    // ESC 键关闭
    let escHandler = (e) => {
        if (e.key === "Escape") {
            closeConfirmDialog(false);
            document.removeEventListener("keydown", escHandler);
        }
    };
    document.addEventListener("keydown", escHandler);

    // 点击背景关闭
    let bgHandler = (e) => {
        if (e.target === modal) {
            closeConfirmDialog(false);
            modal.removeEventListener("click", bgHandler);
        }
    };
    modal.addEventListener("click", bgHandler);
}

function closeConfirmDialog(confirmed) {
    let modal = document.getElementById("confirmDialog");
    modal.style.display = "none";
    if (_confirmCallback) {
        if (confirmed && _confirmCallback.onYes) {
            _confirmCallback.onYes();
        } else if (!confirmed && _confirmCallback.onCancel) {
            _confirmCallback.onCancel();
        }
    }
    _confirmCallback = null;
}

// ========== Token 状态更新 ==========
function updateTokenStatus() {
    let token = loadBgToken();
    let statusEl = document.getElementById("tokenStatus");
    if (statusEl) {
        if (token) {
            statusEl.textContent = "已设置 ✓";
            statusEl.className = "set";
        } else {
            statusEl.textContent = "未设置 ✗";
            statusEl.className = "";
        }
    }
}

// ========== 用户ID 状态更新 ==========
function updateUserIdStatus() {
    let userId = window.Application.PluginStorage.getItem("bgm_user_id");
    let username = window.Application.PluginStorage.getItem("bgm_username");
    let statusEl = document.getElementById("userIdStatus");
    if (statusEl) {
        if (userId) {
            let displayText = username ? username + " (ID: " + userId + ")" : "ID: " + userId;
            statusEl.textContent = displayText + " ✓";
            statusEl.className = "set";
        } else {
            statusEl.textContent = "未设置 ✗";
            statusEl.className = "";
        }
    }
}

// ========== 锁定的数据工作表（全局变量，taskpane 和 bangumi 共享）==========
window.lockedSheetIndex = null;
window.lockedSheetName = null;
window.isSheetLocked = false;

// ========== 切换工作表锁定状态 ==========
function toggleSheetLock() {
    let select = document.getElementById("sheetSelect");
    let lockBtn = document.getElementById("lockSheetBtn");
    let lockStatus = document.getElementById("lockStatus");
    
    if (!select || !lockBtn || !lockStatus) return;
    
    if (!window.isSheetLocked) {
        // 锁定
        let selectedValue = select.value;
        let selectedText = select.options[select.selectedIndex]?.textContent || "";
        
        if (!selectedValue || selectedText === "-- 请选择 --") {
            alert("请先选择一个工作表！");
            return;
        }
        
        window.lockedSheetIndex = parseInt(selectedValue);
        window.lockedSheetName = selectedText;
        window.isSheetLocked = true;
        
        lockBtn.textContent = "🔓 解锁";
        lockBtn.classList.add("primary");
        lockStatus.style.display = "inline-flex";
        lockStatus.textContent = "🔒 " + window.lockedSheetName;
        lockStatus.className = "lock-status locked";
        
        console.log("已锁定工作表:", window.lockedSheetName, "索引:", window.lockedSheetIndex);
    } else {
        // 解锁
        window.lockedSheetIndex = null;
        window.lockedSheetName = null;
        window.isSheetLocked = false;
        
        lockBtn.textContent = "🔒 锁定";
        lockBtn.classList.remove("primary");
        lockStatus.style.display = "none";
        
        console.log("已解锁工作表");
    }
}

// ========== 刷新工作表列表 ==========
function refreshSheets() {
    let select = document.getElementById("sheetSelect");
    if (!select) {
        console.log("未找到 sheetSelect 元素，延迟重试...");
        setTimeout(refreshSheets, 500);
        return;
    }

    select.innerHTML = '<option value="">-- 请选择 --</option>';

    try {
        // 检查 Application 对象
        let app = window.Application;
        console.log("Application 对象:", app);

        if (!app) {
            console.error("Application 对象不存在");
            select.innerHTML = '<option value="">-- WPS未就绪 --</option>';
            return;
        }

        // 检查 ActiveWorkbook
        let workbook = app.ActiveWorkbook;
        console.log("ActiveWorkbook:", workbook);

        if (!workbook) {
            console.log("没有打开的工作簿");
            select.innerHTML = '<option value="">-- 请先打开Excel --</option>';
            return;
        }

        let sheets = workbook.Sheets;
        console.log("Sheets 对象:", sheets);

        if (!sheets || sheets.Count === 0) {
            console.log("工作簿中没有工作表");
            select.innerHTML = '<option value="">-- 无工作表 --</option>';
            return;
        }

        console.log("工作表数量:", sheets.Count);

        for (let i = 1; i <= sheets.Count; i++) {
            let option = document.createElement("option");
            option.value = i;
            option.textContent = sheets.Item(i).Name;
            select.appendChild(option);
        }

        // 尝试从缓存恢复工作表选择
        let cachedSheetIndex = window.Application.PluginStorage.getItem("bgm_sheet_index");
        let cachedSheetName = window.Application.PluginStorage.getItem("bgm_sheet_name");
        
        if (cachedSheetIndex) {
            // 先尝试按索引匹配
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === cachedSheetIndex) {
                    select.selectedIndex = i;
                    
                    // 恢复全局变量
                    window.lockedSheetIndex = parseInt(cachedSheetIndex);
                    window.lockedSheetName = cachedSheetName || select.options[i].textContent;
                    window.isSheetLocked = true;
                    
                    // 更新锁定按钮状态
                    let lockBtn = document.getElementById("lockSheetBtn");
                    let lockStatus = document.getElementById("lockStatus");
                    if (lockBtn) {
                        lockBtn.textContent = "🔓 解锁";
                        lockBtn.classList.add("primary");
                    }
                    if (lockStatus) {
                        lockStatus.style.display = "inline-flex";
                        lockStatus.textContent = "🔒 " + window.lockedSheetName;
                        lockStatus.className = "lock-status locked";
                    }
                    
                    break;
                }
            }
        } else {
            // 默认选择活动工作表
            let activeSheet = app.ActiveSheet;
            if (activeSheet) {
                for (let i = 0; i < select.options.length; i++) {
                    if (select.options[i].textContent === activeSheet.Name) {
                        select.selectedIndex = i;
                        break;
                    }
                }
            }
        }
    } catch (e) {
        console.error("获取工作表失败:", e);
        select.innerHTML = '<option value="">加载失败</option>';
    }
}

// ========== 获取筛选状态（包装函数，调用 bangumi.js 中的 getFilterStatus）==========
// @param {number} endRow - 用户指定的结束行号，0表示自动检测
// @param {boolean} getColumnCounts - 是否获取各列的唯一值计数
function getFilterStatusLocal(endRow, getColumnCounts) {
    console.log("getFilterStatusLocal 被调用, endRow:", endRow, "getColumnCounts:", getColumnCounts);
    // 如果 bangumi.js 中的 getFilterStatus 可用，直接调用
    if (typeof getFilterStatus === 'function') {
        let result = getFilterStatus(endRow, getColumnCounts);
        console.log("getFilterStatusLocal - getFilterStatus 返回:", JSON.stringify(result));
        return result;
    }
    
    // 否则返回空结果
    console.log("getFilterStatusLocal - getFilterStatus 不可用!");
    return {
        hasFilter: false,
        filteredColumns: [],
        hiddenRows: [],
        visibleRows: [],
        filterDetails: "",
        columnCounts: {},
        totalRows: 0,
        visibleCount: 0,
        hiddenCount: 0
    };
}

// ========== 预览同步记录 ==========
function refreshSyncRecordsPreview() {
    let previewBox = document.getElementById("previewBox");
    if (!previewBox) return;
    
    let records = getAllSyncRecords();
    
    if (records.length === 0) {
        previewBox.innerHTML = '<div style="padding:20px;text-align:center;color:#888;">暂无同步记录</div>';
        return;
    }
    
    let html = '<table><thead><tr>';
    html += '<th>序号</th><th>时间</th><th>名称</th><th>SID</th><th>状态</th><th>备注</th><th>操作</th>';
    html += '</tr></thead><tbody>';
    
    // 只显示前20条
    let displayCount = Math.min(20, records.length);
    for (let i = 0; i < displayCount; i++) {
        let record = records[i];
        let statusClass = record.status === "成功" ? "success" : "error";
        let statusBadge = `<span class="status-badge ${statusClass}">${record.status || ""}</span>`;
        
        html += `<tr>
            <td>${record.seq || ""}</td>
            <td>${record.time || ""}</td>
            <td><a href="#" onclick="event.preventDefault();openSyncDetail('${record.sid}');">${record.name || ""}</a></td>
            <td>${record.sid || ""}</td>
            <td>${statusBadge}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">${record.message || ""}</td>
            <td><button class="btn-small" onclick="viewSyncRecordDetail('${record.sid}')">详情</button></td>
        </tr>`;
    }
    
    html += '</tbody></table>';
    
    if (records.length > displayCount) {
        html += `<div style="padding:10px;text-align:center;color:#888;">共 ${records.length} 条记录，显示前 ${displayCount} 条</div>`;
    }
    
    previewBox.innerHTML = html;
}

// ========== 查看同步记录详情 ==========
function viewSyncRecordDetail(sid) {
    let records = getAllSyncRecords();
    let record = records.find(r => String(r.sid) === String(sid));
    
    if (!record) {
        alert("未找到该同步记录");
        return;
    }
    
    let content = record.content || "";
    let formattedContent = content;
    try {
        formattedContent = JSON.stringify(JSON.parse(content), null, 2);
    } catch (e) {}
    
    let detail = `
同步记录详情

名称: ${record.name || ""}
SID: ${record.sid || ""}
URL: ${record.url || ""}
时间: ${record.time || ""}
状态: ${record.status || ""}
同步次数: ${record.count || ""}
备注: ${record.message || ""}

同步内容:
${formattedContent}
    `;
    
    alert(detail);
}

// ========== 刷新数据预览 ==========
function refreshData() {
    // 检查必需函数是否已加载
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined' || typeof getLastRow === 'undefined') {
        console.log("等待脚本加载...");
        setTimeout(refreshData, 500);
        return;
    }

    setStatus("正在加载数据...", "loading");

    let select = document.getElementById("sheetSelect");
    let endRowInput = document.getElementById("endRow");
    let startRowInput = document.getElementById("startRow");
    let previewBox = document.getElementById("previewBox");
    let filterStatusEl = document.getElementById("filterStatus");
    let selectMode = document.querySelector('input[name="selectMode"]:checked')?.value || 'auto';

    if (!select || !previewBox) return;

    // 优先使用锁定的工作表，否则使用选择器的值
    let sheetIndex = window.lockedSheetIndex || parseInt(select.value) || 1;
    let userEndRow = parseInt(endRowInput?.value) || 0;

    // 先获取工作表对象（提前定义，供筛选状态使用）
    let ws = null;
    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        ws = sheets.Item(sheetIndex);
    } catch (e) {
        console.error("获取工作表失败:", e);
        setStatus("获取工作表失败", "error");
        return;
    }

    // 先检测筛选状态并更新显示
    try {
        let filterInfo = getFilterStatusLocal(userEndRow, false);
        let hasFilter = filterInfo ? filterInfo.hasFilter : false;
        let visibleCount = filterInfo ? filterInfo.visibleCount : 0;
        let hiddenCount = filterInfo ? filterInfo.hiddenCount : 0;
        let totalRows = filterInfo ? (filterInfo.totalRows || 0) : 0;
        let filterDetails = filterInfo ? (filterInfo.filterDetails || "") : "";

        if (filterInfo) {
            if (filterStatusEl) {
                if (hasFilter) {
                    let detailText = filterDetails ? `<br><span style="color:#888;font-size:11px">${filterDetails}</span>` : "";
                    filterStatusEl.innerHTML = `
                        <div>
                            ⚠️ <b>已筛选</b>：总数据 <b style="color:#fbbf24">${totalRows}</b> 行 | 
                            可见 <b style="color:#4ade80">${visibleCount}</b> 行 | 
                            隐藏 <b style="color:#f87171">${hiddenCount}</b> 行
                            ${detailText}
                        </div>
                    `;
                    filterStatusEl.className = 'has-filter';
                } else if (selectMode === 'auto') {
                    filterStatusEl.textContent = "✅ 无筛选：根据D列序列号识别连续数据行";
                    filterStatusEl.className = 'no-filter';
                } else {
                    filterStatusEl.textContent = `手动模式`;
                    filterStatusEl.className = '';
                }
            }
        }
    } catch (e) {
        console.error("获取筛选状态失败:", e);
        if (filterStatusEl) {
            filterStatusEl.textContent = "⚠️ 无法获取筛选状态";
            filterStatusEl.className = '';
        }
    }

    try {
        if (!ws) {
            setStatus("未找到工作表", "error");
            return;
        }

        // 自动检测表头行
        let headerRow = findHeaderRow(ws);
        if (headerRow === 0) {
            headerRow = 1;
        }
        let dataStartRow = headerRow + 1;

        // 获取列映射
        let colMap = getColumnMap(ws, headerRow);
        
        // 获取最后一行
        let lastRowCell = getCell(ws, ws.Rows.Count, 1);
        let lastRow = lastRowCell.End(-4162).Row;
        let actualEndRow = userEndRow > 0 ? Math.min(userEndRow, lastRow) : lastRow;
        if (userEndRow === 0 && endRowInput) {
            endRowInput.value = actualEndRow;
        }

        let visibleRows = [];
        let totalRows = 0;
        let firstVisibleRow = dataStartRow;
        let lastVisibleRow = actualEndRow;
        
        // D列序列号（固定第4列）
        let seqCol = 4;
        
        if (selectMode === 'auto') {
            // 自动模式：根据序列号连续性识别有效数据行
            // getSequentialRowsBySeqCol(startRow, endRow) 只接受2个参数
            let seqResult = getSequentialRowsBySeqCol(dataStartRow, actualEndRow);
            visibleRows = seqResult.validRows || [];
            totalRows = visibleRows.length;
            firstVisibleRow = totalRows > 0 ? visibleRows[0] : dataStartRow;
            lastVisibleRow = totalRows > 0 ? visibleRows[totalRows - 1] : dataStartRow;
        } else {
            // 手动模式：使用用户指定的范围
            let manualStart = parseInt(startRowInput?.value) || dataStartRow;
            let manualEnd = parseInt(endRowInput?.value) || lastRow;
            for (let i = manualStart; i <= manualEnd; i++) {
                visibleRows.push(i);
            }
            totalRows = visibleRows.length;
            firstVisibleRow = manualStart;
            lastVisibleRow = manualEnd;
        }

        // 生成美化的预览表格
        let html = '<table><thead><tr>';
        html += '<th>序号</th><th>名称</th><th>ID</th><th>状态</th><th>评分</th><th>标签</th>';
        html += '</tr></thead><tbody>';

        // 先过滤出有BGM链接的数据行
        let validRows = [];
        for (let idx = 0; idx < visibleRows.length; idx++) {
            let i = visibleRows[idx];
            let bgmUrlCell = colMap.has("Bangumi_URL") ? getCell(ws, i, colMap.get("Bangumi_URL")) : null;
            let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
            let sid = extractSubjectId(bgmUrl);
            if (sid) {
                validRows.push({ row: i, sid: sid });
            }
        }
        
        // 预览条数限制（基于有效数据）
        let previewLimit = Math.min(15, validRows.length);
        let validCount = validRows.length;
        let typeStats = {1:0, 2:0, 3:0, 4:0, 5:0};

        for (let idx = 0; idx < previewLimit; idx++) {
            let i = validRows[idx].row;
            let sid = validRows[idx].sid;
            let seqCell = getCell(ws, i, seqCol);
            let seqNum = seqCell ? trim(String(seqCell.Value() || "")) : String(i);
            // 安全获取单元格值，添加null检查
            let nameCell = colMap.has("名称") ? getCell(ws, i, colMap.get("名称")) : null;
            let name = nameCell ? trim(String(nameCell.Value() || "")) : "";
            let statusCell = colMap.has("是否看完") ? getCell(ws, i, colMap.get("是否看完")) : null;
            let status = statusCell ? trim(String(statusCell.Value() || "")) : "";
            let rateCell = colMap.has("打分") ? getCell(ws, i, colMap.get("打分")) : null;
            let rate = rateCell ? trim(String(rateCell.Value() || "")) : "";
            let tagsCell = colMap.has("标签/分级") ? getCell(ws, i, colMap.get("标签/分级")) : null;
            let tagsRaw = tagsCell ? trim(String(tagsCell.Value() || "")) : "";
            let finishedDateCell = colMap.has("完播日") ? getCell(ws, i, colMap.get("完播日")) : null;
            let finishedDate = finishedDateCell ? trim(String(finishedDateCell.Value() || "")) : "";

            // 解析状态
            let typeNum = mapWatchStatus(status, finishedDate);
            let typeName = ["", "想看", "在看", "看过", "搁置", "抛弃"][typeNum] || "未知";
            typeStats[typeNum]++;

            // 处理标签
            let tagsDisplay = "";
            if (tagsRaw) {
                let tagSet = new Set();
                addTagsFromStr(tagSet, tagsRaw);
                let tags = Array.from(tagSet).slice(0, 3);
                tagsDisplay = tags.map(t => `<span class="tag-badge">${t}</span>`).join(' ');
                if (tagSet.size > 3) tagsDisplay += `<span class="tag-badge" style="background:#555">+${tagSet.size - 3}</span>`;
            }

            html += `<tr class="valid">`;
            html += `<td class="row-num">${seqNum}</td>`;
            html += `<td class="name-cell" title="${name}">${name ? (name.length > 12 ? name.substring(0, 12) + '...' : name) : '-'}</td>`;
            html += `<td class="sid-cell has-url">${sid}</td>`;
            html += `<td class="status-cell"><span class="type-badge type-${typeNum}">${typeName}</span></td>`;
            html += `<td class="rate-cell">${rate && rate !== 'true' && rate !== 'True' ? '⭐' + rate : '-'}</td>`;
            html += `<td class="tags-cell">${tagsDisplay || '-'}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += `<div style="margin-top:14px;padding:12px;background:#333;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <span style="color:#888;font-size:12px;">
                    共 <b style="color:#4ade80">${validCount}</b> 条有BGM链接的数据
                </span>
                <span style="display:flex;gap:12px;font-size:12px;">
                    <span><span style="color:#4ade80">●</span> 显示: <b>${previewLimit}</b> 条</span>
                </span>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                ${typeStats[3] > 0 ? `<span class="type-badge type-3">看过 ${typeStats[3]}</span>` : ''}
                ${typeStats[2] > 0 ? `<span class="type-badge type-2">在看 ${typeStats[2]}</span>` : ''}
                ${typeStats[1] > 0 ? `<span class="type-badge type-1">想看 ${typeStats[1]}</span>` : ''}
                ${typeStats[4] > 0 ? `<span class="type-badge type-4">搁置 ${typeStats[4]}</span>` : ''}
            </div>
        </div>`;

        previewBox.innerHTML = html;

        // 更新预览计数
        let previewCountEl = document.getElementById("previewCount");
        if (previewCountEl) {
            let cnt = validCount ? `(${validCount} 条)` : `(${totalRows} 行)`;
            previewCountEl.textContent = cnt;
        }

        setStatus("就绪", "success");
    } catch (e) {
        console.error("刷新数据失败:", e);
        previewBox.innerHTML = `<p class="hint">加载失败: ${e.message}</p>`;
        setStatus("加载失败", "error");
    }
}

// ========== 模式切换处理 ==========
function onSelectModeChange() {
    let selectMode = document.querySelector('input[name="selectMode"]:checked')?.value || 'auto';
    let manualInputs = document.getElementById("manualRangeInputs");
    let autoRangeInfo = document.getElementById("autoRangeInfo");
    
    if (selectMode === 'manual') {
        manualInputs.style.display = 'block';
        autoRangeInfo.style.display = 'none';
    } else {
        manualInputs.style.display = 'none';
        autoRangeInfo.style.display = 'flex';
    }
    
    // 刷新数据预览
    refreshData();
}

// ========== 状态颜色 ==========
function statusColor(status) {
    switch (status) {
        case "是": return "#27ae60";
        case "在追": return "#3498db";
        case "搁置": return "#f39c12";
        case "否": return "#7f8c8d";
        default: return "#2c3e50";
    }
}

// ========== 详细预览数据存储 ==========
let detailPreviewData = {
    allItems: [],
    currentFilter: 'all'
};

// ========== 详细预览同步内容 ==========
function previewSyncContent() {
    // 检查必需函数是否已加载
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined') {
        setTimeout(previewSyncContent, 500);
        return;
    }

    let select = document.getElementById("sheetSelect");
    let endRowInput = document.getElementById("endRow");
    let startRowInput = document.getElementById("startRow");

    // 优先使用锁定的工作表，否则使用选择器的值
    let sheetIndex = window.lockedSheetIndex || parseInt(select?.value) || 1;
    let userEndRow = parseInt(endRowInput?.value) || 0;
    let selectMode = document.querySelector('input[name="selectMode"]:checked')?.value || 'auto';

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets.Item(sheetIndex);

        // 自动检测表头行
        let headerRow = findHeaderRow(ws);
        if (headerRow === 0) {
            headerRow = 1;
        }
        let dataStartRow = headerRow + 1;

        // 获取最后一行
        let lastRowCell = getCell(ws, ws.Rows.Count, 1);
        let lastRow = lastRowCell.End(-4162).Row;
        let actualEndRow = userEndRow > 0 ? Math.min(userEndRow, lastRow) : lastRow;

        // D列序列号（固定第4列）
        let seqCol = 4;

        let colMap = getColumnMap(ws, headerRow);

        // 确定要处理的行范围
        let rowsToPreview = [];
        
        if (selectMode === 'auto') {
            // 自动模式：根据D列序列号连续性识别有效数据行
            // bangumi.js 的 getSequentialRowsBySeqCol 只接受2个参数
            let seqResult = getSequentialRowsBySeqCol(dataStartRow, actualEndRow);
            rowsToPreview = seqResult.validRows || [];
        } else {
            // 手动模式：使用用户指定的范围
            let manualStart = parseInt(startRowInput?.value) || dataStartRow;
            let manualEnd = parseInt(endRowInput?.value) || lastRow;
            // 确保范围有效
            if (isNaN(manualStart)) manualStart = dataStartRow;
            if (isNaN(manualEnd)) manualEnd = lastRow;
            if (manualStart > manualEnd) {
                manualStart = dataStartRow;
                manualEnd = lastRow;
            }
            for (let i = manualStart; i <= manualEnd; i++) {
                rowsToPreview.push(i);
            }
        }

        if (rowsToPreview.length === 0) {
            alert("没有数据可预览！");
            return;
        }

        // 第一步：遍历所有行收集完整统计信息
        let totalValid = 0;
        let totalWithType = 0;
        let totalUploaded = 0;
        let typeCount = {1:0, 2:0, 3:0, 4:0, 5:0};
        let uploadedCount = {1:0, 2:0, 3:0, 4:0, 5:0};
        let allValidRows = []; // 存储所有有BGM链接且type>0的行

        for (let idx = 0; idx < rowsToPreview.length; idx++) {
            let i = rowsToPreview[idx];
            
            // 安全获取单元格值，添加null检查
            let bgmUrlCell = colMap.has("Bangumi_URL") ? getCell(ws, i, colMap.get("Bangumi_URL")) : null;
            let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
            let nameCell = colMap.has("名称") ? getCell(ws, i, colMap.get("名称")) : null;
            let name = nameCell ? trim(String(nameCell.Value() || "")) : "";
            let statusCell = colMap.has("是否看完") ? getCell(ws, i, colMap.get("是否看完")) : null;
            let status = statusCell ? trim(String(statusCell.Value() || "")) : "";
            let rateCell = colMap.has("打分") ? getCell(ws, i, colMap.get("打分")) : null;
            let rate = rateCell ? trim(String(rateCell.Value() || "")) : "";
            let tagsCell = colMap.has("标签/分级") ? getCell(ws, i, colMap.get("标签/分级")) : null;
            let tagsRaw = tagsCell ? trim(String(tagsCell.Value() || "")) : "";
            let finishedDateCell = colMap.has("完播日") ? getCell(ws, i, colMap.get("完播日")) : null;
            let finishedDate = finishedDateCell ? trim(String(finishedDateCell.Value() || "")) : "";

            // 检查D列单元格颜色（绿色 = 已上传）
            let seqCell = getCell(ws, i, seqCol);
            let isUploaded = false;
            try {
                if (seqCell && seqCell.Interior) {
                    let colorValue = seqCell.Interior.Color;
                    // 通过 BGM_COLOR 常量判断是否已上传（支持所有绿色变体）
                    if (colorValue === BGM_COLOR.SUCCESS || 
                        colorValue === BGM_COLOR.LIGHT_GREEN || 
                        colorValue === BGM_COLOR.DARK_GREEN ||
                        colorValue === 5292178) { // 0x50D092 = BGR格式的 #92D050
                        isUploaded = true;
                    }
                }
            } catch (e) {}

            let sid = extractSubjectId(bgmUrl);
            if (sid) {
                totalValid++;
            }

            // 忽略无BGM链接的数据
            if (!sid) {
                continue;
            }

            let typeNum = mapWatchStatus(status, finishedDate);

            // type=0（空白/否/想看）不计入待上传
            if (typeNum === 0) {
                continue;
            }

            typeCount[typeNum]++;
            totalWithType++;
            
            if (isUploaded) {
                totalUploaded++;
                uploadedCount[typeNum]++;
            }

            // 存储完整行数据
            allValidRows.push({
                row: i,
                name: name,
                sid: sid,
                bgmUrl: bgmUrl,
                status: status,
                rate: rate,
                tagsRaw: tagsRaw,
                finishedDate: finishedDate,
                typeNum: typeNum,
                isUploaded: isUploaded
            });
        }

        // 第二步：生成预览内容（显示所有条目）
        let itemsData = [];

        for (let idx = 0; idx < allValidRows.length; idx++) {
            let rowData = allValidRows[idx];
            let typeName = ["", "想看", "在看", "看过", "搁置", "抛弃"][rowData.typeNum];

            // 处理标签
            let tagSet = new Set();
            addTagsFromStr(tagSet, rowData.tagsRaw);
            let tags = Array.from(tagSet);
            let tagsHtml = tags.length > 0
                ? `<div class="detail-value tags">${tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}</div>`
                : '<div class="detail-value">-</div>';

            let jsonBody = buildJsonPayload(ws, rowData.row, colMap, rowData.finishedDate);
            let urlDisplay = rowData.bgmUrl.length > 60 ? rowData.bgmUrl.substring(0, 60) + '...' : rowData.bgmUrl;

            let itemHtml = `
                <div class="detail-item ${rowData.isUploaded ? 'uploaded' : 'pending'}" data-type="${rowData.typeNum}" data-row="${rowData.row}" data-sid="${rowData.sid}">
                    <div class="detail-item-header">
                        <div class="detail-item-title">
                            <span class="detail-item-row">行 ${rowData.row}</span>
                            <span class="detail-item-name">${rowData.name || '(无名称)'}</span>
                        </div>
                        ${rowData.isUploaded ? 
                            `<button class="upload-single-btn reupload" onclick="uploadSingleRow(${rowData.row}, this)">重新上传</button>` : 
                            `<button class="upload-single-btn" onclick="uploadSingleRow(${rowData.row}, this)">上传</button>`
                        }
                        ${rowData.isUploaded ? '<span class="uploaded-badge">✓ 已上传</span>' : ''}
                    </div>
                    <div class="detail-item-body">
                        <div class="detail-row">
                            <span class="detail-label">Bangumi URL</span>
                            <span class="detail-value url">${urlDisplay || '(空)'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Subject ID</span>
                            <span class="detail-value sid ${rowData.sid ? 'valid' : ''}">${rowData.sid || '❌ 无法提取'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">观看状态</span>
                            <span class="detail-value">${typeName} (type=${rowData.typeNum})</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">完播日</span>
                            <span class="detail-value">${(rowData.finishedDate === null || rowData.finishedDate === undefined || rowData.finishedDate === "" || rowData.finishedDate === "null") ? '(空白)' : rowData.finishedDate}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">评分</span>
                            <span class="detail-value" style="color:#f39c12;font-weight:600;">${rowData.rate && rowData.rate !== 'true' && rowData.rate !== 'True' ? '⭐ ' + rowData.rate : '(空)'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">标签</span>
                            ${tagsHtml}
                        </div>
                        ${rowData.sid ? `
                        <div class="detail-row" style="flex-direction:column;gap:6px;">
                            <span class="detail-label" style="min-width:auto;">将发送的请求</span>
                            <div class="detail-value" style="color:#27ae60;font-weight:500;">
                                POST /v0/users/{userId}/collections/${rowData.sid}
                            </div>
                            <div class="detail-value json">${jsonBody}</div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;

            itemsData.push({
                html: itemHtml,
                type: rowData.typeNum
            });
        }

        // 存储数据供过滤使用（包含完整统计）
        detailPreviewData.allItems = itemsData;
        detailPreviewData.totalWithType = totalWithType;
        detailPreviewData.totalValid = totalValid;
        detailPreviewData.totalUploaded = totalUploaded;
        detailPreviewData.typeCount = typeCount;
        detailPreviewData.uploadedCount = uploadedCount;
        detailPreviewData.currentFilter = 'all';

        // 生成过滤按钮（使用完整统计）
        let toolbarHtml = `
            <button class="filter-btn all active" onclick="filterDetailItems('all')">全部 (${totalWithType})</button>
            ${typeCount[3] > 0 ? `<button class="filter-btn type-3" onclick="filterDetailItems(3)">看过 (${typeCount[3]})</button>` : ''}
            ${typeCount[2] > 0 ? `<button class="filter-btn type-2" onclick="filterDetailItems(2)">在追 (${typeCount[2]})</button>` : ''}
            ${typeCount[1] > 0 ? `<button class="filter-btn type-1" onclick="filterDetailItems(1)">想看 (${typeCount[1]})</button>` : ''}
            ${typeCount[4] > 0 ? `<button class="filter-btn type-4" onclick="filterDetailItems(4)">搁置 (${typeCount[4]})</button>` : ''}
            ${typeCount[5] > 0 ? `<button class="filter-btn type-5" onclick="filterDetailItems(5)">抛弃 (${typeCount[5]})</button>` : ''}
        `;

        // 生成统计信息
        let pendingCount = totalWithType - totalUploaded;
        let statsHtml = `
            <div class="detail-stats">
                <div class="stat-card">
                    <div class="stat-value">${rowsToPreview.length}</div>
                    <div class="stat-label">总行数</div>
                </div>
                <div class="stat-card" style="border-left:3px solid #f59e0b;">
                    <div class="stat-value" style="color:#f59e0b;">${pendingCount}</div>
                    <div class="stat-label">待上传</div>
                </div>
                <div class="stat-card success" style="border-left:3px solid #22c55e;">
                    <div class="stat-value" style="color:#22c55e;">${totalUploaded}</div>
                    <div class="stat-label">已上传</div>
                </div>
            </div>
            <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
                <span class="status-badge" style="background:#1a3a35;color:#4ade80;">D列序列号</span>
                ${typeCount[3] > 0 ? `<span class="status-badge type-3">看过 ${typeCount[3]}${uploadedCount[3] > 0 ? ' ✓' + uploadedCount[3] : ''}</span>` : ''}
                ${typeCount[2] > 0 ? `<span class="status-badge type-2">在看 ${typeCount[2]}${uploadedCount[2] > 0 ? ' ✓' + uploadedCount[2] : ''}</span>` : ''}
                ${typeCount[1] > 0 ? `<span class="status-badge type-1">想看 ${typeCount[1]}${uploadedCount[1] > 0 ? ' ✓' + uploadedCount[1] : ''}</span>` : ''}
                ${typeCount[4] > 0 ? `<span class="status-badge type-4">搁置 ${typeCount[4]}${uploadedCount[4] > 0 ? ' ✓' + uploadedCount[4] : ''}</span>` : ''}
                ${typeCount[5] > 0 ? `<span class="status-badge type-5">抛弃 ${typeCount[5]}${uploadedCount[5] > 0 ? ' ✓' + uploadedCount[5] : ''}</span>` : ''}
            </div>
        `;

        // 显示模态框
        let modalToolbar = document.getElementById("detailModalToolbar");
        let modalBody = document.getElementById("detailModalBody");
        if (modalToolbar && modalBody) {
            modalToolbar.innerHTML = toolbarHtml;
            modalBody.innerHTML = statsHtml + itemsData.map(item => item.html).join('');
            document.getElementById("detailModal").style.display = "flex";
        }
    } catch (e) {
        alert("预览失败: " + e.message);
    }
}

// ========== 单条上传功能 ==========
function uploadSingleRow(rowNum, btnElement) {
    let token = loadBgToken();
    if (!token) {
        alert("请先设置 Bangumi Token！");
        return;
    }

    // 禁用按钮，防止重复点击
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.classList.add('uploading');
        btnElement.textContent = '上传中...';
    }

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        // 优先使用锁定的工作表，否则使用选择器的值
        let sheetIndex = window.lockedSheetIndex || parseInt(document.getElementById("sheetSelect")?.value) || 1;
        let ws = sheets.Item(sheetIndex);

        // 获取表头行和数据列映射
        let headerRow = findHeaderRow(ws);
        if (headerRow === 0) headerRow = 1;
        let colMap = getColumnMap(ws, headerRow);

        if (!colMap.has("Bangumi_URL")) {
            throw new Error("未找到 Bangumi URL 列");
        }

        // 获取该行数据
        let bgmUrlCell = getCell(ws, rowNum, colMap.get("Bangumi_URL"));
        let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
        let sid = extractSubjectId(bgmUrl);

        if (!sid) {
            throw new Error("无法提取 Subject ID");
        }

        // 获取名称
        let name = "";
        if (colMap.has("名称")) {
            let nameCell = getCell(ws, rowNum, colMap.get("名称"));
            name = nameCell ? trim(String(nameCell.Value() || "")) : "";
        }

        // 获取完播日
        let finishedDate = "";
        if (colMap.has("完播日")) {
            let finishedDateCell = getCell(ws, rowNum, colMap.get("完播日"));
            finishedDate = finishedDateCell ? trim(String(finishedDateCell.Value() || "")) : "";
        }

        // 构建请求体（不包含 ep_status，让用户在 Bangumi 网站上手动标记章节进度）
        let jsonBody = buildJsonPayload(ws, rowNum, colMap, finishedDate);
        if (jsonBody === "") {
            throw new Error("无法构建请求体");
        }

        // 发送上传请求
        let result = bgmRequestSync("POST", "/v0/users/" + _getUserApiPath() + "/collections/" + sid, jsonBody, token);
        let statusCode = result.code;

        // 获取D列单元格标记颜色
        let seqCol = 4;
        let seqCell = getCell(ws, rowNum, seqCol);

        if (statusCode === 204 || statusCode === 200 || statusCode === 201 || statusCode === 202) {
            // 上传成功：标记为绿色
            if (seqCell && seqCell.Interior) {
                seqCell.Interior.Color = BGM_COLOR.SUCCESS;
            }
            
            // 更新按钮显示（保持为重新上传按钮样式）
            if (btnElement) {
                btnElement.classList.remove('uploading');
                btnElement.classList.add('reupload');
                btnElement.textContent = '重新上传';
                btnElement.disabled = false;
            }

            // 更新详情项样式和显示已上传标记
            let detailItem = btnElement?.closest('.detail-item');
            if (detailItem) {
                detailItem.classList.remove('pending');
                detailItem.classList.add('uploaded');
                
                // 添加或更新已上传标记
                let existingBadge = detailItem.querySelector('.uploaded-badge');
                if (!existingBadge) {
                    let header = detailItem.querySelector('.detail-item-header');
                    if (header) {
                        let badge = document.createElement('span');
                        badge.className = 'uploaded-badge';
                        badge.textContent = '✓ 已上传';
                        header.appendChild(badge);
                    }
                }
            }

            // 添加同步记录
            let recordAdded = addSyncRecord({
                name: name || "(无名称)",
                url: bgmUrl,
                sid: sid,
                content: jsonBody,
                status: "成功",
                message: "行 " + rowNum,
                count: 1
            });
            
            if (!recordAdded) {
                console.warn("同步记录添加失败，请检查控制台日志");
            }

            // 更新统计信息
            updateUploadStats();
        } else {
            // 上传失败：标记为红色
            if (seqCell && seqCell.Interior) {
                seqCell.Interior.Color = BGM_COLOR.FAIL;
            }
            
            if (btnElement) {
                btnElement.classList.remove('uploading');
                btnElement.classList.add('error');
                btnElement.textContent = '✗ 失败';
                btnElement.disabled = false;
            }
            
            // 添加失败同步记录
            addSyncRecord({
                name: name || "(无名称)",
                url: bgmUrl,
                sid: sid,
                content: jsonBody,
                status: "失败",
                message: result.message || "HTTP " + statusCode,
                count: 1
            });
            
            showToast(`上传失败: ${(result.message || '未知错误').substring(0, 60)}`, "error", 4000);
        }

    } catch (e) {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.classList.remove('uploading');
            btnElement.classList.add('error');
            btnElement.textContent = '✗ 错误';
        }
        showToast("上传出错: " + e.message.substring(0, 60), "error", 4000);
    }
}

// 更新上传统计显示
function updateUploadStats() {
    let modalBody = document.getElementById("detailModalBody");
    if (!modalBody) return;

    let totalUploaded = detailPreviewData.totalUploaded || 0;
    let totalWithType = detailPreviewData.totalWithType || 0;
    let pendingCount = totalWithType - totalUploaded;

    // 更新待上传数量
    let pendingCard = modalBody.querySelector('.stat-card:nth-child(2) .stat-value');
    if (pendingCard) {
        pendingCard.textContent = pendingCount;
    }

    // 更新已上传数量
    let uploadedCard = modalBody.querySelector('.stat-card:nth-child(3) .stat-value');
    if (uploadedCard) {
        uploadedCard.textContent = totalUploaded;
    }
}

// ========== 从BGM同步收藏标记 ==========
function syncCollectionFromBgm() {
    try {
        console.log("syncCollectionFromBgm 被调用");
        
        let select = document.getElementById("sheetSelect");
        let sheetIndex = window.lockedSheetIndex || parseInt(select?.value) || 1;
        console.log("sheetIndex:", sheetIndex);

        // 注意：WPS 任务窗格中无法跨域访问 bgm.tv 页面（CORS 限制）
        // 网页抓取方式不可用，自动使用 API 方式
        syncFromBgmByAPI(sheetIndex);
    } catch (e) {
        console.error("syncCollectionFromBgm 出错:", e);
        alert("操作出错: " + e.message);
    }
}

// ========== 网页抓取方式同步 ==========
function syncFromBgmByScraping(sheetIndex) {
    let userId = window.Application.PluginStorage.getItem("bgm_user_id");
    if (!userId) {
        alert("请先设置 Bangumi 用户ID！\n\n用户ID获取方式：\n打开你的 Bangumi 主页，URL 中的数字即为用户ID\n例如：https://bgm.tv/user/972358 → 用户ID: 972358");
        showUserIdDialog();
        return;
    }

    // 让用户选择获取哪些类型的收藏（使用自定义对话框）
    _scrapingTypeSelect(sheetIndex, userId);
}

// ========== 网页抓取：递归选择收藏类型 ==========
function _scrapingTypeSelect(sheetIndex, userId, typesToFetch) {
    if (!typesToFetch) {
        // 第一步：选择是否获取全部
        showConfirmDialog("是否获取所有类型的收藏？\n\n点击「确定」→ 获取全部（已看 + 想看 + 在看）\n点击「取消」→ 选择具体类型",
            () => {
                // 确定：获取全部
                let types = [
                    { type: "collect", name: "已看" },
                    { type: "wish", name: "想看" },
                    { type: "do", name: "在看" }
                ];
                _scrapingConfirmThenRun(sheetIndex, userId, types);
            },
            () => {
                // 取消：选择具体类型
                _scrapingTypeSelect(sheetIndex, userId, []);
            }
        );
    } else if (typesToFetch.length === 0) {
        // 第二步：选择是否获取"已看"
        showConfirmDialog("获取「已看 (collect)」收藏？\n\n「确定」→ 已看\n「取消」→ 继续选择",
            () => {
                _scrapingConfirmThenRun(sheetIndex, userId, [{ type: "collect", name: "已看" }]);
            },
            () => {
                _scrapingTypeSelect(sheetIndex, userId, ["skipCollect"]);
            }
        );
    } else {
        // 第三步：选择"想看"还是"在看"
        showConfirmDialog("获取「想看 (wish)」收藏？\n\n「确定」→ 想看\n「取消」→ 在看",
            () => {
                _scrapingConfirmThenRun(sheetIndex, userId, [{ type: "wish", name: "想看" }]);
            },
            () => {
                _scrapingConfirmThenRun(sheetIndex, userId, [{ type: "do", name: "在看" }]);
            }
        );
    }
}

// ========== 网页抓取：确认后执行 ==========
function _scrapingConfirmThenRun(sheetIndex, userId, typesToFetch) {
    let confirmMsg = typesToFetch.length === 1
        ? `将抓取你的「${typesToFetch[0].name}」收藏列表并标记到 D 列，同时写入同步记录表。\n\n是否继续？`
        : `将抓取你的所有收藏列表（已看、想看、在看）并标记到 D 列，同时写入同步记录表。\n\n是否继续？`;

    showConfirmDialog(confirmMsg, () => {
        _doScrapingSync(sheetIndex, userId, typesToFetch);
    });
}

// ========== 执行网页抓取同步（确认后执行）==========
function _doScrapingSync(sheetIndex, userId, typesToFetch) {
    setStatus("正在抓取收藏列表...", "loading");

    try {
        let app = window.Application;
        let sheets = app.ActiveWorkbook.Sheets;
        let ws = sheets.Item(sheetIndex);

        // 获取表头行和列映射
        let headerRow = findHeaderRow(ws);
        if (headerRow === 0) headerRow = 1;

        let colMap = getColumnMap(ws, headerRow);
        if (!colMap.has("Bangumi_URL")) {
            alert("未找到 Bangumi URL 列！");
            setStatus("未找到 URL 列", "error");
            return;
        }

        // 获取数据范围
        let lastRowCell = getCell(ws, ws.Rows.Count, 1);
        let lastRow = lastRowCell.End(-4162).Row;
        let dataStartRow = headerRow + 1;
        let seqCol = 4; // D列

        // 获取所有类型的收藏
        setStatus("正在抓取收藏列表（分页中）...", "loading");
        let allCollections = {};

        for (let i = 0; i < typesToFetch.length; i++) {
            let typeInfo = typesToFetch[i];
            setStatus(`正在抓取「${typeInfo.name}」列表（${i + 1}/${typesToFetch.length}）...`, "loading");
            let collections = fetchAllUserCollectionsByScraping(userId, typeInfo.type);
            allCollections[typeInfo.type] = collections;
            console.log(`[同步] 获取到「${typeInfo.name}」收藏 ${collections.length} 条`);
        }

        // 合并所有收藏
        let userCollections = [];
        for (let type in allCollections) {
            userCollections = userCollections.concat(allCollections[type]);
        }

        if (userCollections.length === 0) {
            alert(`📭 未获取到任何收藏\n\n可能原因：\n1. 你还没有收藏任何动画\n2. 页面加载失败\n\n请检查用户ID是否正确：${userId}`);
            setStatus("无收藏数据", "info");
            return;
        }

        setStatus(`正在匹配 ${userCollections.length} 条收藏...`, "loading");

        // 构建收藏映射：subject_id -> collection info
        let collectionMap = new Map();
        for (let i = 0; i < userCollections.length; i++) {
            let item = userCollections[i];
            collectionMap.set(item.sid, item);
        }

        // 获取名称列索引
        let nameCol = colMap.has("名称") ? colMap.get("名称") : 0;

        // 遍历 Excel 数据并标记 + 写入同步记录
        let matchedCount = 0;
        let totalCount = 0;
        let timeStr = formatCurrentTime();

        for (let row = dataStartRow; row <= lastRow; row++) {
            let bgmUrlCell = getCell(ws, row, colMap.get("Bangumi_URL"));
            let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
            let sid = extractSubjectId(bgmUrl);

            if (sid && collectionMap.has(sid)) {
                let seqCell = getCell(ws, row, seqCol);
                if (seqCell && seqCell.Interior) {
                    // 网页抓取方式：紫色
                    seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
                }
                matchedCount++;

                // 获取名称
                let name = "";
                if (nameCol > 0) {
                    let nameCell = getCell(ws, row, nameCol);
                    name = nameCell ? trim(String(nameCell.Value() || "")) : "";
                }

                // 写入同步记录表
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: sid,
                    type: "动画",
                    content: "从BGM网页抓取同步",
                    status: "成功",
                    message: "行" + row + " 网页抓取匹配",
                    count: 1
                });
            }
            totalCount++;

            // 每100行更新一次状态
            if (row % 100 === 0) {
                setStatus(`已处理 ${row}/${lastRow} 行...`, "loading");
            }
        }

        setStatus("就绪", "success");

        // 构建类型统计
        let typeStats = [];
        for (let type in allCollections) {
            typeStats.push(`「${typesToFetch.find(t => t.type === type)?.name || type}」${allCollections[type].length}条`);
        }
        let statsText = typeStats.join("、");

        alert(`同步完成！\n\n共处理 ${totalCount} 行数据\n匹配到 ${matchedCount} 条收藏\n\n匹配详情：${statsText}\n\n🟣 紫色 - 从BGM同步（网页抓取）\n📋 ${matchedCount} 条同步记录已写入同步记录表`);

    } catch (e) {
        alert("同步失败: " + e.message);
        setStatus("同步失败", "error");
    }
}

// ========== API方式同步 ==========
function syncFromBgmByAPI(sheetIndex) {
    let token = loadBgToken();
    if (!token) {
        alert("请先设置 Bangumi Token！");
        showTokenDialog("");
        return;
    }

    // 确认操作（使用自定义对话框）
    showConfirmDialog("将从 BGM API 获取你的收藏列表，并在 D 列标记已收藏的条目，同时写入同步记录表。\n\n是否继续？", () => {
        _doAPISync(sheetIndex, token);
    });
}

// ========== 执行 API 同步（确认后执行）==========
function _doAPISync(sheetIndex, token) {
    setStatus("正在获取收藏列表...", "loading");

    try {
        let app = window.Application;
        let sheets = app.ActiveWorkbook.Sheets;
        let ws = sheets.Item(sheetIndex);

        // 获取表头行和列映射
        let headerRow = findHeaderRow(ws);
        if (headerRow === 0) headerRow = 1;

        let colMap = getColumnMap(ws, headerRow);
        if (!colMap.has("Bangumi_URL")) {
            alert("未找到 Bangumi URL 列！");
            setStatus("未找到 URL 列", "error");
            return;
        }

        // 获取可见行（支持筛选模式）
        let seqCol = 4; // D列
        let dataStartRow = headerRow + 1;
        let lastRow = getLastRow(ws);
        let nameCol = colMap.has("名称") ? colMap.get("名称") : 0;
        
        // 检测筛选状态，仅处理可见行
        let rowsToProcess = [];
        let filterStatus = getFilterStatus(lastRow);
        if (filterStatus && filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
            rowsToProcess = filterStatus.visibleRows;
            console.log(`检测到筛选，只处理 ${rowsToProcess.length} 行可见数据（共 ${filterStatus.totalRows} 行）`);
        } else {
            // 无筛选时使用序列号连续性检测
            let seqResult = getSequentialRowsBySeqCol(dataStartRow, lastRow);
            rowsToProcess = seqResult.validRows || [];
            if (rowsToProcess.length === 0) {
                // 回退：全量扫描
                for (let r = dataStartRow; r <= lastRow; r++) rowsToProcess.push(r);
            }
            console.log(`工作表演: ${ws.Name}, 表头行: ${headerRow}, 可见行: ${rowsToProcess.length}`);
        }
        
        if (rowsToProcess.length === 0) {
            alert("没有需要处理的数据行！");
            setStatus("无数据", "info");
            return;
        }

        // 先验证 Token 有效性
        setStatus("正在验证 Token...", "loading");
        let verifyResult = _verifyToken(token);
        if (!verifyResult.valid) {
            alert("❌ " + verifyResult.message + "\n\n请重新设置 Token：\n1. 点击「设置/修改」按钮\n2. 输入新的 Access Token\n\n获取 Token: https://next.bgm.tv/demo/access-token/create");
            setStatus("Token 无效", "error");
            return;
        }
        console.log("Token 验证通过，用户:", verifyResult.username, "ID:", verifyResult.userId);
        // 缓存用户 ID，后续 API 调用使用真实 ID 而非 "-" 占位符
        _setBgmUserId(verifyResult.userId);

        // 获取用户收藏列表
        setStatus("正在获取收藏列表（分页中）...", "loading");
        let userCollections = fetchAllUserCollections(token);

        // 检查是否有错误
        if (fetchAllUserCollections.lastError) {
            let err = fetchAllUserCollections.lastError;
            if (err.type === "auth") {
                alert("❌ Token 无效或已过期\n\n请重新设置 Token：\n1. 点击「设置/修改」按钮\n2. 输入新的 Access Token\n\n获取 Token: https://next.bgm.tv/demo/access-token/create");
            } else if (err.type === "forbidden") {
                alert("❌ 没有权限访问收藏列表\n\n请确保 Token 具有正确的权限。");
            } else {
                alert(`❌ 获取收藏列表失败\n\n错误: ${err.message}`);
            }
            setStatus("获取收藏失败", "error");
            return;
        }

        if (userCollections.length === 0) {
            alert("📭 未获取到收藏列表\n\n可能原因：\n1. 你还没有收藏任何动画\n2. Token 没有正确的访问权限\n\n请检查 Token 是否正确。");
            setStatus("无收藏数据", "info");
            return;
        }

        setStatus(`正在匹配 ${userCollections.length} 条收藏...`, "loading");

        // 构建收藏映射：subject_id -> collection info
        let collectionMap = new Map();
        for (let i = 0; i < userCollections.length; i++) {
            let item = userCollections[i];
            collectionMap.set(String(item.subject_id), item);
        }

        // 获取本地同步记录
        let syncRecords = getAllSyncRecords();
        let syncCountMap = new Map();
        for (let i = 0; i < syncRecords.length; i++) {
            let record = syncRecords[i];
            let sid = String(record.sid);
            if (syncCountMap.has(sid)) {
                syncCountMap.set(sid, syncCountMap.get(sid) + 1);
            } else {
                syncCountMap.set(sid, 1);
            }
        }

        // 先写入所有收藏到同步记录表（无论是否匹配Excel行）
        setStatus(`正在写入 ${userCollections.length} 条收藏到同步记录表...`, "loading");
        let writtenToRecord = 0;
        for (let ci = 0; ci < userCollections.length; ci++) {
            let item = userCollections[ci];
            let sid = item.subject_id;
            let url = "https://bgm.tv/subject/" + sid;
            let name = item.subject?.name_cn || item.subject?.name || "(无名称)";
            addSyncRecord({
                name: name,
                url: url,
                sid: String(sid),
                type: "动画",
                content: "从BGM API同步收藏",
                status: "成功",
                message: "BGM收藏同步",
                count: 1
            });
            writtenToRecord++;
        }
        console.log(`已将 ${writtenToRecord} 条收藏写入同步记录表`);

        // 重新获取同步记录计数（因为刚才写入了新记录）
        syncRecords = getAllSyncRecords();
        syncCountMap = new Map();
        for (let i = 0; i < syncRecords.length; i++) {
            let record = syncRecords[i];
            let sid = String(record.sid);
            syncCountMap.set(sid, (syncCountMap.get(sid) || 0) + 1);
        }

        // 遍历可见行并标记 D 列
        setStatus(`正在匹配 ${userCollections.length} 条收藏...`, "loading");
        let matchedCount = 0;
        let totalCount = 0;
        let purpleCount = 0, lightGreenCount = 0, darkGreenCount = 0;

        console.log(`开始扫描 ${rowsToProcess.length} 行可见数据`);
        for (let idx = 0; idx < rowsToProcess.length; idx++) {
            let row = rowsToProcess[idx];
            let bgmUrlCell = getCell(ws, row, colMap.get("Bangumi_URL"));
            let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
            let sid = extractSubjectId(bgmUrl);

            if (sid && collectionMap.has(sid)) {
                let seqCell = getCell(ws, row, seqCol);
                if (seqCell && seqCell.Interior) {
                    let syncCount = syncCountMap.get(sid) || 0;
                    if (syncCount === 1) {
                        seqCell.Interior.Color = BGM_COLOR.BGM_SYNC;
                        purpleCount++;
                    } else if (syncCount === 2) {
                        seqCell.Interior.Color = BGM_COLOR.LIGHT_GREEN;
                        lightGreenCount++;
                    } else {
                        seqCell.Interior.Color = BGM_COLOR.DARK_GREEN;
                        darkGreenCount++;
                    }
                }
                matchedCount++;
            }
            totalCount++;

            if (idx % 100 === 0) {
                setStatus(`已处理 ${idx + 1}/${rowsToProcess.length} 行...`, "loading");
            }
        }

        setStatus("就绪", "success");
        alert(`同步完成！\n\n📋 已将 ${writtenToRecord} 条BGM收藏写入同步记录表\n🔍 扫描 ${totalCount} 行可见数据\n🔗 匹配到 ${matchedCount} 条\n\nD 列颜色说明：\n🟣 紫色 - 本次从BGM同步\n🟢 浅绿色 - 已同步2次\n🌲 深绿色 - 已同步多次`);

    } catch (e) {
        alert("同步失败: " + e.message);
        setStatus("同步失败", "error");
    }
}

// ========== 获取用户所有收藏（分页 - 网页抓取方式）==========
// 参考 BangumiBatchImport.js 实现
function fetchAllUserCollectionsByScraping(userId, listType) {
    /**
     * @param userId - Bangumi用户ID
     * @param listType - 收藏类型: "collect"(已看), "wish"(想看), "do"(在看)
     * @returns {Array} - 收藏条目数组
     */
    let allItems = [];
    let currentPage = 1;
    let hasNextPage = true;
    const maxPages = 100; // 最多获取100页，防止无限循环
    const baseUrl = `https://bgm.tv/anime/list/${userId}/${listType}`;
    
    // 统一的请求头（模拟浏览器）
    const headers = {
        "Content-Type": "text/html; charset=utf-8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };

    console.log(`[网页抓取] 开始获取收藏列表: ${baseUrl}`);

    try {
        while (hasNextPage && currentPage <= maxPages) {
            console.log(`[网页抓取] 获取第 ${currentPage} 页...`);
            
            const pageUrl = currentPage === 1 ? baseUrl : `${baseUrl}?page=${currentPage}`;
            
            // 同步请求获取HTML
            let xhr = new XMLHttpRequest();
            xhr.open("GET", pageUrl, false); // 同步请求
            for (let key in headers) {
                xhr.setRequestHeader(key, headers[key]);
            }
            xhr.send();

            console.log(`[网页抓取] 第 ${currentPage} 页 - 状态码: ${xhr.status}`);

            if (xhr.status !== 200) {
                console.log(`[网页抓取] 第 ${currentPage} 页请求失败: ${xhr.status}`);
                break;
            }

            // 解析HTML
            let doc = parseHTMLToDOM(xhr.responseText);
            if (!doc) {
                console.log(`[网页抓取] 第 ${currentPage} 页 HTML 解析失败`);
                break;
            }

            // 解析当前页的条目
            let pageItems = parseCollectionPageHTML(doc);
            console.log(`[网页抓取] 第 ${currentPage} 页找到 ${pageItems.length} 个条目`);
            
            allItems.push(...pageItems);

            // 检查是否有下一页
            hasNextPage = hasNextPageLink(doc, currentPage);

            if (hasNextPage) {
                currentPage++;
                // 延迟1秒，避免请求过快
                sleep(1000);
            } else {
                console.log(`[网页抓取] 已获取所有页面，共 ${currentPage} 页，${allItems.length} 个条目`);
                break;
            }
        }
    } catch (e) {
        console.error("[网页抓取] 获取收藏列表出错:", e);
    }

    return allItems;
}

// ========== HTML解析为DOM ==========
function parseHTMLToDOM(html) {
    if (!html) return null;
    try {
        let parser = new DOMParser();
        return parser.parseFromString(html, "text/html");
    } catch (e) {
        console.error("HTML解析失败:", e);
        return null;
    }
}

// ========== 解析收藏页面HTML ==========
function parseCollectionPageHTML(doc) {
    let items = [];
    try {
        // Bangumi列表页的CSS选择器
        let entries = doc.querySelectorAll('ul#browserItemList > li.item');
        console.log(`[解析] 找到 ${entries.length} 个条目`);
        
        for (let entry of entries) {
            try {
                // 提取中文名
                let titleLink = entry.querySelector('h3 > a.l');
                let title_cn = titleLink ? titleLink.textContent.trim() : '';
                
                // 提取日文名
                let titleJpElem = entry.querySelector('h3 > small.grey');
                let title_jp = titleJpElem ? titleJpElem.textContent.trim() : '';
                
                // 提取详情页链接，获取 subject_id
                let linkElem = titleLink || entry.querySelector('a.subjectCover');
                let link = linkElem ? linkElem.getAttribute('href') || '' : '';
                let sid = '';
                
                // 从链接中提取 subject_id
                let sidMatch = link.match(/\/subject\/(\d+)/);
                if (sidMatch) {
                    sid = sidMatch[1];
                }
                
                // 提取评分
                let ratingElem = entry.querySelector('span.tip_j');
                let rating = ratingElem ? ratingElem.textContent.trim() : '';
                
                // 提取基本信息（收藏日期、标签等）
                let infoElem = entry.querySelector('p.info.tip');
                let basic_info = infoElem ? infoElem.textContent.trim() : '';
                
                // 提取观看状态图标（如果有）
                let statusElem = entry.querySelector('div.progress');
                let progress = statusElem ? statusElem.textContent.trim() : '';
                
                if (sid) {
                    items.push({
                        sid: sid,
                        title_cn: title_cn,
                        title_jp: title_jp,
                        link: 'https://bgm.tv/subject/' + sid,
                        rating: rating,
                        basic_info: basic_info,
                        progress: progress
                    });
                }
            } catch (e) {
                // 忽略单个条目解析错误
            }
        }
    } catch (e) {
        console.error("[解析] 解析收藏页面失败:", e);
    }
    
    return items;
}

// ========== 检查是否有下一页 ==========
function hasNextPageLink(doc, currentPage) {
    try {
        // 检查分页区域
        let pagination = doc.querySelector('div#multipage');
        if (!pagination) {
            return false;
        }
        
        // 查找下一页链接
        let nextLinks = pagination.querySelectorAll('a.p');
        for (let link of nextLinks) {
            let href = link.getAttribute('href') || '';
            let pageMatch = href.match(/page=(\d+)/);
            if (pageMatch && parseInt(pageMatch[1]) > currentPage) {
                return true;
            }
        }
    } catch (e) {
        console.error("[分页] 检查下一页失败:", e);
    }
    
    return false;
}

// ========== 获取用户所有收藏（分页 - API方式）==========
function fetchAllUserCollections(token) {
    let allCollections = [];
    let page = 1;
    let limit = 100;
    let maxPages = 50;
    let subjectType = 2; // 动画
    let lastError = null;
    let userPath = _getUserApiPath(); // 使用缓存的用户 ID 而非 "-" 占位符

    try {
        while (page <= maxPages) {
            let xhr = new XMLHttpRequest();
            let url = `https://api.bgm.tv/v0/users/${userPath}/collections?subject_type=${subjectType}&limit=${limit}&offset=${(page - 1) * limit}`;
            xhr.open("GET", url, false);
            xhr.setRequestHeader("Authorization", "Bearer " + token);

            xhr.send();

            let responseText = xhr.responseText || "";
            console.log(`获取收藏第 ${page} 页 - 状态码: ${xhr.status}`);

            if (xhr.status === 401) {
                lastError = { type: "auth", message: "Token 无效或已过期，请重新设置 Token" };
                break;
            }

            if (xhr.status === 403) {
                lastError = { type: "forbidden", message: "没有权限访问收藏列表，请检查 Token 权限" };
                break;
            }

            if (xhr.status === 404) {
                // 404 可能表示用户不存在（Token无效）或没有该类型的收藏
                if (responseText.indexOf("user doesn't exist") >= 0) {
                    lastError = { type: "auth", message: "Token 无效或已过期，用户不存在" };
                } else {
                    console.log("该类型收藏不存在或为空");
                }
                break;
            }

            if (xhr.status !== 200) {
                lastError = { type: "http", code: xhr.status, message: `HTTP 错误: ${xhr.status}` };
                console.log(`获取收藏第 ${page} 页失败: ${xhr.status}`);
                break;
            }

            let raw;
            try {
                raw = JSON.parse(xhr.responseText);
            } catch (e) {
                lastError = { type: "parse", message: "响应数据格式错误" };
                console.log("解析收藏数据失败");
                break;
            }

            // API 返回格式: { data: [...], total: N, limit: 100, offset: 0 }
            let items = Array.isArray(raw) ? raw : (raw.data || []);
            
            if (!Array.isArray(items) || items.length === 0) {
                // 空数据，可能用户确实没有该类型收藏
                break;
            }

            // 添加到结果集
            for (let i = 0; i < items.length; i++) {
                allCollections.push(items[i]);
            }

            // 如果返回数据少于 limit，说明已经是最后一页
            if (items.length < limit) {
                break;
            }

            page++;
        }
    } catch (e) {
        lastError = { type: "exception", message: e.message };
        console.error("获取收藏列表出错:", e);
    }

    console.log(`共获取 ${allCollections.length} 条收藏记录`);

    // 保存错误信息供外部访问
    if (lastError) {
        fetchAllUserCollections.lastError = lastError;
    }

    return allCollections;
}

// ========== 过滤详细预览项目 ==========
function filterDetailItems(filterType) {
    detailPreviewData.currentFilter = filterType;

    // 更新按钮状态
    let buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (filterType === 'all' && btn.classList.contains('all')) {
            btn.classList.add('active');
        } else if (btn.classList.contains('type-' + filterType)) {
            btn.classList.add('active');
        }
    });

    // 过滤并显示项目
    let modalBody = document.getElementById("detailModalBody");
    if (!modalBody) return;

    // 获取完整统计信息
    let totalWithType = detailPreviewData.totalWithType || 0;
    let typeCount = detailPreviewData.typeCount || {1:0, 2:0, 3:0, 4:0, 5:0};

    // 过滤项目（只过滤显示的项目，不改变总数）
    let filteredItems = detailPreviewData.allItems;
    if (filterType !== 'all') {
        filteredItems = filteredItems.filter(item => item.type === parseInt(filterType));
    }

    // 更新统计显示（使用完整统计而非过滤后的）
    let totalCard = modalBody.querySelector('.stat-card:first-child .stat-value');
    let uploadCard = modalBody.querySelector('.stat-card:nth-child(2) .stat-value');
    let validCard = modalBody.querySelector('.stat-card.success .stat-value');
    if (totalCard) totalCard.textContent = detailPreviewData.allItems.length;
    if (uploadCard) uploadCard.textContent = filterType === 'all' ? totalWithType : (typeCount[filterType] || 0);
    if (validCard) validCard.textContent = detailPreviewData.totalValid || 0;

    // 移除所有项目，重新添加过滤后的
    let allItems = modalBody.querySelectorAll('.detail-item');
    allItems.forEach(item => item.remove());

    // 添加过滤后的项目
    let tempDiv = document.createElement('div');
    filteredItems.forEach(item => {
        tempDiv.innerHTML = item.html;
        modalBody.appendChild(tempDiv.firstElementChild);
    });
}

// ========== 关闭详细预览模态框 ==========
function closeDetailModal() {
    document.getElementById("detailModal").style.display = "none";
}

// ========== 解析 JSON 请求体为可读摘要 ==========
/**
 * 将 bangumi 上传请求的 JSON 解析为可读的描述文本
 * @param {string} jsonStr - JSON 字符串
 * @returns {string} 可读的描述，如 "状态:看过 评分:8 标签:[动画] 评价:很好看"
 */
function parseJsonBodySummary(jsonStr) {
    if (!jsonStr) return "(空)";
    try {
        let obj = JSON.parse(jsonStr);
        let parts = [];
        
        // 收藏状态
        let typeMap = {1:"想看", 2:"在看", 3:"看过", 4:"搁置", 5:"抛弃"};
        if (obj.type !== undefined) {
            parts.push("状态:" + (typeMap[obj.type] || obj.type));
        }
        
        // 评分
        if (obj.rate !== undefined && obj.rate > 0) {
            parts.push("评分:" + obj.rate);
        }
        
        // 标签
        if (obj.tags && obj.tags.length > 0) {
            parts.push("标签:[" + obj.tags.join(",") + "]");
        }
        
        // 评论
        if (obj.comment) {
            let comment = obj.comment.length > 30 ? obj.comment.substring(0, 30) + "..." : obj.comment;
            parts.push("评价:" + comment);
        }
        
        return parts.length > 0 ? parts.join(" | ") : "(仅标记状态)";
    } catch (e) {
        return jsonStr;
    }
}

// ========== 面板操作处理 ==========
function onAction(action) {
    switch (action) {
        case "sync":
            syncFromPanel();
            break;
        case "test":
            testSingleUpdate();
            break;
        case "clear":
            clearRowColors();
            refreshData();
            break;
        case "setToken":
            showTokenDialog(loadBgToken() || "");
            break;
        case "preview":
            previewSyncContent();
            break;
    }
}

// ========== 从面板同步 ==========
function syncFromPanel() {
    console.log("syncFromPanel 开始执行");
    
    // 检查必需函数是否已加载
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined' || typeof getLastRow === 'undefined') {
        console.error("syncFromPanel - 必需函数未加载");
        alert("正在加载脚本，请稍后重试...");
        return;
    }
    
    console.log("syncFromPanel - 必需函数已加载，开始同步...");

    let token = loadBgToken();
    if (!token) {
        alert("请先设置 Bangumi Token！");
        showTokenDialog("");
        return;
    }

    let select = document.getElementById("sheetSelect");
    let endRowInput = document.getElementById("endRow");
    let startRowInput = document.getElementById("startRow");

    // 优先使用锁定的工作表，否则使用选择器的值
    let sheetIndex = window.lockedSheetIndex || parseInt(select.value) || 1;
    let userEndRow = parseInt(endRowInput?.value) || 0;
    let selectMode = document.querySelector('input[name="selectMode"]:checked')?.value || 'auto';

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets.Item(sheetIndex);

        // 自动检测表头行
        let headerRow = findHeaderRow(ws);
        if (headerRow === 0) {
            headerRow = 1;
        }
        let dataStartRow = headerRow + 1;

        // 获取最后一行
        let lastRowCell = getCell(ws, ws.Rows.Count, 1);
        let lastRow = lastRowCell.End(-4162).Row;
        let actualEndRow = userEndRow > 0 ? Math.min(userEndRow, lastRow) : lastRow;

        // 获取列映射
        let colMap = getColumnMap(ws, headerRow);
        if (!colMap.has("Bangumi_URL")) {
            alert("未找到 Bangumi URL 列！");
            return;
        }

        // 确定要处理的行范围
        let rowsToProcess = [];
        
        if (selectMode === 'auto') {
            // 自动模式：根据D列序列号连续性识别有效数据行
            let seqResult = getSequentialRowsBySeqCol(dataStartRow, actualEndRow);
            rowsToProcess = seqResult.validRows || [];
        } else {
            // 手动模式：使用用户指定的范围
            let manualStart = parseInt(startRowInput?.value) || dataStartRow;
            let manualEnd = parseInt(endRowInput?.value) || lastRow;
            // 确保范围有效
            if (isNaN(manualStart)) manualStart = dataStartRow;
            if (isNaN(manualEnd)) manualEnd = lastRow;
            if (manualStart > manualEnd) {
                manualStart = dataStartRow;
                manualEnd = lastRow;
            }
            for (let i = manualStart; i <= manualEnd; i++) {
                rowsToProcess.push(i);
            }
        }

        if (rowsToProcess.length === 0) {
            alert("没有需要同步的数据行！");
            return;
        }

        let confirmMsg = `将同步 ${rowsToProcess.length} 行数据到 Bangumi\n\n`;
        confirmMsg += "根据D列序列号识别有效数据行\n";
        confirmMsg += "\n是否继续？";
        
        // 使用自定义确认对话框
        showConfirmDialog(confirmMsg, () => {
            _runSyncRows(ws, colMap, rowsToProcess, headerRow);
        });
        return;
    } catch (e) {
        console.error("同步失败:", e);
        setStatus("同步失败: " + e.message, "error");
    }
}

// ========== 执行同步行数据 ==========
function _runSyncRows(ws, colMap, rowsToProcess, headerRow) {
    let token = loadBgToken();
    if (!token) {
        alert("请先设置 Bangumi Token！");
        return;
    }
    
    setStatus("正在同步...", "loading");

    try {
        let successCount = 0, failCount = 0, skipNoUrlCount = 0, skipNoTypeCount = 0;
        let total = rowsToProcess.length;

        // 收集详细日志信息
        let syncLog = {
            success: [],
            fail: [],
            skipNoUrl: [],
            skipNoType: []
        };

        for (let idx = 0; idx < rowsToProcess.length; idx++) {
            let i = rowsToProcess[idx];
            
            // 安全获取 Bangumi URL
            let bgmUrlCell = getCell(ws, i, colMap.get("Bangumi_URL"));
            let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
            let subjectId = extractSubjectId(bgmUrl);

            // 获取名称
            let name = "";
            if (colMap.has("名称")) {
                let nameCell = getCell(ws, i, colMap.get("名称"));
                name = nameCell ? trim(String(nameCell.Value() || "")) : "";
            }

            // 获取观看状态
            let watchStatus = "";
            if (colMap.has("是否看完")) {
                let statusCell = getCell(ws, i, colMap.get("是否看完"));
                watchStatus = statusCell ? trim(String(statusCell.Value() || "")) : "";
            }

            // 获取评级
            let rateVal = "";
            if (colMap.has("打分")) {
                let rateCell = getCell(ws, i, colMap.get("打分"));
                rateVal = rateCell ? trim(String(rateCell.Value() || "")) : "";
            }

            // 构建 readable 内容摘要
            let contentSummary = "";

            if (subjectId === "") {
                skipNoUrlCount++;
                if (bgmUrlCell) bgmUrlCell.Interior.Color = BGM_COLOR.SKIP;
                
                // 记录跳过原因：无BGM链接
                let skipReason = name ? `跳过行${i}「${name}」：缺少 Bangumi URL` : `跳过行${i}：缺少 Bangumi URL`;
                console.log("syncFromPanel - " + skipReason);
                syncLog.skipNoUrl.push({ row: i, name: name, reason: "缺少 Bangumi URL" });
                
                // 记录到同步记录表
                addSyncRecord({
                    name: name || "(无名称)",
                    url: "",
                    sid: "",
                    type: "",
                    content: "跳过原因：缺少 Bangumi URL",
                    status: "跳过",
                    message: "行" + i + " 无BGM链接",
                    count: 1
                });
                continue;
            }

            // 获取完播日
            let finishedDate = "";
            if (colMap.has("完播日")) {
                let finishedDateCell = getCell(ws, i, colMap.get("完播日"));
                finishedDate = finishedDateCell ? trim(String(finishedDateCell.Value() || "")) : "";
            }

            // 构建完整请求体
            let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);
            if (jsonBody === "") {
                skipNoTypeCount++;
                
                // 记录跳过原因：观看状态=不上传（空白/否/想看）
                let skipReason = name ? `跳过行${i}「${name}」(SID=${subjectId})：观看状态「${watchStatus}」不上传` : `跳过行${i}(SID=${subjectId})：观看状态「${watchStatus}」不上传`;
                console.log("syncFromPanel - " + skipReason);
                syncLog.skipNoType.push({ row: i, name: name, sid: subjectId, status: watchStatus, reason: "观看状态不上传" });
                
                // 记录到同步记录表
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: subjectId,
                    type: "",
                    content: "跳过原因：观看状态「" + watchStatus + "」不需要上传",
                    status: "跳过",
                    message: "行" + i + " 状态=不传",
                    count: 1
                });
                continue;
            }

            let result = bgmRequestSync("POST", "/v0/users/" + _getUserApiPath() + "/collections/" + subjectId, jsonBody, token);
            let statusCode = result.code;

            if (statusCode === 204 || statusCode === 200 || statusCode === 201 || statusCode === 202) {
                // 上传成功
                successCount++;
                if (bgmUrlCell) bgmUrlCell.Interior.Color = BGM_COLOR.SUCCESS;
                
                // 构建可读的上传内容描述
                let parsedBody = parseJsonBodySummary(jsonBody);
                let uploadDesc = "上传内容：" + parsedBody;
                contentSummary = uploadDesc + " | 完整JSON: " + jsonBody;
                
                console.log("syncFromPanel - 上传成功，行" + i + "「" + name + "」(SID=" + subjectId + ") " + uploadDesc);
                syncLog.success.push({ row: i, name: name, sid: subjectId, body: jsonBody, summary: parsedBody });
                
                // 添加同步记录
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: subjectId,
                    type: "",
                    content: contentSummary,
                    status: "成功",
                    message: "行" + i,
                    count: 1
                });
            } else {
                failCount++;
                if (bgmUrlCell) bgmUrlCell.Interior.Color = BGM_COLOR.FAIL;

                let failMsg = result.message || "HTTP " + statusCode;
                let parsedBody = parseJsonBodySummary(jsonBody);
                contentSummary = "上传内容：" + parsedBody;
                
                console.log("syncFromPanel - 上传失败，行" + i + "「" + name + "」(SID=" + subjectId + ") 错误:" + failMsg + " 数据:" + jsonBody);
                syncLog.fail.push({ row: i, name: name, sid: subjectId, body: jsonBody, summary: parsedBody, error: failMsg });
                
                // 添加失败记录
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: subjectId,
                    type: "",
                    content: contentSummary + " | 完整JSON: " + jsonBody,
                    status: "失败",
                    message: failMsg,
                    count: 1
                });
            }

            // 进度
            if (idx % 5 === 0) {
                window.Application.StatusBar = `同步进度: ${idx + 1}/${total} 成功:${successCount} 失败:${failCount} 跳过:${skipNoUrlCount + skipNoTypeCount}`;
            }

            // 延迟
            sleep(REQUEST_DELAY);
        }

        window.Application.StatusBar = false;

        let skipTotal = skipNoUrlCount + skipNoTypeCount;
        setStatus(`完成! 成功:${successCount} 失败:${failCount} 跳过:${skipTotal}`, "success");

        // 构建详细的同步报告
        let report = `同步完成！\n`;
        report += `━━━━━━━━━━━━━━━━━━\n`;
        report += `✅ 成功上传: ${successCount} 条\n`;
        report += `❌ 上传失败: ${failCount} 条\n`;
        report += `⏭️ 跳过(无URL): ${skipNoUrlCount} 条\n`;
        report += `⏭️ 跳过(不须上传): ${skipNoTypeCount} 条\n`;
        report += `━━━━━━━━━━━━━━━━━━\n\n`;
        
        // 成功详情（最多显示10条）
        if (successCount > 0) {
            report += `✅ 已上传的条目：\n`;
            let showSuccess = Math.min(syncLog.success.length, 10);
            for (let s = 0; s < showSuccess; s++) {
                let item = syncLog.success[s];
                report += `  ${s+1}. ${item.name || "(无名称)"} [SID=${item.sid}]\n`;
                report += `     ${item.summary}\n`;
            }
            if (syncLog.success.length > 10) {
                report += `     ... 还有 ${syncLog.success.length - 10} 条\n`;
            }
            report += `\n`;
        }

        // 失败详情
        if (failCount > 0) {
            report += `❌ 失败的条目（需检查）：\n`;
            for (let f = 0; f < syncLog.fail.length; f++) {
                let item = syncLog.fail[f];
                report += `  ${f+1}. ${item.name || "(无名称)"} [SID=${item.sid}]\n`;
                report += `     错误: ${item.error}\n`;
                report += `     数据: ${item.summary}\n`;
            }
            report += `\n`;
        }

        // 跳过详情（无URL）
        if (skipNoUrlCount > 0) {
            report += `⏭️ 跳过（无BGM链接）：\n`;
            let showSkip = Math.min(syncLog.skipNoUrl.length, 5);
            for (let s = 0; s < showSkip; s++) {
                let item = syncLog.skipNoUrl[s];
                report += `  ${s+1}. 行${item.row}：${item.name || "(无名称)"}\n`;
            }
            if (syncLog.skipNoUrl.length > 5) {
                report += `     ... 还有 ${syncLog.skipNoUrl.length - 5} 条\n`;
            }
            report += `\n`;
        }

        // 跳过详情（不需上传）
        if (skipNoTypeCount > 0) {
            report += `⏭️ 跳过（不需上传）：\n`;
            let showSkip = Math.min(syncLog.skipNoType.length, 5);
            for (let s = 0; s < showSkip; s++) {
                let item = syncLog.skipNoType[s];
                report += `  ${s+1}. 行${item.row}：${item.name || "(无名称)"} [SID=${item.sid}]\n`;
                report += `     状态: "${item.status}" → 不上传\n`;
            }
            if (syncLog.skipNoType.length > 5) {
                report += `     ... 还有 ${syncLog.skipNoType.length - 5} 条\n`;
            }
            report += `\n`;
        }

        report += `📋 详细记录已保存到"同步记录"工作表`;
        
        alert(report);
        
        // 刷新预览
        refreshData();
    } catch (e) {
        console.error("同步失败:", e);
        setStatus("同步失败: " + e.message, "error");
    }
}

// ========== Toast 通知（非模态提示）==========
let _toastTimer = null;

function showToast(message, type, duration) {
    if (_toastTimer) {
        clearTimeout(_toastTimer);
        _toastTimer = null;
    }
    let toast = document.getElementById("toastNotification");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toastNotification";
        toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2000;padding:10px 20px;border-radius:8px;font-size:13px;color:#fff;max-width:90%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.4);transition:opacity 0.3s;display:none;";
        document.body.appendChild(toast);
    }
    
    let bgColors = { success: "#22a84d", error: "#e74c3c", info: "#3498db", warning: "#f39c12" };
    toast.style.background = bgColors[type] || "#555";
    toast.textContent = message;
    toast.style.display = "block";
    toast.style.opacity = "1";
    
    _toastTimer = setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => { toast.style.display = "none"; }, 300);
        _toastTimer = null;
    }, duration || 3000);
}

// ========== 测试调试连接 ==========
function testDebugConnection() {
    setStatus("测试连接...", "loading");
    try {
        let xhr = new XMLHttpRequest();
        xhr.open("GET", "/.debugTemp/Ping", false);
        xhr.send();
        if (xhr.status === 200) {
            let data = JSON.parse(xhr.responseText);
            setStatus("连接正常: " + data.message, "success");
        } else {
            setStatus("连接失败: HTTP " + xhr.status, "error");
        }
    } catch (e) {
        setStatus("调试服务器未连接", "info");
    }
}

// ========== 设置状态 ==========
function setStatus(msg, type) {
    let statusBox = document.getElementById("statusBox");
    if (statusBox) {
        statusBox.textContent = msg;
        statusBox.className = "status " + (type || "");
    }
}



// ========== 验证 Token（返回 {valid, username, message}）==========
function _verifyToken(token) {
    if (!token) return { valid: false, message: "Token 为空" };
    try {
        let xhr = new XMLHttpRequest();
        xhr.open("GET", "https://api.bgm.tv/v0/me", false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.send();

        if (xhr.status === 200) {
            let data = JSON.parse(xhr.responseText);
            return { valid: true, userId: data.id, username: data.nickname || data.username || "未知", message: "Token 有效" };
        }
        if (xhr.status === 401) {
            return { valid: false, message: "Token 无效或已过期（HTTP 401）" };
        }
        return { valid: false, message: `Token 验证失败（HTTP ${xhr.status}）` };
    } catch (e) {
        return { valid: false, message: "Token 验证请求失败: " + e.message };
    }
}

// ========== 测试 Token 有效性（taskpane版本，更新UI状态）==========
function testTokenValidity(token) {
    if (!token) {
        let storedToken = loadBgToken();
        if (!storedToken) {
            alert("请先设置 Token！");
            return false;
        }
        token = storedToken;
    }

    setStatus("正在验证 Token...", "loading");

    let xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.bgm.tv/v0/me", false);
    xhr.setRequestHeader("Authorization", "Bearer " + token);

    try {
        xhr.send();
        if (xhr.status === 200) {
            let userData = JSON.parse(xhr.responseText);
            
            // 自动保存用户ID和用户名
            let userId = String(userData.id);
            let username = userData.nickname || userData.username || "";
            window.Application.PluginStorage.setItem("bgm_user_id", userId);
            window.Application.PluginStorage.setItem("bgm_username", username);
            updateUserIdStatus();
            
            setStatus("Token 有效！用户: " + username, "success");
            alert("✓ Token 验证成功！\n\n用户: " + username + "\nID: " + userId + "\n\n用户信息已自动保存！");
            return true;
        } else if (xhr.status === 401) {
            clearBgToken();
            updateTokenStatus();
            setStatus("Token 无效", "error");
            alert("✗ Token 验证失败！\n\nToken 已清除，请重新获取正确的 Token。");
            return false;
        } else {
            setStatus("验证失败 (" + xhr.status + ")", "error");
            alert("验证失败 (" + xhr.status + "): " + xhr.responseText);
            return false;
        }
    } catch (err) {
        setStatus("验证出错", "error");
        alert("验证出错: " + err.message);
        return false;
    }
}

// ========== 打开用户收藏页 ==========
function openUserCollection() {
    let userId = window.Application.PluginStorage.getItem("bgm_user_id");
    if (!userId) {
        alert("请先设置用户ID！");
        showUserIdDialog();
        return;
    }
    let url = "https://bgm.tv/anime/list/" + userId + "/collect";
    try {
        if (window.Application && window.Application.OAAssist) {
            window.Application.OAAssist.ShellExecute(url);
        } else {
            window.open(url, "_blank");
        }
    } catch (e) {
        window.open(url, "_blank");
    }
}

// ========== Token 设置对话框（TaskPane 版本，使用自定义 UI）==========
function showTokenDialog(currentToken) {
    showInputDialog(
        "设置 Bangumi Token",
        "请输入 Bangumi Access Token<br><br>获取方式：从 <a href='https://next.bgm.tv/demo/access-token/create' target='_blank'>https://next.bgm.tv/demo/access-token/create</a> 创建",
        currentToken || "",
        (token) => {
            if (token && token.trim() !== "") {
                storeBgToken(token.trim());
                updateTokenStatus();
                testTokenValidity(token.trim());
            }
        }
    );
}

// ========== 用户ID 设置对话框（TaskPane 版本，使用自定义 UI）==========
function showUserIdDialog() {
    let currentId = window.Application.PluginStorage.getItem("bgm_user_id") || "";
    showInputDialog(
        "设置 Bangumi 用户ID",
        "请输入 Bangumi 用户ID<br><br>获取方式：打开你的 Bangumi 主页，URL 中的数字/字母即为用户ID<br>例如：https://bgm.tv/user/972358 → 用户ID: 972358",
        currentId,
        (userId) => {
            if (userId && userId.trim() !== "") {
                window.Application.PluginStorage.setItem("bgm_user_id", userId.trim());
                updateUserIdStatus();
                alert("用户ID 设置成功！");
            }
        }
    );
}

// ========== 从 BGM 获取收藏并写入同步记录表 ==========
function fetchBgCollectionRecords() {
    let token = loadBgToken();
    if (!token) {
        alert("请先设置 Bangumi Token！\n\n需要 Token 才能访问你的收藏列表。");
        showTokenDialog("");
        return;
    }
    
    // 让用户选择获取范围（使用自定义对话框）
    _fetchRecordsScopeSelect(token);
}

// ========== 从BGM同步收藏记录：选择范围 ==========
function _fetchRecordsScopeSelect(token) {
    showConfirmDialog(
        "请选择获取范围：\n\n" +
        "点击「确定」→ 获取所有类型（约500条）\n" +
        "      包含：动画、书籍、音乐、游戏、真人剧\n" +
        "点击「取消」→ 自定义（仅动画或自定义条数）",
        () => {
            // 确定：获取所有类型
            _runFetchBgRecords(token, true, 500);
        },
        () => {
            // 取消：进入自定义
            showConfirmDialog(
                "获取范围：\n\n" +
                "点击「确定」→ 仅获取动画\n" +
                "点击「取消」→ 自定义条数",
                () => {
                    _runFetchBgRecords(token, false, 500);
                },
                () => {
                    // 自定义条数
                    showInputDialog(
                        "自定义条数",
                        "请输入要获取的条数（建议不超过 500）：",
                        "500",
                        (count) => {
                            if (!count) return;
                            let maxItems = parseInt(count) || 500;
                            if (maxItems < 1) maxItems = 1;
                            if (maxItems > 1000) maxItems = 1000;
                            // 选择类型
                            showConfirmDialog(
                                "获取类型：\n\n" +
                                "点击「确定」→ 仅动画\n" +
                                "点击「取消」→ 所有类型",
                                () => { _runFetchBgRecords(token, false, maxItems); },
                                () => { _runFetchBgRecords(token, true, maxItems); }
                            );
                        }
                    );
                }
            );
        }
    );
}

// ========== 执行从 BGM 获取收藏并写入同步记录表 ==========
function _runFetchBgRecords(token, includeAllTypes, maxItems) {
    let typeDesc = includeAllTypes ? "所有类型（动画、书籍、音乐、游戏、真人剧）" : "动画";
    showConfirmDialog(`将从 Bangumi 获取你的收藏列表并写入"同步记录"表。\n\n类型：${typeDesc}\n最大条数：${maxItems}\n\n是否继续？`, () => {
        setStatus("正在获取收藏列表...", "loading");
        
        try {
            let result = fetchAndRecordBgCollections(
                token, 
                includeAllTypes, 
                maxItems,
                (current, total, message) => {
                    setStatus(message, "loading");
                    if (window.Application) {
                        window.Application.StatusBar = message;
                    }
                }
            );
            
            window.Application.StatusBar = false;
            
            if (result.success) {
                setStatus(result.message, "success");
                alert(`✓ ${result.message}\n\n请打开"同步记录"工作表查看。`);
                openSyncRecordSheet();
            } else {
                setStatus(result.message, "error");
                alert(`✗ ${result.message}`);
            }
        } catch (e) {
            window.Application.StatusBar = false;
            setStatus("发生错误", "error");
            alert("发生错误: " + e.message);
        }
    });
}

// ========== 标记已上传条目到工作表 D 列 ==========

/**
 * 从同步记录表标记已上传的条目到当前工作表 D 列
 * @param {string} sheetType - 工作表类型："动画" 或 "书籍"
 */
function markUploadedItems(sheetType) {
    let app = window.Application;
    if (!app || !app.ActiveWorkbook) {
        alert("无法获取工作簿");
        return;
    }
    
    let currentSheet = app.ActiveSheet;
    if (!currentSheet) {
        alert("未找到当前工作表");
        return;
    }
    
    let sheetName = currentSheet.Name;
    
    // 确认操作（使用自定义对话框）
    let typeName = sheetType === "动画" ? "动画（剧集）" : "书籍（小说）";
    showConfirmDialog(`将在当前工作表「${sheetName}」的 D 列标记已上传到 BGM 的${typeName}条目。\n\n注意：\n1. 会自动查找名称或 URL 匹配的条目\n2. 已标记的行会跳过\n3. 请确保同步记录表中已有相关条目\n\n是否继续？`, () => {
        _doMarkUploaded(sheetType, app);
    });
}

// ========== 执行标记已上传条目 ==========
function _doMarkUploaded(sheetType, app) {
    setStatus("正在标记已上传条目...", "loading");
    
    try {
        let result = markUploadedItemsInSheet(
            sheetType,
            (current, total, message) => {
                setStatus(message, "loading");
                if (app) {
                    app.StatusBar = message;
                }
            }
        );
        
        app.StatusBar = false;
        
        if (result.success) {
            setStatus(result.message, "success");
            alert(`✓ ${result.message}`);
        } else {
            setStatus(result.message, "error");
            alert(`✗ ${result.message}`);
        }
    } catch (e) {
        app.StatusBar = false;
        setStatus("发生错误", "error");
        alert("发生错误: " + e.message);
    }
}

/**
 * 清除当前工作表 D 列的同步状态标记
 */
function clearSheetMarks() {
    let app = window.Application;
    if (!app || !app.ActiveWorkbook) {
        alert("无法获取工作簿");
        return;
    }
    
    let currentSheet = app.ActiveSheet;
    if (!currentSheet) {
        alert("未找到当前工作表");
        return;
    }
    
    let sheetName = currentSheet.Name;
    
    showConfirmDialog(`将清除当前工作表「${sheetName}」D 列的所有同步标记。\n\n是否继续？`, () => {
        _doClearSheetMarks(currentSheet);
    });
}

// ========== 执行清除 D 列标记 ==========
function _doClearSheetMarks(ws) {
    try {
        let lastRow = ws.Range("A" + ws.Rows.Count).End(-4162).Row;
        let clearedCount = 0;
        
        for (let i = 2; i <= lastRow; i++) {
            let cellD = ws.Range("D" + i);
            if (cellD.Value2 && String(cellD.Value2).includes("BGM已上传")) {
                cellD.Value2 = "";
                cellD.Interior.Color = BGM_COLOR.WHITE;
                clearedCount++;
            }
        }
        
        alert(`✓ 已清除 ${clearedCount} 个标记`);
        
    } catch (e) {
        alert("发生错误: " + e.message);
    }
}
