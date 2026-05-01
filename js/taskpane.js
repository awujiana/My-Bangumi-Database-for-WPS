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
        setTokenBtn.onclick = () => showTokenDialog(window.Application.PluginStorage.getItem("bgm_token") || "");
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

    // 绑定清除同步记录按钮
    let clearRecordsBtn = document.getElementById("clearRecordsBtn");
    if (clearRecordsBtn) {
        clearRecordsBtn.onclick = () => clearSyncRecords();
    }

    // 绑定工作表选择事件
    let sheetSelect = document.getElementById("sheetSelect");
    if (sheetSelect) {
        sheetSelect.onchange = () => refreshData();
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

// ========== Token 状态更新 ==========
function updateTokenStatus() {
    let token = window.Application.PluginStorage.getItem("bgm_token");
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

    let sheetIndex = parseInt(select.value) || 1;
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

    let sheetIndex = parseInt(select?.value) || 1;
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

            // 检查D列单元格颜色（#92d050 = 绿色 = 已上传）
            let seqCell = getCell(ws, i, seqCol);
            let isUploaded = false;
            try {
                if (seqCell && seqCell.Interior) {
                    let colorValue = seqCell.Interior.Color;
                    // #92d050 = RGB(146, 208, 80) = 0x50D050 = 5251664
                    if (colorValue === 0x50D050 || colorValue === 5251664 || colorValue === 14620880) {
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
                            '<span class="uploaded-badge">✓ 已上传</span>' : 
                            `<button class="upload-single-btn" onclick="uploadSingleRow(${rowData.row}, this)">上传</button>`
                        }
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
                                POST /v0/users/-/collections/${rowData.sid}
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
    let token = window.Application.PluginStorage.getItem("bgm_token");
    if (!token) {
        alert("请先设置 Bangumi Token！");
        return;
    }

    // 禁用按钮，防止重复点击
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.classList.add('uploading');
        btnElement.textContent = '验证中...';
    }

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets.Item(parseInt(document.getElementById("sheetSelect")?.value) || 1);

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

        // 构建请求体
        let jsonBody = buildJsonPayload(ws, rowNum, colMap, finishedDate);
        if (jsonBody === "") {
            throw new Error("无法构建请求体");
        }

        // 发送上传请求
        let result = bgmRequestSync("POST", "/v0/users/-/collections/" + sid, jsonBody, token);
        let statusCode = result.code;

        // 获取D列单元格标记颜色
        let seqCol = 4;
        let seqCell = getCell(ws, rowNum, seqCol);

        if (statusCode === 204 || statusCode === 200 || statusCode === 201 || statusCode === 202) {
            // 上传成功，现在验证
            if (btnElement) {
                btnElement.textContent = '验证中...';
            }

            // 调用 API 获取收藏信息验证
            let verifyResult = verifyUpload(sid, jsonBody, token);
            
            if (verifyResult.success) {
                // 验证成功：标记为绿色
                if (seqCell && seqCell.Interior) {
                    seqCell.Interior.Color = 0x50D050; // #92d050
                }
                
                // 更新按钮显示
                if (btnElement) {
                    btnElement.classList.remove('uploading');
                    btnElement.classList.add('success');
                    btnElement.textContent = '✓ 已上传';
                    btnElement.disabled = false;
                }

                // 更新详情项样式
                let detailItem = btnElement?.closest('.detail-item');
                if (detailItem) {
                    detailItem.classList.remove('pending');
                    detailItem.classList.add('uploaded');
                }

                // 添加同步记录
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: sid,
                    content: jsonBody,
                    status: "成功",
                    message: "行 " + rowNum,
                    count: 1
                });

                // 更新统计信息
                updateUploadStats();
            } else {
                // 验证失败：标记为橙色警告
                if (seqCell && seqCell.Interior) {
                    seqCell.Interior.Color = 0xFFA500; // 橙色警告
                }
                
                if (btnElement) {
                    btnElement.classList.remove('uploading');
                    btnElement.classList.add('error');
                    btnElement.textContent = '⚠ 异常';
                    btnElement.disabled = false;
                }
                
                // 添加验证失败的同步记录
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: sid,
                    content: jsonBody,
                    status: "验证异常",
                    message: verifyResult.message || "验证失败",
                    count: 1
                });
                
                alert(`上传到 Bangumi 成功，但验证失败：\n${verifyResult.message}\n\n请手动检查 https://bgm.tv/subject/${sid}`);
            }
            
        } else {
            // 上传失败：标记为红色
            if (seqCell && seqCell.Interior) {
                seqCell.Interior.Color = 0xFFCCCC;
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
            
            alert(`上传失败 (${statusCode}): ${result.message || '未知错误'}`);
        }

    } catch (e) {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.classList.remove('uploading');
            btnElement.classList.add('error');
            btnElement.textContent = '✗ 错误';
        }
        alert("上传出错: " + e.message);
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

