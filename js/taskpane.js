// ========== 获取调试信息 ==========
function fetchDebugInfo() {
    let debugInfo = document.getElementById("debugInfo");
    let debugUrl = document.getElementById("debugUrl");
    let debugStatus = document.getElementById("debugStatus");

    try {
        if (typeof WpsInvoke !== "undefined" && WpsInvoke.CreateXHR) {
            let xmlReq = WpsInvoke.CreateXHR();
            let url = location.origin + "/.debugTemp/NotifyDemoUrl";
            xmlReq.open("GET", url);
            xmlReq.onload = function (res) {
                let responseText = res.target.responseText;
                console.log("调试地址响应:", responseText);
                if (responseText && responseText.trim() !== "") {
                    debugInfo.style.display = "block";
                    debugUrl.href = responseText;
                    debugUrl.textContent = responseText;
                    debugUrl.onclick = (e) => {
                        e.preventDefault();
                        try {
                            window.Application.OAAssist.ShellExecute(responseText);
                        } catch (err) {
                            window.open(responseText, "_blank");
                        }
                    };
                    debugStatus.textContent = "✓ 调试模式已激活";
                    debugStatus.style.color = "#27ae60";
                } else {
                    debugStatus.textContent = "调试模式未激活";
                    debugStatus.style.color = "#999";
                }
            };
            xmlReq.onerror = function () {
                console.log("获取调试地址失败");
                debugStatus.textContent = "调试模式未激活";
                debugStatus.style.color = "#999";
            };
            xmlReq.send();
        } else {
            console.log("WpsInvoke 不可用");
            debugStatus.textContent = "WpsInvoke 不可用";
            debugStatus.style.color = "#999";
        }
    } catch (e) {
        console.error("获取调试信息失败:", e);
        debugStatus.textContent = "获取调试信息失败";
        debugStatus.style.color = "#e74c3c";
    }
}

