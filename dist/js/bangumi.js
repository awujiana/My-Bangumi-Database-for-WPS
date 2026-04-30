/**
 * Bangumi API 同步模块
 * 功能：从 Excel 读取条目并批量同步到 Bangumi 收藏
 */

// ========== 配置区域 ==========
const BGM_API_BASE = "https://api.bgm.tv";
const REQUEST_DELAY = 800;

// ========== 获取 Token ==========
function getBgmtoken() {
    let token = window.Application.PluginStorage.getItem("bgm_token");
    if (!token) {
        token = prompt("请输入 Bangumi Access Token:", "");
        if (token && token.trim()) {
            window.Application.PluginStorage.setItem("bgm_token", token.trim());
        }
    }
    return token;
}

// ========== 主入口：批量同步 ==========
function SyncToBangumi() {
    let app = window.Application;
    let ws = app.ActiveSheet;
    if (!ws) {
        alert("未找到活动工作表！");
        return;
    }

    // 检查Token
    let token = getBgmtoken();
    if (!token) {
        alert("未设置 Bangumi Token，无法同步！");
        return;
    }

    // 找表头行
    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) {
        alert("未找到表头行！");
        return;
    }

    // 找列索引
    let colMap = getColumnMap(ws, headerRow);
    if (!colMap) return;

    // 检查必需的列
    if (!colMap.has("Bangumi_URL")) {
        alert("未找到 \"Bangumi URL\" 列，无法获取 subject_id！");
        return;
    }

    let lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row; // xlUp = -4162

    let successCount = 0, failCount = 0, skipCount = 0;

    for (let i = headerRow + 1; i <= lastRow; i++) {
        // 从 Bangumi URL 提取 subject_id
        let bgmUrl = trim(ws.Cells(i, colMap.get("Bangumi_URL")).Value());
        let subjectId = extractSubjectId(bgmUrl);

        if (subjectId === "") {
            skipCount++;
            ws.Cells(i, 1).Interior.Color = 0xFFFFCC; // 黄色=跳过
            continue;
        }

        // 获取完播日
        let finishedDate = "";
        if (colMap.has("完播日")) {
            finishedDate = trim(ws.Cells(i, colMap.get("完播日")).Value());
        }

        // 构建请求体
        let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);

        if (jsonBody === "") {
            skipCount++;
            continue;
        }

        // 发送请求
        let result = bgmRequest("POST", "/v0/users/-/collections/" + subjectId, jsonBody, token);
        let statusCode = result.code;

        // 处理结果
        if (statusCode === 204 || statusCode === 200) {
            successCount++;
            ws.Cells(i, 1).Interior.Color = 0xCCFFCC; // 绿色=成功
        } else {
            failCount++;
            ws.Cells(i, 1).Interior.Color = 0xFFCCCC; // 红色=失败
            console.log("行 " + i + " 失败 (ID:" + subjectId + "): " + result.message);
        }

        // 进度提示
        if (i % 10 === 0) {
            app.StatusBar = "处理进度: " + (i - headerRow) + "/" + (lastRow - headerRow);
        }

        // 延迟避免限流
        sleep(REQUEST_DELAY);
    }

    app.StatusBar = false;

    alert("同步完成！\n成功: " + successCount + "\n失败: " + failCount + "\n跳过(无BGM URL): " + skipCount);
}

// ========== 从 Bangumi URL 提取 subject_id ==========
function extractSubjectId(url) {
    if (!url) return "";
    // 支持格式：https://bgm.tv/subject/12345
    let match = url.match(/bgm\.tv\/subject\/(\d+)/i);
    return match ? match[1] : "";
}

// ========== 查找表头行 ==========
function findHeaderRow(ws) {
    for (let i = 1; i <= 10; i++) {
        for (let j = 1; j <= 10; j++) {
            let cellVal = String(ws.Cells(i, j).Value());
            if (cellVal.toLowerCase().indexOf("bangumi") >= 0 || cellVal.toLowerCase().indexOf("bgm") >= 0) {
                return i;
            }
        }
    }
    return 0;
}