// ========== 验证上传结果 ==========
function verifyUpload(sid, sentJsonBody, token) {
    try {
        // 调用 BGM API 获取该条目的收藏信息
        let verifyResult = bgmRequestSync("GET", "/v0/users/-/collections/" + sid, null, token);
        
        if (verifyResult.code !== 200) {
            return { success: false, message: `验证请求失败 (${verifyResult.code})` };
        }

        // 解析返回的收藏数据
        let collection;
        try {
            collection = JSON.parse(verifyResult.message);
        } catch (e) {
            return { success: false, message: "无法解析收藏数据" };
        }

        // 解析发送的数据
        let sentData;
        try {
            sentData = JSON.parse(sentJsonBody);
        } catch (e) {
            return { success: false, message: "无法解析发送的数据" };
        }

        // 验证关键字段
        let typeMatch = collection.type === sentData.type;
        let rateMatch = collection.rate === sentData.rate;

        // 构建验证详情
        let details = [];
        details.push(`类型: ${getTypeName(collection.type)} ${typeMatch ? '✓' : '✗'}`);
        details.push(`评分: ${collection.rate || '(无)'} ${rateMatch ? '✓' : '✗'}`);
        
        if (sentData.ep_status !== undefined) {
            details.push(`进度: ${collection.ep_status}/${sentData.ep_status}`);
        }

        if (!typeMatch || !rateMatch) {
            return { 
                success: false, 
                message: details.join('\n'),
                details: details
            };
        }

        return { 
            success: true, 
            message: '验证通过',
            collection: collection
        };

    } catch (e) {
        return { success: false, message: "验证出错: " + e.message };
    }
}

