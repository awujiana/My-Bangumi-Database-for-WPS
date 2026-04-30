// ========== 面板初始化 ==========
window.onload = () => {
    // 检查枚举
    if (typeof window.Application.Enum !== "object") {
        window.Application.Enum = WPS_Enum;
    }

    // 更新Token状态
    updateTokenStatus();

    // 加载工作表列表
    refreshSheets();

    // 刷新数据预览
    setTimeout(() => refreshData(), 500);
};

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

// ========== 刷新工作表列表 ==========
function refreshSheets() {
    let select = document.getElementById("sheetSelect");
    if (!select) return;

    select.innerHTML = '<option value="">-- 请选择 --</option>';

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        for (let i = 1; i <= sheets.Count; i++) {
            let option = document.createElement("option");
            option.value = i;
            option.textContent = sheets(i).Name;
            select.appendChild(option);
        }
        // 默认选择活动工作表
        let activeSheet = window.Application.ActiveSheet;
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].textContent === activeSheet.Name) {
                select.selectedIndex = i;
                break;
            }
        }
    } catch (e) {
        console.error("获取工作表失败:", e);
    }
}

// ========== 刷新数据预览 ==========
function refreshData() {
    setStatus("正在加载数据...", "loading");

    let select = document.getElementById("sheetSelect");
    let headerRowInput = document.getElementById("headerRow");
    let startRowInput = document.getElementById("startRow");
    let endRowInput = document.getElementById("endRow");
    let previewBox = document.getElementById("previewBox");
    let previewCount = document.getElementById("previewCount");

    if (!select || !previewBox) return;

    let sheetIndex = parseInt(select.value) || 1;
    let headerRow = parseInt(headerRowInput?.value) || 1;
    let startRow = parseInt(startRowInput?.value) || 2;
    let endRow = parseInt(endRowInput?.value) || 0;

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets(sheetIndex);

        if (!ws) {
            setStatus("未找到工作表", "error");
            return;
        }

        let lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row;
        if (endRow === 0 || endRow > lastRow) {
            if (endRowInput) endRowInput.value = lastRow;
            endRow = lastRow;
        }

        // 获取列映射
        let colMap = getColumnMap(ws, headerRow);

        // 生成预览表格
        let html = '<table><thead><tr><th>#</th>';

        // 表头
        let colNames = [];
        if (colMap.has("Bangumi_URL")) colNames.push("Bangumi_URL");
        if (colMap.has("是否看完")) colNames.push("是否看完");
        if (colMap.has("打分")) colNames.push("打分");
        if (colMap.has("完播日")) colNames.push("完播日");
        if (colMap.has("标签/分级")) colNames.push("标签");

        colNames.forEach(name => html += `<th>${name}</th>`);
        html += '</tr></thead><tbody>';

        // 数据行
        let previewRows = Math.min(10, endRow - startRow + 1);
        for (let i = startRow; i < startRow + previewRows && i <= endRow; i++) {
            let bgmUrl = colMap.has("Bangumi_URL") ? trim(String(ws.Cells(i, colMap.get("Bangumi_URL")).Value())) : "";
            let status = colMap.has("是否看完") ? trim(String(ws.Cells(i, colMap.get("是否看完")).Value())) : "";
            let rate = colMap.has("打分") ? trim(String(ws.Cells(i, colMap.get("打分")).Value())) : "";
            let finished = colMap.has("完播日") ? trim(String(ws.Cells(i, colMap.get("完播日")).Value())) : "";
            let tags = colMap.has("标签/分级") ? trim(String(ws.Cells(i, colMap.get("标签/分级")).Value())) : "";

            let sid = extractSubjectId(bgmUrl);
            let hasUrl = sid !== "";

            html += `<tr style="background:${hasUrl ? '#d5f5e3' : '#fadbd8'}">`;
            html += `<td>${i}</td>`;
            html += `<td>${sid || '❌'}</td>`;
            html += `<td>${status || '-'}</td>`;
            html += `<td>${rate || '-'}</td>`;
            html += `<td>${finished || '-'}</td>`;
            html += `<td>${tags ? (tags.length > 15 ? tags.substring(0, 15) + '...' : tags) : '-'}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += `<p style="margin-top:10px;color:#7f8c8d;font-size:12px;">显示 ${previewRows}/${endRow - startRow + 1} 行 | 绿色=可同步 红色=跳过</p>`;

        previewBox.innerHTML = html;
        if (previewCount) previewCount.textContent = `(${startRow}-${endRow}, 共${endRow - startRow + 1}行)`;

        setStatus("就绪", "success");
    } catch (e) {
        console.error("刷新数据失败:", e);
        previewBox.innerHTML = `<p class="hint">加载失败: ${e.message}</p>`;
        setStatus("加载失败", "error");
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
            setBangumiToken();
            updateTokenStatus();
            break;
    }
}

// ========== 从面板同步 ==========
function syncFromPanel() {
    let token = window.Application.PluginStorage.getItem("bgm_token");
    if (!token) {
        alert("请先设置 Bangumi Token！");
        setBangumiToken();
        updateTokenStatus();
        return;
    }

    let select = document.getElementById("sheetSelect");
    let startRowInput = document.getElementById("startRow");
    let endRowInput = document.getElementById("endRow");

    let sheetIndex = parseInt(select.value) || 1;
    let startRow = parseInt(startRowInput?.value) || 2;
    let endRow = parseInt(endRowInput?.value) || 0;

    if (endRow === 0) {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets(sheetIndex);
        endRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row;
    }

    setStatus("正在同步...", "loading");

    let successCount = 0, failCount = 0, skipCount = 0;
    let total = endRow - startRow + 1;

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets(sheetIndex);

        for (let i = startRow; i <= endRow; i++) {
            let bgmUrl = trim(ws.Cells(i, 1).Value());
            let subjectId = extractSubjectId(bgmUrl);

            if (subjectId === "") {
                skipCount++;
                ws.Cells(i, 1).Interior.Color = 0xFFFFCC;
                continue;
            }

            // 获取完播日
            let finishedDate = "";
            // 构建请求体 - 简化版
            let jsonBody = '{"type":3}';

            let result = bgmRequestSync("POST", "/v0/users/-/collections/" + subjectId, jsonBody, token);
            let statusCode = result.code;

            if (statusCode === 204 || statusCode === 200) {
                successCount++;
                ws.Cells(i, 1).Interior.Color = 0xCCFFCC;
            } else {
                failCount++;
                ws.Cells(i, 1).Interior.Color = 0xFFCCCC;
                console.log("行 " + i + " 失败: " + result.message);
            }

            // 进度
            if (i % 5 === 0) {
                window.Application.StatusBar = `同步进度: ${i - startRow + 1}/${total}`;
            }

            // 延迟
            sleep(REQUEST_DELAY);
        }

        window.Application.StatusBar = false;

        setStatus(`完成! 成功:${successCount} 失败:${failCount} 跳过:${skipCount}`, "success");

        alert(`同步完成！\n成功: ${successCount}\n失败: ${failCount}\n跳过: ${skipCount}`);
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