// ========== 获取列名->列号映射 ==========
function getColumnMap(ws, headerRow) {
    let colMap = new Map();
    let lastCol = ws.Cells(headerRow, ws.Columns.Count).End(-4161).Column; // xlToLeft = -4161

    for (let i = 1; i <= lastCol; i++) {
        let colName = trim(String(ws.Cells(headerRow, i).Value()));
        if (colName === "") continue;

        // 精确匹配和模糊匹配
        let lowerName = colName.toLowerCase();
        
        // Bangumi URL 列
        if (lowerName.indexOf("bangumi") >= 0 || lowerName.indexOf("bgm") >= 0 || colName.indexOf("URL") >= 0 || colName === "Bangumi URL") {
            colMap.set("Bangumi_URL", i);
        }
        // 观看状态 - 支持"是否看完"
        else if (colName.indexOf("是否看完") >= 0 || colName.indexOf("观看状态") >= 0) {
            colMap.set("是否看完", i);
        }
        // 完播相关 - 支持"看完时间"
        else if (colName.indexOf("完播") >= 0 || colName.indexOf("看完时间") >= 0) {
            colMap.set("完播日", i);
        }
        // 打分
        else if (colName.indexOf("打分") >= 0 || colName.indexOf("评分") >= 0) {
            colMap.set("打分", i);
        }
        // 评论/感言
        else if (colName.indexOf("感言") >= 0 || colName.indexOf("剧透") >= 0 || colName.indexOf("评价") >= 0 || colName.indexOf("评论") >= 0) {
            colMap.set("剧透/感言", i);
        }
        // 标签/分级 - 你的数据中是"标签/分级"
        else if (colName.indexOf("标签") >= 0 || colName.indexOf("分级") >= 0) {
            colMap.set("标签/分级", i);
        }
        // 特点/印象
        else if (colName.indexOf("特点") >= 0 || colName.indexOf("印象") >= 0) {
            colMap.set("特点/印象", i);
        }
        // 集号/看到
        else if (colName.indexOf("集号") >= 0 || colName.indexOf("看到") >= 0) {
            colMap.set("集号", i);
        }
        // 集数
        else if (colName.indexOf("集数") >= 0) {
            colMap.set("集数", i);
        }
        // 名称
        else if (colName.indexOf("名称") >= 0 || colName.indexOf("标题") >= 0 || colName.indexOf("名") >= 0) {
            colMap.set("名称", i);
        }
    }
    return colMap;
}

// ========== 构建 JSON 请求体 ==========
function buildJsonPayload(ws, row, colMap, finishedDate) {
    let parts = [];

    // --- type: 收藏类型 ---
    let watchStatus = "";
    if (colMap.has("是否看完")) {
        watchStatus = trim(ws.Cells(row, colMap.get("是否看完")).Value());
    }
    let bgmType = mapWatchStatus(watchStatus, finishedDate);
    parts.push('"type":' + bgmType);

    // --- rate: 评分 ---
    if (colMap.has("打分")) {
        let rateVal = ws.Cells(row, colMap.get("打分")).Value();
        if (!isNaN(rateVal)) {
            let rate = Math.max(0, Math.min(10, parseInt(rateVal)));
            if (rate > 0) {
                parts.push('"rate":' + rate);
            }
        }
    }

    // --- comment: 评价/感言 ---
    if (colMap.has("剧透/感言")) {
        let comment = trim(ws.Cells(row, colMap.get("剧透/感言")).Value());
        if (comment !== "") {
            parts.push('"comment":"' + jsonEscape(comment) + '"');
        }
    }

    // --- tags: 标签 ---
    let tags = buildTags(ws, row, colMap);
    if (tags !== "") {
        parts.push('"tags":[' + tags + ']');
    }

    // --- ep_status: 章节进度 ---
    if (colMap.has("集号")) {
        let epStatus = trim(ws.Cells(row, colMap.get("集号")).Value());
        if (epStatus !== "") {
            let epNum = parseEpisodeNumber(epStatus);
            if (epNum > 0) {
                parts.push('"ep_status":' + epNum);
            }
        }
    }

    return "{" + parts.join(",") + "}";
}