// 获取收藏类型名称
function getTypeName(type) {
    let names = {1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃', 6: '未看'};
    return names[type] || '未知(' + type + ')';
}

// ========== 从BGM同步收藏标记 ==========
function syncCollectionFromBgm() {
    let token = window.Application.PluginStorage.getItem("bgm_token");
    if (!token) {
        alert("请先设置 Bangumi Token！");
        return;
    }

    let select = document.getElementById("sheetSelect");
    let sheetIndex = parseInt(select?.value) || 1;

    // 确认操作
    if (!confirm("将从 BGM API 获取你的收藏列表，并在 D 列标记已收藏的条目。\n\n是否继续？")) {
        return;
    }

    setStatus("正在获取收藏列表...", "loading");

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
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

        // 获取用户收藏列表
        setStatus("正在获取收藏列表（分页中）...", "loading");
        let userCollections = fetchAllUserCollections(token);

        if (userCollections.length === 0) {
            alert("未能获取到收藏列表，请检查 Token 是否正确。");
            setStatus("获取收藏失败", "error");
            return;
        }

        setStatus(`正在匹配 ${userCollections.length} 条收藏...`, "loading");

        // 构建收藏映射：subject_id -> collection info
        let collectionMap = new Map();
        for (let i = 0; i < userCollections.length; i++) {
            let item = userCollections[i];
            collectionMap.set(item.subject_id, item);
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

        // 颜色定义
        let COLOR_PURPLE = 0x7030A0;     // #7030a0 - 从BGM同步
        let COLOR_LIGHT_GREEN = 0x92D050; // #92d050 - 同步一次
        let COLOR_DARK_GREEN = 0x00B050;  // #00b050 - 同步多次

        // 遍历 Excel 数据并标记
        let matchedCount = 0;
        let totalCount = 0;
        let purpleCount = 0, lightGreenCount = 0, darkGreenCount = 0;

        for (let row = dataStartRow; row <= lastRow; row++) {
            let bgmUrlCell = getCell(ws, row, colMap.get("Bangumi_URL"));
            let bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value() || "")) : "";
            let sid = extractSubjectId(bgmUrl);

            if (sid && collectionMap.has(sid)) {
                let seqCell = getCell(ws, row, seqCol);
                if (seqCell && seqCell.Interior) {
                    // 检查本地同步次数
                    let syncCount = syncCountMap.get(sid) || 0;
                    
                    if (syncCount === 0) {
                        // 从BGM同步但还没有本地记录：紫色
                        seqCell.Interior.Color = COLOR_PURPLE;
                        purpleCount++;
                    } else if (syncCount === 1) {
                        // 同步一次：浅绿色
                        seqCell.Interior.Color = COLOR_LIGHT_GREEN;
                        lightGreenCount++;
                    } else {
                        // 同步多次：深绿色
                        seqCell.Interior.Color = COLOR_DARK_GREEN;
                        darkGreenCount++;
                    }
                }
                matchedCount++;
            }
            totalCount++;

            // 每100行更新一次状态
            if (row % 100 === 0) {
                setStatus(`已处理 ${row}/${lastRow} 行...`, "loading");
            }
        }

        setStatus("就绪", "success");
        alert(`同步完成！\n\n共处理 ${totalCount} 行数据\n匹配到 ${matchedCount} 条已收藏条目\n\nD 列颜色说明：\n🟣 紫色 - 从BGM同步（未本地同步）\n🟢 浅绿色 - 已同步1次\n🌲 深绿色 - 已同步多次`);

    } catch (e) {
        alert("同步失败: " + e.message);
        setStatus("同步失败", "error");
    }
}

// ========== 获取用户所有收藏（分页）==========
function fetchAllUserCollections(token) {
    let allCollections = [];
    let page = 1;
    let limit = 100;
    let maxPages = 50; // 最多获取5000条，防止无限循环
    let subjectType = 2; // 动画

    try {
        while (page <= maxPages) {
            // 获取当前页数据
            let xhr = new XMLHttpRequest();
            let url = `https://api.bgm.tv/v0/users/-/collections?subject_type=${subjectType}&limit=${limit}&offset=${(page - 1) * limit}`;
            xhr.open("GET", url, false); // 同步请求
            xhr.setRequestHeader("Authorization", "Bearer " + token);
            xhr.setRequestHeader("User-Agent", "BangumiWPS/1.0");

            xhr.send();

            if (xhr.status !== 200) {
                console.log(`获取收藏第 ${page} 页失败: ${xhr.status}`);
                break;
            }

            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.log("解析收藏数据失败");
                break;
            }

            if (!Array.isArray(data) || data.length === 0) {
                break;
            }

            // 添加到结果集
            for (let i = 0; i < data.length; i++) {
                allCollections.push(data[i]);
            }

            // 如果返回数据少于 limit，说明已经是最后一页
            if (data.length < limit) {
                break;
            }

            page++;
        }
    } catch (e) {
        console.error("获取收藏列表出错:", e);
    }

    console.log(`共获取 ${allCollections.length} 条收藏记录`);
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
            showTokenDialog(window.Application.PluginStorage.getItem("bgm_token") || "");
            break;
        case "preview":
            previewSyncContent();
            break;
    }
}

