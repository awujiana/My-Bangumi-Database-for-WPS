// ========== 辅助函数：优先使用 bangumi.js 中的版本 ==========
// 如果 bangumi.js 已加载，使用其版本；否则使用本地版本
if (typeof colNumToLetter === 'undefined') {
    function colNumToLetter(col) {
        let letter = "";
        while (col > 0) {
            let mod = (col - 1) % 26;
            letter = String.fromCharCode(65 + mod) + letter;
            col = Math.floor((col - mod) / 26);
        }
        return letter;
    }
}

if (typeof getCell === 'undefined') {
    function getCell(ws, row, col) {
        try {
            if (typeof ws.Range === 'function') {
                let colLetter = colNumToLetter(col);
                return ws.Range(colLetter + row);
            }
            if (ws.Cells && typeof ws.Cells.Item === 'function') {
                return ws.Cells.Item(row, col);
            }
            return ws.Cells(row, col);
        } catch (e) {
            console.error("getCell error:", e);
            return null;
        }
    }
}

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
    let statusEl = document.getElementById("userIdStatus");
    if (statusEl) {
        if (userId) {
            statusEl.textContent = "ID: " + userId + " ✓";
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

// ========== 根据序列号获取连续数据行（优化版：只遍历可见行）==========
// @param {object} ws - 工作表对象
// @param {number} startRow - 起始行
// @param {number} endRow - 结束行
// @param {number} seqCol - 序列号列（默认第4列）
function getSequentialRowsBySeqCol(ws, startRow, endRow, seqCol) {
    let rows = [];
    let expectedSeq = null;
    
    // 尝试使用 SpecialCells(12) 获取可见行（xlCellTypeVisible=12）
    let visibleRows = null;
    try {
        let autoFilter = ws.AutoFilter;
        if (autoFilter && autoFilter.FilterMode === true && autoFilter.Range) {
            let filterRange = autoFilter.Range;
            let filterStartRow = filterRange.Row + 1;
            let filterEndRow = filterRange.Row + filterRange.Rows.Count - 1;
            
            // xlCellTypeVisible = 12，获取序列号列的可见单元格（从第2行开始，跳过表头）
            let visibleCells = ws.Range(ws.Cells(filterStartRow, seqCol), ws.Cells(filterEndRow, seqCol)).SpecialCells(12);
            if (visibleCells) {
                visibleRows = [];
                let areas = visibleCells.Areas;
                for (let a = 1; a <= areas.Count; a++) {
                    let area = areas(a);
                    for (let r = 1; r <= area.Rows.Count; r++) {
                        let rowNum = area.Rows(r).Row;
                        // 确保行号在范围内
                        if (rowNum >= filterStartRow && rowNum <= filterEndRow) {
                            visibleRows.push(rowNum);
                        }
                    }
                }
            }
        }
    } catch (e) {
        // SpecialCells 失败，使用逐行扫描
        console.log("SpecialCells 获取可见行失败:", e.message);
        visibleRows = null;
    }
    
    // 确定要遍历的行范围
    let rowsToCheck = visibleRows;
    if (!rowsToCheck) {
        // 回退：遍历指定范围
        rowsToCheck = [];
        for (let i = startRow; i <= endRow; i++) {
            rowsToCheck.push(i);
        }
    }
    
    // 遍历可见行获取序列号
    for (let i of rowsToCheck) {
        let seqVal = trim(String(getCell(ws, i, seqCol).Value()));
        let seqNum = parseInt(seqVal);
        
        if (seqVal !== "" && !isNaN(seqNum)) {
            if (expectedSeq === null) {
                rows.push(i);
                expectedSeq = seqNum + 1;
            } else if (seqNum === expectedSeq) {
                rows.push(i);
                expectedSeq = seqNum + 1;
            } else if (seqNum > expectedSeq) {
                expectedSeq = seqNum + 1;
                rows.push(i);
            }
        }
    }
    
    return rows;
}

// ========== 获取筛选状态（包装函数，调用 bangumi.js 中的 getFilterStatus）==========
// @param {number} endRow - 用户指定的结束行号，0表示自动检测
// @param {boolean} getColumnCounts - 是否获取各列的唯一值计数
function getFilterStatusLocal(endRow, getColumnCounts) {
    // 如果 bangumi.js 中的 getFilterStatus 可用，直接调用
    if (typeof getFilterStatus === 'function') {
        return getFilterStatus(endRow, getColumnCounts);
    }
    
    // 否则返回空结果
    console.log("getFilterStatus 不可用");
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
            visibleRows = getSequentialRowsBySeqCol(ws, dataStartRow, actualEndRow, seqCol);
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

        // 预览条数限制
        let previewLimit = Math.min(15, totalRows);
        let validCount = 0;
        let typeStats = {1:0, 2:0, 3:0, 4:0, 5:0};

        for (let idx = 0; idx < previewLimit; idx++) {
            let i = visibleRows[idx];
            let seqNum = trim(String(getCell(ws, i, seqCol).Value()));
            let name = colMap.has("名称") ? trim(String(getCell(ws, i, colMap.get("名称")).Value())) : "";
            let bgmUrl = colMap.has("Bangumi_URL") ? trim(String(getCell(ws, i, colMap.get("Bangumi_URL")).Value())) : "";
            let status = colMap.has("是否看完") ? trim(String(getCell(ws, i, colMap.get("是否看完")).Value())) : "";
            let rate = colMap.has("打分") ? trim(String(getCell(ws, i, colMap.get("打分")).Value())) : "";
            let tagsRaw = colMap.has("标签/分级") ? trim(String(getCell(ws, i, colMap.get("标签/分级")).Value())) : "";
            let finishedDate = colMap.has("完播日") ? trim(String(getCell(ws, i, colMap.get("完播日")).Value())) : "";

            let sid = extractSubjectId(bgmUrl);
            let hasUrl = sid !== "";
            if (hasUrl) validCount++;

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

            html += `<tr class="${hasUrl ? 'valid' : 'invalid'}">`;
            html += `<td class="row-num">${seqNum}</td>`;
            html += `<td class="name-cell" title="${name}">${name ? (name.length > 12 ? name.substring(0, 12) + '...' : name) : '-'}</td>`;
            html += `<td class="sid-cell ${hasUrl ? 'has-url' : 'no-url'}">${sid || '❌'}</td>`;
            html += `<td class="status-cell"><span class="type-badge type-${typeNum}">${typeName}</span></td>`;
            html += `<td class="rate-cell">${rate ? '⭐' + rate : '-'}</td>`;
            html += `<td class="tags-cell">${tagsDisplay || '-'}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += `<div style="margin-top:14px;padding:12px;background:#333;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <span style="color:#888;font-size:12px;">
                    <b style="color:#4a9eff">${firstVisibleRow}</b> - <b style="color:#4a9eff">${lastVisibleRow}</b> 行，共 <b style="color:#fff">${totalRows}</b> 条
                </span>
                <span style="display:flex;gap:12px;font-size:12px;">
                    <span><span style="color:#4ade80">●</span> 有效: <b>${validCount}</b></span>
                    <span><span style="color:#f87171">●</span> 无URL: <b>${previewLimit - validCount}</b></span>
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

        let colMap = getColumnMap(ws, headerRow);

        // D列序列号（固定第4列）
        let seqCol = 4;

        // 确定要处理的行范围
        let rowsToPreview = [];
        
        if (selectMode === 'auto') {
            // 自动模式：根据D列序列号连续性识别有效数据行
            rowsToPreview = getSequentialRowsBySeqCol(ws, dataStartRow, actualEndRow, seqCol);
        } else {
            // 手动模式：使用用户指定的范围
            let manualStart = parseInt(startRowInput?.value) || dataStartRow;
            let manualEnd = parseInt(endRowInput?.value) || lastRow;
            for (let i = manualStart; i <= manualEnd; i++) {
                rowsToPreview.push(i);
            }
        }

        if (rowsToPreview.length === 0) {
            alert("没有数据可预览！");
            return;
        }

        // 预览条数限制
        let previewLimit = Math.min(10, rowsToPreview.length);
        let totalValid = 0;
        let typeCount = {2:0, 3:0, 4:0, 5:0};
        let itemsData = [];

        for (let idx = 0; idx < previewLimit; idx++) {
            let i = rowsToPreview[idx];
            
            let bgmUrl = colMap.has("Bangumi_URL") ? trim(String(getCell(ws, i, colMap.get("Bangumi_URL")).Value())) : "";
            let name = colMap.has("名称") ? trim(String(getCell(ws, i, colMap.get("名称")).Value())) : "";
            let status = colMap.has("是否看完") ? trim(String(getCell(ws, i, colMap.get("是否看完")).Value())) : "";
            let rate = colMap.has("打分") ? trim(String(getCell(ws, i, colMap.get("打分")).Value())) : "";
            let tagsRaw = colMap.has("标签/分级") ? trim(String(getCell(ws, i, colMap.get("标签/分级")).Value())) : "";
            let finishedDate = colMap.has("完播日") ? trim(String(getCell(ws, i, colMap.get("完播日")).Value())) : "";

            let sid = extractSubjectId(bgmUrl);
            if (sid) {
                totalValid++;
            }

            let typeNum = mapWatchStatus(status, finishedDate);

            // type=0（空白/否/想看）不显示在预览中
            if (typeNum === 0) {
                continue;
            }

            let typeName = ["", "想看", "在看", "看过", "搁置", "抛弃"][typeNum];

            // 处理标签
            let tagSet = new Set();
            addTagsFromStr(tagSet, tagsRaw);
            let tags = Array.from(tagSet);
            let tagsHtml = tags.length > 0
                ? `<div class="detail-value tags">${tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}</div>`
                : '<div class="detail-value">-</div>';

            let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);
            let urlDisplay = bgmUrl.length > 60 ? bgmUrl.substring(0, 60) + '...' : bgmUrl;

            let itemHtml = `
                <div class="detail-item" data-type="${typeNum}">
                    <div class="detail-item-header">
                        <div class="detail-item-title">
                            <span class="detail-item-row">行 ${i}</span>
                            <span class="detail-item-name">${name || '(无名称)'}</span>
                        </div>
                        <span class="status-badge type-${typeNum}">${typeName}</span>
                    </div>
                    <div class="detail-item-body">
                        <div class="detail-row">
                            <span class="detail-label">Bangumi URL</span>
                            <span class="detail-value url">${urlDisplay || '(空)'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Subject ID</span>
                            <span class="detail-value sid ${sid ? 'valid' : ''}">${sid || '❌ 无法提取'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">观看状态</span>
                            <span class="detail-value">${typeName} (type=${typeNum})</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">完播日</span>
                            <span class="detail-value">${(finishedDate === null || finishedDate === undefined || finishedDate === "" || finishedDate === "null") ? '(空白)' : finishedDate}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">评分</span>
                            <span class="detail-value" style="color:#f39c12;font-weight:600;">${rate ? '⭐ ' + rate : '(空)'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">标签</span>
                            ${tagsHtml}
                        </div>
                        ${sid ? `
                        <div class="detail-row" style="flex-direction:column;gap:6px;">
                            <span class="detail-label" style="min-width:auto;">将发送的请求</span>
                            <div class="detail-value" style="color:#27ae60;font-weight:500;">
                                POST /v0/users/-/collections/${sid}
                            </div>
                            <div class="detail-value json">${jsonBody}</div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;

            itemsData.push({
                html: itemHtml,
                type: typeNum
            });

            typeCount[typeNum]++;
        }

        // 存储数据供过滤使用
        detailPreviewData.allItems = itemsData;
        detailPreviewData.currentFilter = 'all';

        // 生成过滤按钮
        let toolbarHtml = `
            <button class="filter-btn all active" onclick="filterDetailItems('all')">全部 (${itemsData.length})</button>
            ${typeCount[3] > 0 ? `<button class="filter-btn type-3" onclick="filterDetailItems(3)">看过 (${typeCount[3]})</button>` : ''}
            ${typeCount[2] > 0 ? `<button class="filter-btn type-2" onclick="filterDetailItems(2)">在追 (${typeCount[2]})</button>` : ''}
            ${typeCount[4] > 0 ? `<button class="filter-btn type-4" onclick="filterDetailItems(4)">搁置 (${typeCount[4]})</button>` : ''}
            ${typeCount[5] > 0 ? `<button class="filter-btn type-5" onclick="filterDetailItems(5)">抛弃 (${typeCount[5]})</button>` : ''}
        `;

        // 生成统计信息
        let statsHtml = `
            <div class="detail-stats">
                <div class="stat-card">
                    <div class="stat-value">${rowsToPreview.length}</div>
                    <div class="stat-label">总行数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${itemsData.length}</div>
                    <div class="stat-label">待上传</div>
                </div>
                <div class="stat-card success">
                    <div class="stat-value">${totalValid}</div>
                    <div class="stat-label">有效URL</div>
                </div>
            </div>
            <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
                <span class="status-badge" style="background:#1a3a35;color:#4ade80;">D列序列号</span>
                ${typeCount[3] > 0 ? `<span class="status-badge type-3">看过 ${typeCount[3]}</span>` : ''}
                ${typeCount[2] > 0 ? `<span class="status-badge type-2">在看 ${typeCount[2]}</span>` : ''}
                ${typeCount[4] > 0 ? `<span class="status-badge type-4">搁置 ${typeCount[4]}</span>` : ''}
                ${typeCount[5] > 0 ? `<span class="status-badge type-5">抛弃 ${typeCount[5]}</span>` : ''}
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

    // 过滤项目
    let filteredItems = detailPreviewData.allItems;
    if (filterType !== 'all') {
        filteredItems = filteredItems.filter(item => item.type === parseInt(filterType));
    }

    // 更新统计显示
    let totalCard = modalBody.querySelector('.stat-card:first-child .stat-value');
    let previewCard = modalBody.querySelector('.stat-card:last-child .stat-value');
    if (totalCard) totalCard.textContent = filteredItems.length;
    if (previewCard) previewCard.textContent = filteredItems.length;

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

        // D列序列号（固定第4列）
        let seqCol = 4;

        // 确定要处理的行范围
        let rowsToProcess = [];
        
        if (selectMode === 'auto') {
            // 自动模式：根据D列序列号连续性识别有效数据行
            rowsToProcess = getSequentialRowsBySeqCol(ws, dataStartRow, actualEndRow, seqCol);
        } else {
            // 手动模式：使用用户指定的范围
            let manualStart = parseInt(startRowInput?.value) || dataStartRow;
            let manualEnd = parseInt(endRowInput?.value) || lastRow;
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
            
            // 从正确的列获取 URL
            let bgmUrl = trim(String(getCell(ws, i, colMap.get("Bangumi_URL")).Value()));
            let subjectId = extractSubjectId(bgmUrl);

            if (subjectId === "") {
                skipCount++;
                getCell(ws, i, colMap.get("Bangumi_URL")).Interior.Color = 0xFFFFCC;
                continue;
            }

            // 获取完播日
            let finishedDate = "";
            if (colMap.has("完播日")) {
                finishedDate = trim(String(getCell(ws, i, colMap.get("完播日")).Value()));
            }

            // 构建完整请求体
            let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);
            if (jsonBody === "") {
                skipCount++;
                continue;
            }

            let result = bgmRequestSync("POST", "/v0/users/-/collections/" + subjectId, jsonBody, token);
            let statusCode = result.code;

            if (statusCode === 204 || statusCode === 200) {
                successCount++;
                getCell(ws, i, colMap.get("Bangumi_URL")).Interior.Color = 0xCCFFCC;
            } else {
                failCount++;
                getCell(ws, i, colMap.get("Bangumi_URL")).Interior.Color = 0xFFCCCC;
                console.log("行 " + i + " 失败: " + result.message);
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

        alert(`同步完成！\n成功: ${successCount}\n失败: ${failCount}\n跳过: ${skipCount}`);
        
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
            setStatus("Token 有效！用户: " + (userData.nickname || userData.username), "success");
            alert("✓ Token 验证成功！\n\n用户: " + (userData.nickname || userData.username) + "\nID: " + userData.id);
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