// ========== 解析集号（支持 "1-2" 格式，取最大值）==========
function parseEpisodeNumber(epStr) {
    epStr = trim(epStr);
    if (epStr === "") return 0;

    let maxVal = 0;
    let parts = epStr.split(",");

    for (let p of parts) {
        p = trim(p);
        let dashParts = p.split("-");
        for (let d of dashParts) {
            d = trim(d);
            if (!isNaN(d)) {
                let num = parseInt(d);
                if (num > maxVal) maxVal = num;
            }
        }
    }
    return maxVal;
}

// ========== 映射观看状态 -> Bangumi type ==========
// Bangumi type: 1=想看 2=在看 3=看过 4=搁置 5=抛弃
function mapWatchStatus(status, finishedDate) {
    // 处理 null、undefined、"null" 字符串
    if (status === null || status === undefined || status === "null" || status === "NULL" || status === "Null") {
        if (finishedDate !== "" && finishedDate !== null && finishedDate !== undefined) {
            return 3; // 有完播日 = 看过
        }
        return 1; // 默认想看
    }
    if (status === "") {
        if (finishedDate !== "" && finishedDate !== null && finishedDate !== undefined) {
            return 3; // 有完播日 = 看过
        }
        return 1; // 默认想看
    }

    let s = trim(status);
    switch (s) {
        case "是":
        case "看过":
        case "完":
            return 3; // 看过
        case "否":
        case "想看":
        case "想看动画":
            return 1; // 想看
        case "在追":
        case "在看":
        case "追":
            return 2; // 在看
        case "搁置":
        case "暂停":
        case "停":
            return 4; // 搁置
        case "抛弃":
        case "弃":
        case "弃番":
            return 5; // 抛弃
        default:
            // 再次尝试模糊匹配
            if (s.indexOf("看") >= 0 && s.indexOf("追") < 0) return 3;
            if (s.indexOf("追") >= 0) return 2;
            if (s.indexOf("搁") >= 0 || s.indexOf("停") >= 0) return 4;
            return finishedDate !== "" ? 3 : 1;
    }
}

// ========== 构建标签数组 ==========
function buildTags(ws, row, colMap) {
    let tagSet = new Set();

    if (colMap.has("标签/分级")) {
        let raw = trim(ws.Cells(row, colMap.get("标签/分级")).Value());
        addTagsFromStr(tagSet, raw);
    }

    if (colMap.has("特点/印象")) {
        let raw = trim(ws.Cells(row, colMap.get("特点/印象")).Value());
        addTagsFromStr(tagSet, raw);
    }

    if (tagSet.size === 0) return "";

    let tags = [];
    for (let tag of tagSet) {
        tags.push('"' + tag + '"');
    }
    return tags.join(",");
}

// ========== 从字符串提取标签 ==========
function addTagsFromStr(tagSet, raw) {
    if (raw === "") return;

    // 主要分隔符是 | ，同时支持其他常见分隔符
    let seps = ["|", "、", "/", "\\", ",", ";", "｜", "，", "。"];
    let s = String(raw);

    for (let sep of seps) {
        s = s.split(sep).join("|");
    }

    let parts = s.split("|");
    for (let p of parts) {
        let tag = trim(p);
        // 移除首尾空格和特殊字符
        tag = tag.replace(/^\s+|\s+$/g, "");
        // 标签不能含空格，用下划线替换
        tag = tag.split(" ").join("_");
        tag = tag.split("\t").join("_");
        if (tag !== "" && !tagSet.has(tag) && tag.length > 0) {
            tagSet.add(tag);
        }
    }
}