// ========== 面板初始化 ==========
window.onload = () => {
    // 获取调试信息
    fetchDebugInfo();

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
        refreshData();
    }, 300);
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
            option.textContent = sheets(i).Name;
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
        let html = '<table><thead><tr>';
        html += '<th>#</th><th>名称</th><th>URL→ID</th><th>状态</th><th>type</th><th>打分</th><th>标签</th>';
        html += '</tr></thead><tbody>';

        // 数据行
        let previewRows = Math.min(15, endRow - startRow + 1);
        let validCount = 0;
        
        for (let i = startRow; i < startRow + previewRows && i <= endRow; i++) {
            let name = colMap.has("名称") ? trim(String(ws.Cells(i, colMap.get("名称")).Value())) : "";
            let bgmUrl = colMap.has("Bangumi_URL") ? trim(String(ws.Cells(i, colMap.get("Bangumi_URL")).Value())) : "";
            let status = colMap.has("是否看完") ? trim(String(ws.Cells(i, colMap.get("是否看完")).Value())) : "";
            let rate = colMap.has("打分") ? trim(String(ws.Cells(i, colMap.get("打分")).Value())) : "";
            let tagsRaw = colMap.has("标签/分级") ? trim(String(ws.Cells(i, colMap.get("标签/分级")).Value())) : "";
            
            let finishedDate = colMap.has("完播日") ? trim(String(ws.Cells(i, colMap.get("完播日")).Value())) : "";
            
            let sid = extractSubjectId(bgmUrl);
            let hasUrl = sid !== "";
            if (hasUrl) validCount++;

            // 解析状态
            let typeNum = mapWatchStatus(status, finishedDate);
            let typeName = ["", "想看", "在看", "看过", "搁置", "抛弃"][typeNum] || "未知";

            // 处理标签
            let tagsDisplay = "";
            if (tagsRaw) {
                let tagSet = new Set();
                addTagsFromStr(tagSet, tagsRaw);
                let tags = Array.from(tagSet).slice(0, 5);
                tagsDisplay = tags.join(", ");
                if (tagSet.size > 5) tagsDisplay += "...";
            }

            let bgColor = hasUrl ? '#d5f5e3' : '#fadbd8';
            
            html += `<tr style="background:${bgColor}">`;
            html += `<td>${i}</td>`;
            html += `<td style="max-width:80px;overflow:hidden;text-overflow:ellipsis;">${name ? (name.length > 10 ? name.substring(0, 10) + '...' : name) : '-'}</td>`;
            html += `<td>${sid || '❌'}</td>`;
            html += `<td><span style="color:${statusColor(status)}">${status || '-'}</span></td>`;
            html += `<td>${typeNum}</td>`;
            html += `<td>${rate || '-'}</td>`;
            html += `<td style="font-size:11px;max-width:100px;overflow:hidden;">${tagsDisplay || '-'}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += `<p style="margin-top:10px;color:#7f8c8d;font-size:12px;">
            显示 ${previewRows}/${endRow - startRow + 1} 行 | 
            有效: <b style="color:#27ae60">${validCount}</b> | 
            绿色=可同步 红色=跳过
        </p>`;

        previewBox.innerHTML = html;
        if (previewCount) previewCount.textContent = `(${startRow}-${endRow}, 共${endRow - startRow + 1}行)`;

        setStatus("就绪", "success");
    } catch (e) {
        console.error("刷新数据失败:", e);
        previewBox.innerHTML = `<p class="hint">加载失败: ${e.message}</p>`;
        setStatus("加载失败", "error");
    }
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

// ========== 详细预览同步内容 ==========
function previewSyncContent() {
    let select = document.getElementById("sheetSelect");
    let headerRowInput = document.getElementById("headerRow");
    let startRowInput = document.getElementById("startRow");
    let endRowInput = document.getElementById("endRow");

    let sheetIndex = parseInt(select?.value) || 1;
    let headerRow = parseInt(headerRowInput?.value) || 1;
    let startRow = parseInt(startRowInput?.value) || 2;
    let endRow = parseInt(endRowInput?.value) || 0;

    if (endRow === 0) {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets(sheetIndex);
        endRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row;
    }

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets(sheetIndex);
        let colMap = getColumnMap(ws, headerRow);

        let msg = "=== 同步内容预览 ===\n\n";
        let previewCount = Math.min(5, endRow - startRow + 1);
        let totalValid = 0;
        let typeCount = {1:0, 2:0, 3:0, 4:0, 5:0};

        for (let i = startRow; i <= startRow + previewCount - 1 && i <= endRow; i++) {
            let bgmUrl = colMap.has("Bangumi_URL") ? trim(String(ws.Cells(i, colMap.get("Bangumi_URL")).Value())) : "";
            let name = colMap.has("名称") ? trim(String(ws.Cells(i, colMap.get("名称")).Value())) : "";
            let status = colMap.has("是否看完") ? trim(String(ws.Cells(i, colMap.get("是否看完")).Value())) : "";
            let rate = colMap.has("打分") ? trim(String(ws.Cells(i, colMap.get("打分")).Value())) : "";
            let tagsRaw = colMap.has("标签/分级") ? trim(String(ws.Cells(i, colMap.get("标签/分级")).Value())) : "";
            let finishedDate = colMap.has("完播日") ? trim(String(ws.Cells(i, colMap.get("完播日")).Value())) : "";

            let sid = extractSubjectId(bgmUrl);
            if (sid) {
                totalValid++;
                let typeNum = mapWatchStatus(status, finishedDate);
                typeCount[typeNum] = (typeCount[typeNum] || 0) + 1;
            }

            let typeNum = mapWatchStatus(status, finishedDate);
            let typeName = ["", "想看", "在看", "看过", "搁置", "抛弃"][typeNum];
            
            // 处理标签
            let tagSet = new Set();
            addTagsFromStr(tagSet, tagsRaw);
            let tags = Array.from(tagSet);

            msg += `【行${i}】${name || '(无名称)'}\n`;
            msg += `  URL: ${bgmUrl || '(空)'}\n`;
            msg += `  subject_id: ${sid || '❌无法提取'}\n`;
            msg += `  状态: "${status}" → type=${typeNum}(${typeName})\n`;
            msg += `  完播日: ${finishedDate || '(空)'}\n`;
            msg += `  评分: ${rate || '(空)'}\n`;
            msg += `  标签: [${tags.join(', ') || '(空)'}]\n`;
            
            if (sid) {
                msg += `  → 将发送: POST /v0/users/-/collections/${sid}\n`;
                msg += `  → JSON: ${buildJsonPayload(ws, i, colMap, finishedDate)}\n`;
            }
            msg += "\n";
        }

        // 统计
        msg += "=== 统计 ===\n";
        msg += `总行数: ${endRow - startRow + 1}\n`;
        msg += `有效URL: ${totalValid}\n`;
        msg += `状态分布: 看过=${typeCount[3]} 在看=${typeCount[2]} 想看=${typeCount[1]} 搁置=${typeCount[4]}\n`;

        alert(msg);
    } catch (e) {
        alert("预览失败: " + e.message);
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
            showTokenDialog(window.Application.PluginStorage.getItem("bgm_token") || "");
            break;
        case "preview":
            previewSyncContent();
            break;
    }
}

// ========== 从面板同步 ==========
function syncFromPanel() {
    let token = window.Application.PluginStorage.getItem("bgm_token");
    if (!token) {
        alert("请先设置 Bangumi Token！");
        showTokenDialog("");
        return;
    }

    let select = document.getElementById("sheetSelect");
    let headerRowInput = document.getElementById("headerRow");
    let startRowInput = document.getElementById("startRow");
    let endRowInput = document.getElementById("endRow");

    let sheetIndex = parseInt(select.value) || 1;
    let headerRow = parseInt(headerRowInput?.value) || 1;
    let startRow = parseInt(startRowInput?.value) || 2;
    let endRow = parseInt(endRowInput?.value) || 0;

    try {
        let sheets = window.Application.ActiveWorkbook.Sheets;
        let ws = sheets(sheetIndex);

        if (endRow === 0) {
            endRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row;
        }

        // 获取列映射
        let colMap = getColumnMap(ws, headerRow);
        if (!colMap.has("Bangumi_URL")) {
            alert("未找到 Bangumi URL 列！");
            return;
        }

        setStatus("正在同步...", "loading");

        let successCount = 0, failCount = 0, skipCount = 0;
        let total = endRow - startRow + 1;

        for (let i = startRow; i <= endRow; i++) {
            // 从正确的列获取 URL
            let bgmUrl = trim(String(ws.Cells(i, colMap.get("Bangumi_URL")).Value()));
            let subjectId = extractSubjectId(bgmUrl);

            if (subjectId === "") {
                skipCount++;
                ws.Cells(i, colMap.get("Bangumi_URL")).Interior.Color = 0xFFFFCC;
                continue;
            }

            // 获取完播日
            let finishedDate = "";
            if (colMap.has("完播日")) {
                finishedDate = trim(String(ws.Cells(i, colMap.get("完播日")).Value()));
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
                ws.Cells(i, colMap.get("Bangumi_URL")).Interior.Color = 0xCCFFCC;
            } else {
                failCount++;
                ws.Cells(i, colMap.get("Bangumi_URL")).Interior.Color = 0xFFCCCC;
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

// ========== Token 设置对话框 ==========
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

// ========== 测试 Token 有效性 ==========
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
            // 清除无效的 Token
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

// ========== 用户ID 设置对话框 ==========
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

window.onload = () => {
    // 1. 创建 XMLHttpRequest 对象
    var xmlReq = WpsInvoke.CreateXHR();
    
    // 2. 构造请求 URL：获取当前页面的 origin + 固定路径
    // 例如：http://localhost:5173/.debugTemp/NotifyDemoUrl
    var url = location.origin + "/.debugTemp/NotifyDemoUrl";
    
    // 3. 初始化 GET 请求
    xmlReq.open("GET", url);
    
    // 4. 请求完成后的回调
    xmlReq.onload = function (res) {
        var node = document.getElementById("DemoSpan");
        // 将服务器返回的内容显示到页面上
        window.document.getElementById("DemoSpan").innerHTML = res.target.responseText;
    };
    
    // 5. 发送请求
    xmlReq.send();
}