// ========== 从面板同步 ==========
function syncFromPanel() {
    // 检查必需函数是否已加载
    if (typeof findHeaderRow === 'undefined' || typeof getColumnMap === 'undefined' || typeof getLastRow === 'undefined') {
        alert("正在加载脚本，请稍后重试...");
        return;
    }

    let token = window.Application.PluginStorage.getItem("bgm_token");
    if (!token) {
        alert("请先设置 Bangumi Token！");
        showTokenDialog("");
        return;
    }

    let select = document.getElementById("sheetSelect");
    let endRowInput = document.getElementById("endRow");
    let startRowInput = document.getElementById("startRow");

    let sheetIndex = parseInt(select.value) || 1;
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
        
        if (!confirm(confirmMsg)) {
            return;
        }

        setStatus("正在同步...", "loading");

        let successCount = 0, failCount = 0, skipCount = 0;
        let total = rowsToProcess.length;

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

            if (subjectId === "") {
                skipCount++;
                if (bgmUrlCell) bgmUrlCell.Interior.Color = 0xFFFFCC;
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
                skipCount++;
                continue;
            }

            let result = bgmRequestSync("POST", "/v0/users/-/collections/" + subjectId, jsonBody, token);
            let statusCode = result.code;

            if (statusCode === 204 || statusCode === 200 || statusCode === 201 || statusCode === 202) {
                // 验证上传结果：调用 BGM API 查看收藏状态
                let verifyResult = verifyUpload(subjectId, jsonBody, token);
                
                if (verifyResult.success) {
                    successCount++;
                    if (bgmUrlCell) bgmUrlCell.Interior.Color = 0xCCFFCC; // 浅绿
                } else {
                    // API返回成功但验证失败，标记为警告色
                    successCount++;
                    if (bgmUrlCell) bgmUrlCell.Interior.Color = 0xFFA500; // 橙色警告
                    console.log("行 " + i + " 验证警告: " + verifyResult.message);
                }
                
                // 添加同步记录
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: subjectId,
                    content: jsonBody,
                    status: verifyResult.success ? "成功" : "验证异常",
                    message: verifyResult.message || "行 " + i,
                    count: 1
                });
            } else {
                failCount++;
                if (bgmUrlCell) bgmUrlCell.Interior.Color = 0xFFCCCC;
                console.log("行 " + i + " 失败: " + result.message);
                
                // 添加失败记录
                addSyncRecord({
                    name: name || "(无名称)",
                    url: bgmUrl,
                    sid: subjectId,
                    content: jsonBody,
                    status: "失败",
                    message: result.message || "HTTP " + statusCode,
                    count: 1
                });
            }

            // 进度
            if (idx % 5 === 0) {
                window.Application.StatusBar = `同步进度: ${idx + 1}/${total}`;
            }

            // 延迟
            sleep(REQUEST_DELAY);
        }

        window.Application.StatusBar = false;

        setStatus(`完成! 成功:${successCount} 失败:${failCount} 跳过:${skipCount}`, "success");

        alert(`同步完成！\n成功: ${successCount}\n失败: ${failCount}\n跳过: ${skipCount}\n\n同步记录已保存到"同步记录"工作表`);
        
        // 刷新预览
        refreshData();
    } catch (e) {
        console.error("同步失败:", e);
        setStatus("同步失败: " + e.message, "error");
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



// ========== 测试 Token 有效性（taskpane版本，更新UI状态）==========
function testTokenValidity(token) {
    if (!token) {
        let storedToken = window.Application.PluginStorage.getItem("bgm_token");
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
    xhr.setRequestHeader("User-Agent", "BangumiWPS/1.0");

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
            window.Application.PluginStorage.setItem("bgm_token", "");
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
    let url = "https://bgm.tv/anime/list/" + userId + "/wish";
    window.open(url, "_blank");
}

// ========== Token 设置对话框（TaskPane 版本，使用自定义 UI）==========
function showTokenDialog(currentToken) {
    showInputDialog(
        "设置 Bangumi Token",
        "请输入 Bangumi Access Token<br><br>获取方式：从 <a href='https://next.bgm.tv/demo/access-token/create' target='_blank'>https://next.bgm.tv/demo/access-token/create</a> 创建",
        currentToken || "",
        (token) => {
            if (token && token.trim() !== "") {
                window.Application.PluginStorage.setItem("bgm_token", token.trim());
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