// ========== JSON 转义 ==========
function jsonEscape(s) {
    s = s.split("\\").join("\\\\");
    s = s.split('"').join('\\"');
    s = s.split("\n").join("\\n");
    s = s.split("\r").join("\\n");
    s = s.split("\t").join("\\t");
    return s;
}

// ========== 发送 BGM API 请求 ==========
async function bgmRequest(method, endpoint, body, token) {
    return new Promise((resolve) => {
        let xhr = new XMLHttpRequest();
        xhr.open(method, BGM_API_BASE + endpoint, false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("User-Agent", "BangumiWPS/1.0");

        try {
            xhr.send(body);
            let statusCode = xhr.status;
            if (statusCode === 204 || statusCode === 200) {
                resolve({ code: statusCode, message: "OK" });
            } else {
                resolve({ code: statusCode, message: xhr.responseText });
            }
        } catch (err) {
            resolve({ code: 0, message: "Error: " + err.message });
        }
    });
}

// ========== 同步请求（兼容旧逻辑）==========
function bgmRequestSync(method, endpoint, body, token) {
    let xhr = new XMLHttpRequest();
    xhr.open(method, BGM_API_BASE + endpoint, false);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("User-Agent", "BangumiWPS/1.0");

    try {
        xhr.send(body);
        let statusCode = xhr.status;
        if (statusCode === 204 || statusCode === 200) {
            return { code: statusCode, message: "OK" };
        } else {
            return { code: statusCode, message: xhr.responseText };
        }
    } catch (err) {
        return { code: 0, message: "Error: " + err.message };
    }
}

// ========== Sleep ==========
function sleep(ms) {
    let end = Date.now() + ms;
    while (Date.now() < end) {}
}

// ========== 清除行颜色标记 ==========
function clearRowColors() {
    let ws = window.Application.ActiveSheet;
    if (!ws) return;

    let lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row;
    if (lastRow < 2) return;

    for (let i = 2; i <= lastRow; i++) {
        ws.Cells(i, 1).Interior.ColorIndex = -4142; // xlNone
    }
    alert("已清除标记", 64);
}

// ========== 测试单个条目 ==========
function testSingleUpdate() {
    let subjectId = prompt("输入 subject_id 测试:", "8");
    if (!subjectId || subjectId === "") return;

    let token = getBgmtoken();
    if (!token) {
        alert("请先设置 Token！");
        return;
    }

    let jsonBody = '{"type":3,"rate":8,"comment":"WPS加载项测试","tags":["动画"]}';
    let result = bgmRequestSync("POST", "/v0/users/-/collections/" + subjectId, jsonBody, token);

    if (result.code === 204 || result.code === 200) {
        alert("测试成功！subject_id: " + subjectId);
    } else {
        alert("测试失败 (" + result.code + "): " + result.message);
    }
}

// ========== 预览 URL 提取结果 ==========
function previewSubjectIdExtraction() {
    let ws = window.Application.ActiveSheet;
    if (!ws) return;

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) return;

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.has("Bangumi_URL")) {
        alert("未找到 Bangumi URL 列");
        return;
    }

    let lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row;
    let previewRows = Math.min(10, lastRow - headerRow);

    let msg = "前" + previewRows + "行的 URL -> subject_id 提取结果：\n\n";

    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = trim(ws.Cells(i, colMap.get("Bangumi_URL")).Value());
        let sid = extractSubjectId(url);
        msg += "行" + i + ": " + (url.length > 50 ? url.substring(0, 50) + "..." : url) + " -> [" + sid + "]\n";
    }

    alert(msg);
}

// ========== 预览 JSON 请求体 ==========
function previewJsonPayload() {
    let ws = window.Application.ActiveSheet;
    if (!ws) return;

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) return;

    let colMap = getColumnMap(ws, headerRow);

    let previewRows = Math.min(5, 5);
    let msg = "前" + previewRows + "行的请求体预览：\n\n";

    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = "";
        if (colMap.has("Bangumi_URL")) {
            url = trim(ws.Cells(i, colMap.get("Bangumi_URL")).Value());
        }
        let sid = extractSubjectId(url);

        let finishedDate = "";
        if (colMap.has("完播日")) {
            finishedDate = trim(ws.Cells(i, colMap.get("完播日")).Value());
        }

        let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);

        msg += "行" + i + " [ID:" + sid + "]\n";
        msg += (jsonBody || "(空)") + "\n\n";
    }

    alert(msg);
}

// ========== 辅助函数 ==========
function trim(str) {
    if (!str) return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}

// ========== 设置 Token ==========
function setBangumiToken() {
    // 直接打开Bangumi创建Token页面
    openBangumiTokenPage();
}

// ========== 打开Bangumi Token创建页面 ==========
function openBangumiTokenPage() {
    let tokenUrl = "https://next.bgm.tv/demo/access-token/create";
    
    try {
        window.Application.OAAssist.ShellExecute(tokenUrl);
    } catch (e) {
        window.open(tokenUrl, "_blank");
    }
}

// ========== 显示Token输入对话框（Ribbon 模式）==========
function showTokenDialog(currentToken) {
    let token = prompt("请输入 Bangumi Access Token：\n\n获取方式：Bangumi → 设置 → API → 创建应用", currentToken || "");
    if (token !== null && token.trim() !== "") {
        window.Application.PluginStorage.setItem("bgm_token", token.trim());
        // 验证 Token
        testTokenValidityForRibbon(token.trim());
    }
}

// ========== Ribbon 模式测试 Token ==========
function testTokenValidityForRibbon(token) {
    if (!token) return;

    let xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.bgm.tv/v0/me", false);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("User-Agent", "BangumiWPS/1.0");

    try {
        xhr.send();
        if (xhr.status === 200) {
            let userData = JSON.parse(xhr.responseText);
            alert("✓ Token 验证成功！\n\n用户: " + (userData.nickname || userData.username) + "\nID: " + userData.id);
        } else if (xhr.status === 401) {
            alert("✗ Token 验证失败！\n\n请检查 Token 是否正确，或重新获取新的 Token。");
        } else {
            alert("验证失败 (" + xhr.status + "): " + xhr.responseText);
        }
    } catch (err) {
        alert("验证出错: " + err.message);
    }
}

// ========== 打开用户收藏页（Ribbon 模式）==========
function openUserCollection() {
    let userId = window.Application.PluginStorage.getItem("bgm_user_id");
    if (!userId) {
        showUserIdDialog();
        return;
    }
    let url = "https://bgm.tv/anime/list/" + userId;
    window.Application.OAAssist.ShellExecute(url);
}

// ========== 设置用户ID（Ribbon 模式）==========
function showUserIdDialog() {
    let currentId = window.Application.PluginStorage.getItem("bgm_user_id") || "";
    let userId = prompt("请输入 Bangumi 用户ID：\n\n获取方式：打开你的 Bangumi 主页，URL 中的数字/字母即为用户ID\n例如：https://bgm.tv/user/972358 → 用户ID: 972358", currentId);
    if (userId !== null && userId.trim() !== "") {
        window.Application.PluginStorage.setItem("bgm_user_id", userId.trim());
        alert("用户ID 设置成功！");
    }
}

// ========== 显示同步面板 ==========
function showBangumiPanel() {
    let tsId = window.Application.PluginStorage.getItem("taskpane_id");
    if (!tsId) {
        let tskpane = window.Application.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html");
        let id = tskpane.ID;
        window.Application.PluginStorage.setItem("taskpane_id", id);
        tskpane.Visible = true;
    } else {
        let tskpane = window.Application.GetTaskPane(tsId);
        tskpane.Visible = !tskpane.Visible;
    }
}


