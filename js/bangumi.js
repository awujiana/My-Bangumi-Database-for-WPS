/**
 * Bangumi API 同步模块
 * 功能：从 Excel 读取条目并批量同步到 Bangumi 收藏
 */

// ========== 配置区域 ==========
const BGM_API_BASE = "https://api.bgm.tv";
const REQUEST_DELAY = 800;

// ========== 缓存区域 ==========
// 缓存的总数据行数，用于优化扫描范围
let _cachedTotalRows = 0;

// ========== 统一获取 Application 对象 ==========
function getApp() {
    // 优先使用 window.Application
    if (typeof window !== 'undefined' && window.Application) {
        return window.Application;
    }
    // 回退到全局 Application
    if (typeof Application !== 'undefined') {
        return Application;
    }
    return null;
}

// ========== 获取D列最后一行 ==========
function getLastRow(ws) {
    const xlUp = -4162;
    const SEQ_COL = 4; // D列（第4列）
    
    try {
        let cell = getCell(ws, ws.Rows.Count, SEQ_COL);
        if (cell && cell.Value) {
            return cell.End(xlUp).Row;
        }
    } catch (e) {}
    
    return 1000; // 默认值
}

// ========== 获取 Token ==========
function getBgmtoken() {
    let app = getApp();
    if (!app) return null;
    let token = app.PluginStorage.getItem("bgm_token");
    if (!token) {
        token = prompt("请输入 Bangumi Access Token:", "");
        if (token && token.trim()) {
            app.PluginStorage.setItem("bgm_token", token.trim());
        }
    }
    return token;
}

// ========== 主入口：批量同步 ==========
function SyncToBangumi() {
    let app = getApp();
    if (!app) {
        alert("无法获取 WPS Application 对象！");
        return;
    }
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

    let lastRow = getLastRow(ws);

    let successCount = 0, failCount = 0, skipCount = 0;

    for (let i = headerRow + 1; i <= lastRow; i++) {
        // 从 Bangumi URL 提取 subject_id
        let bgmUrl = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")));
        let subjectId = extractSubjectId(bgmUrl);

        if (subjectId === "") {
            skipCount++;
            getCell(ws, i, 1).Interior.Color = 0xFFFFCC; // 黄色=跳过
            continue;
        }

        // 获取完播日
        let finishedDate = "";
        if (colMap.has("完播日")) {
            finishedDate = trim(getCellValue(ws, i, colMap.get("完播日")));
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
            getCell(ws, i, 1).Interior.Color = 0xCCFFCC; // 绿色=成功
        } else {
            failCount++;
            getCell(ws, i, 1).Interior.Color = 0xFFCCCC; // 红色=失败
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
    // 已知列名列表，用于识别表头行
    let knownHeaders = [
        "序列号", "是否看完", "看完时间", "开播季度", "开播日期", "完播日",
        "类别", "原作标签", "制作公司", "标签", "分级", "特点", "印象",
        "打分", "评分", "集号", "看到", "集数", "系列", "季数",
        "时长", "名称", "标题", "别名", "电影院", "影厅",
        "电影票存根", "剧透", "感言", "评论", "Bangumi", "bgm",
        "制片国家", "语言", "类型", "导演", "音乐", "人物设定",
        "机械设定", "原作", "脚本", "分镜", "演出", "关联"
    ];

    // 扫描前 50 行
    for (let i = 1; i <= 50; i++) {
        let matchCount = 0;
        let lastCol = 50; // 限制检查的列数
        for (let j = 1; j <= lastCol; j++) {
            let cellVal = String(getCellValue(ws, i, j)).toLowerCase();
            for (let header of knownHeaders) {
                if (cellVal.indexOf(header.toLowerCase()) >= 0) {
                    matchCount++;
                    break;
                }
            }
        }
        // 如果一行有多个已知列名，则认为是表头行
        if (matchCount >= 3) {
            return i;
        }
    }
    return 0;
}

// ========== 安全获取单元格值 ==========
function getCellValue(ws, row, col) {
    try {
        if (ws.Range) {
            let colLetter = colNumToLetter(col);
            return ws.Range(colLetter + row).Value();
        }
        if (ws.Cells) {
            return ws.Cells(row, col).Value();
        }
    } catch (e) {}
    return "";
}

// ========== 列号转字母 ==========
function colNumToLetter(col) {
    let letter = "";
    while (col > 0) {
        let mod = (col - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        col = Math.floor((col - mod) / 26);
    }
    return letter;
}

// ========== 安全获取单元格对象 ==========
function getCell(ws, row, col) {
    try {
        // 优先使用 Range (WPS 兼容)
        if (ws && typeof ws.Range === 'function') {
            let colLetter = colNumToLetter(col);
            return ws.Range(colLetter + row);
        }
        // 回退：尝试 Cells.Item
        if (ws && ws.Cells && typeof ws.Cells.Item === 'function') {
            return ws.Cells.Item(row, col);
        }
        // 最后回退
        if (ws && ws.Cells) {
            return ws.Cells(row, col);
        }
        return null;
    } catch (e) {
        console.error("getCell error:", e);
        return null;
    }
}

// ========== 获取列名->列号映射 ==========
function getColumnMap(ws, headerRow) {
    let colMap = new Map();
    let lastCol = 50; // 最多扫描50列

    for (let i = 1; i <= lastCol; i++) {
        let colName = trim(String(getCellValue(ws, headerRow, i)));
        if (colName === "") continue;

        // 精确匹配和模糊匹配
        let lowerName = colName.toLowerCase();

        // Bangumi URL 列（优先级最高）
        if (lowerName.indexOf("bangumi") >= 0 || lowerName.indexOf("bgm") >= 0 ||
            colName.indexOf("URL") >= 0 || lowerName.indexOf("subject") >= 0) {
            colMap.set("Bangumi_URL", i);
        }
        // 观看状态
        else if (colName.indexOf("是否看完") >= 0 || colName.indexOf("观看状态") >= 0 ||
                 colName.indexOf("状态") >= 0) {
            colMap.set("是否看完", i);
        }
        // 完播相关
        else if (colName.indexOf("完播") >= 0 || colName.indexOf("看完时间") >= 0 ||
                 colName.indexOf("看完日") >= 0) {
            colMap.set("完播日", i);
        }
        // 开播日期
        else if (colName.indexOf("开播日期") >= 0 || colName.indexOf("开播时间") >= 0 ||
                 colName.indexOf("首播") >= 0) {
            colMap.set("开播日期", i);
        }
        // 开播季度
        else if (colName.indexOf("开播季度") >= 0 || colName.indexOf("季度") >= 0 ||
                 colName.indexOf("年份") >= 0) {
            colMap.set("开播季度", i);
        }
        // 打分
        else if (colName.indexOf("打分") >= 0 || colName.indexOf("评分") >= 0 ||
                 colName.indexOf("分数") >= 0 || lowerName.indexOf("rate") >= 0) {
            colMap.set("打分", i);
        }
        // 评论/感言
        else if (colName.indexOf("感言") >= 0 || colName.indexOf("剧透") >= 0 ||
                 colName.indexOf("评价") >= 0 || colName.indexOf("评论") >= 0 ||
                 colName.indexOf("comment") >= 0) {
            colMap.set("剧透/感言", i);
        }
        // 标签/分级
        else if (colName.indexOf("标签") >= 0 || colName.indexOf("分级") >= 0 ||
                 colName.indexOf("tag") >= 0) {
            colMap.set("标签/分级", i);
        }
        // 特点/印象
        else if (colName.indexOf("特点") >= 0 || colName.indexOf("印象") >= 0) {
            colMap.set("特点/印象", i);
        }
        // 集号/看到
        else if (colName.indexOf("集号") >= 0 || colName.indexOf("看到") >= 0 ||
                 colName.indexOf("ep") >= 0) {
            colMap.set("集号", i);
        }
        // 集数
        else if (colName.indexOf("集数") >= 0 || colName.indexOf("总集") >= 0) {
            colMap.set("集数", i);
        }
        // 名称/标题
        else if (colName.indexOf("名称") >= 0 || colName.indexOf("标题") >= 0 ||
                 colName.indexOf("name") >= 0 || lowerName.indexOf("title") >= 0) {
            colMap.set("名称", i);
        }
        // 别名
        else if (colName.indexOf("别名") >= 0 || colName.indexOf("原名") >= 0 ||
                 lowerName.indexOf("alias") >= 0) {
            colMap.set("别名", i);
        }
        // 类别
        else if (colName.indexOf("类别") >= 0 || colName.indexOf("分类") >= 0 ||
                 colName.indexOf("type") >= 0) {
            colMap.set("类别", i);
        }
        // 原作标签
        else if (colName.indexOf("原作") >= 0) {
            colMap.set("原作标签", i);
        }
        // 制作公司
        else if (colName.indexOf("制作公司") >= 0 || colName.indexOf("制作") >= 0 ||
                 colName.indexOf("studio") >= 0) {
            colMap.set("制作公司", i);
        }
        // 系列
        else if (colName.indexOf("系列") >= 0) {
            colMap.set("系列", i);
        }
        // 季数
        else if (colName.indexOf("季数") >= 0 || colName.indexOf("第") >= 0 && colName.indexOf("季") >= 0) {
            colMap.set("季数", i);
        }
        // 时长
        else if (colName.indexOf("时长") >= 0 || colName.indexOf("分钟") >= 0) {
            colMap.set("时长", i);
        }
        // 导演
        else if (colName.indexOf("导演") >= 0 || lowerName.indexOf("director") >= 0) {
            colMap.set("导演", i);
        }
        // 音乐
        else if (colName.indexOf("音乐") >= 0 || lowerName.indexOf("music") >= 0) {
            colMap.set("音乐", i);
        }
        // 序列号
        else if (colName.indexOf("序列号") >= 0 || colName.indexOf("序号") >= 0 ||
                 colName.indexOf("编号") >= 0) {
            colMap.set("序列号", i);
        }
    }
    return colMap;
}

// ========== 构建 JSON 请求体 ==========
function buildJsonPayload(ws, row, colMap, finishedDate) {
    // --- type: 收藏类型 ---
    let watchStatus = "";
    if (colMap.has("是否看完")) {
        watchStatus = trim(getCellValue(ws, row, colMap.get("是否看完")));
    }
    let bgmType = mapWatchStatus(watchStatus, finishedDate);

    // type=0 表示不需要上传（空白、否、想看等）
    if (bgmType === 0) {
        return "";
    }

    let parts = [];
    parts.push('"type":' + bgmType);

    // --- rate: 评分 ---
    if (colMap.has("打分")) {
        let rateVal = getCellValue(ws, row, colMap.get("打分"));
        if (!isNaN(rateVal)) {
            let rate = Math.max(0, Math.min(10, parseInt(rateVal)));
            if (rate > 0) {
                parts.push('"rate":' + rate);
            }
        }
    }

    // --- comment: 评价/感言 ---
    if (colMap.has("剧透/感言")) {
        let comment = trim(getCellValue(ws, row, colMap.get("剧透/感言")));
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
        let epStatus = trim(getCellValue(ws, row, colMap.get("集号")));
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
// Bangumi type: 0=不上传 1=想看 2=在看 3=看过 4=搁置 5=抛弃
// 只有在看(2)、看过(3)、搁置(4)、抛弃(5)才上传
function isEmptyValue(val) {
    return val === null || val === undefined || val === "" || val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}

function mapWatchStatus(status, finishedDate) {
    // 处理空值（空白、null）
    if (isEmptyValue(status)) {
        return 0; // 不上传
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
            return 0; // 不上传
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
            // 模糊匹配
            if (s.indexOf("追") >= 0) return 2;
            if (s.indexOf("搁") >= 0 || s.indexOf("停") >= 0) return 4;
            if (s.indexOf("弃") >= 0) return 5;
            return 0; // 其他情况不上传
    }
}

// ========== 构建标签数组 ==========
function buildTags(ws, row, colMap) {
    let tagSet = new Set();

    if (colMap.has("标签/分级")) {
        let raw = trim(getCellValue(ws, row, colMap.get("标签/分级")));
        addTagsFromStr(tagSet, raw);
    }

    if (colMap.has("特点/印象")) {
        let raw = trim(getCellValue(ws, row, colMap.get("特点/印象")));
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
    let app = getApp();
    if (!app) return;
    let ws = app.ActiveSheet;
    if (!ws) return;

    let lastRow = getLastRow(ws);
    if (lastRow < 2) return;

    for (let i = 2; i <= lastRow; i++) {
        getCell(ws, i, 1).Interior.ColorIndex = -4142; // xlNone
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
    let app = getApp();
    if (!app) return;
    let ws = app.ActiveSheet;
    if (!ws) return;

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) return;

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.has("Bangumi_URL")) {
        alert("未找到 Bangumi URL 列");
        return;
    }

    let lastRow = getLastRow(ws);
    let previewRows = Math.min(10, lastRow - headerRow);

    let msg = "前" + previewRows + "行的 URL -> subject_id 提取结果：\n\n";

    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")));
        let sid = extractSubjectId(url);
        msg += "行" + i + ": " + (url.length > 50 ? url.substring(0, 50) + "..." : url) + " -> [" + sid + "]\n";
    }

    alert(msg);
}

// ========== 预览 JSON 请求体 ==========
function previewJsonPayload() {
    let app = getApp();
    if (!app) return;
    let ws = app.ActiveSheet;
    if (!ws) return;

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) return;

    let colMap = getColumnMap(ws, headerRow);

    let previewRows = Math.min(5, 5);
    let msg = "前" + previewRows + "行的请求体预览：\n\n";

    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = "";
        if (colMap.has("Bangumi_URL")) {
            url = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")));
        }
        let sid = extractSubjectId(url);

        let finishedDate = "";
        if (colMap.has("完播日")) {
            finishedDate = trim(getCellValue(ws, i, colMap.get("完播日")));
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
    let app = getApp();

    try {
        if (app && app.OAAssist) {
            app.OAAssist.ShellExecute(tokenUrl);
        } else {
            window.open(tokenUrl, "_blank");
        }
    } catch (e) {
        window.open(tokenUrl, "_blank");
    }
}

// ========== 显示Token输入对话框（Ribbon 模式）==========
function showTokenDialog(currentToken) {
    let app = getApp();
    let token = prompt("请输入 Bangumi Access Token：\n\n获取方式：Bangumi → 设置 → API → 创建应用", currentToken || "");
    if (token !== null && token.trim() !== "") {
        if (app) {
            app.PluginStorage.setItem("bgm_token", token.trim());
        }
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
    let app = getApp();
    let userId = app ? app.PluginStorage.getItem("bgm_user_id") : null;
    if (!userId) {
        showUserIdDialog();
        return;
    }
    let url = "https://bgm.tv/anime/list/" + userId;
    try {
        if (app && app.OAAssist) {
            app.OAAssist.ShellExecute(url);
        } else {
            window.open(url, "_blank");
        }
    } catch (e) {
        window.open(url, "_blank");
    }
}

// ========== 设置用户ID（Ribbon 模式）==========
function showUserIdDialog() {
    let app = getApp();
    let currentId = app ? app.PluginStorage.getItem("bgm_user_id") || "" : "";
    let userId = prompt("请输入 Bangumi 用户ID：\n\n获取方式：打开你的 Bangumi 主页，URL 中的数字/字母即为用户ID\n例如：https://bgm.tv/user/972358 → 用户ID: 972358", currentId);
    if (userId !== null && userId.trim() !== "") {
        if (app) {
            app.PluginStorage.setItem("bgm_user_id", userId.trim());
        }
        alert("用户ID 设置成功！");
    }
}

// ========== 显示同步面板 ==========
function showBangumiPanel() {
    let app = getApp();
    let tsId = app ? app.PluginStorage.getItem("taskpane_id") : null;

    if (!tsId) {
        let tskpane = app.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html");
        let id = tskpane.ID;
        app.PluginStorage.setItem("taskpane_id", id);
        tskpane.Visible = true;
    } else {
        let tskpane = app.GetTaskPane(tsId);
        tskpane.Visible = !tskpane.Visible;
    }
}

// ========== 获取 URL 路径（用于 taskpane）==========
function GetUrlPath() {
    let app = getApp();
    // 优先使用 manifest 中的基础路径
    let manifestPath = app ? app.PluginStorage.getItem("manifest_base_path") : null;
    if (manifestPath) {
        return manifestPath;
    }
    // 回退：使用当前页面路径
    if (typeof window !== 'undefined' && window.location && window.location.href) {
        let currentUrl = window.location.href;
        let lastSlash = currentUrl.lastIndexOf("/");
        return currentUrl.substring(0, lastSlash);
    }
    // Ribbon 上下文：返回默认路径
    return "";
}

// ========== 检测表头筛选状态（增强版）==========
// @param {number} endRow - 用户指定的结束行号，0表示自动检测
// @param {boolean} getColumnCounts - 是否获取各列的唯一值计数（用于筛选下拉菜单）
function getFilterStatus(endRow, getColumnCounts) {
    // 优先使用 window.Application（taskpane 环境中可用）
    let app = window.Application || getApp();
    console.log("getFilterStatus - app:", !!app);
    if (!app) {
        console.log("getFilterStatus - app 为空，返回 null");
        return null;
    }
    
    let ws = app.ActiveSheet;
    console.log("getFilterStatus - ws:", !!ws);
    if (!ws) {
        console.log("getFilterStatus - ws 为空，返回 null");
        return null;
    }
    
    let result = {
        hasFilter: false,
        filteredColumns: [],
        hiddenRows: [],
        visibleRows: [],
        filterDetails: "",
        columnCounts: {},    // 各列的唯一值计数 {colIndex: {value: count}}
        totalRows: 0,
        visibleCount: 0,
        hiddenCount: 0
    };
    
    const SEQ_COL = 4; // D列 - 序列号列
    
    try {
        let autoFilter = ws.AutoFilter;
        console.log("getFilterStatus - autoFilter:", !!autoFilter);
        let filterMode = false;
        let filterStartRow = 2; // 默认数据起始行（去除表头）
        
        if (autoFilter) {
            filterMode = autoFilter.FilterMode === true;
            console.log("getFilterStatus - filterMode:", filterMode);
            result.hasFilter = filterMode;
            
            // 获取 AutoFilter 区域信息
            if (autoFilter.Range) {
                let filterRange = autoFilter.Range;
                filterStartRow = filterRange.Row + 1; // 数据起始行（跳过表头）
                // 使用缓存的总行数来优化范围（缓存值 ±50 行余量）
                let estimatedEndRow = _cachedTotalRows > 0 ? _cachedTotalRows + filterStartRow + 50 : 0;
                result.totalRows = filterRange.Rows.Count - 1; // 减去表头行
                // 更新缓存
                _cachedTotalRows = result.totalRows;
            }
            
            // 获取各列的筛选条件
            let filters = autoFilter.Filters;
            if (filters && filters.Count > 0) {
                let details = [];
                for (let i = 1; i <= filters.Count; i++) {
                    try {
                        let f = filters(i);
                        if (f && f.On) {
                            // 获取列名
                            let colLetter = colNumToLetter(i);
                            let headerCell = ws.Range(colLetter + "1") || ws.Cells(1, i);
                            let colName = headerCell.Value ? String(headerCell.Value).substring(0, 10) : "列" + i;
                            
                            // 获取筛选条件
                            let criteria = f.Criteria1 || "";
                            if (f.Criteria2) {
                                criteria += " / " + f.Criteria2;
                            }
                            if (f.Operator === 1) { // And
                                criteria = f.Criteria1 + " 且 " + f.Criteria2;
                            }
                            
                            details.push(colName + ": " + criteria);
                            result.filteredColumns.push({
                                column: i,
                                columnName: colName,
                                criteria: criteria
                            });
                        }
                    } catch (e) {}
                }
                result.filterDetails = details.join(" | ");
            }
        }
        
        // 检测被隐藏的行 - 使用缓存的范围优化
        let scanEndRow;
        if (endRow > 0) {
            scanEndRow = endRow;
        } else if (_cachedTotalRows > 0) {
            // 使用缓存的总行数 + 表头行 + 50 行余量
            scanEndRow = filterStartRow + _cachedTotalRows + 50;
        } else {
            scanEndRow = getLastRow(ws);
        }
        
        // 使用 AutoFilter 的 SpecialCells 来获取 D 列可见行
        try {
            if (filterMode && autoFilter && autoFilter.Range) {
                let filterRange = autoFilter.Range;
                // 使用实际数据范围，避免 AutoFilter 范围过大
                let actualLastRow = getLastRow(ws);
                let filterEndRow = filterRange.Row + filterRange.Rows.Count - 1;
                // 取较小值，确保不超出实际数据范围
                if (filterEndRow > actualLastRow) {
                    filterEndRow = actualLastRow;
                }
                
                // 获取 D 列可见单元格（第4列，序列号列）
                try {
                    // xlCellTypeVisible = 12，获取可见单元格
                    let filterRangeStr = "D" + filterStartRow + ":D" + filterEndRow;
                    let visibleCells = ws.Range(filterRangeStr).SpecialCells(12);
                    
                    if (visibleCells) {
                        try {
                            let areas = visibleCells.Areas;
                            // 使用 Item() 方法访问 Areas（WPS 兼容）
                            for (let a = 1; a <= areas.Count; a++) {
                                let area = areas.Item(a);
                                let rows = area.Rows;
                                for (let r = 1; r <= rows.Count; r++) {
                                    let rowNum = rows.Item(r).Row;
                                    // 只计入 D 列有有效数字序列号的行
                                    // 使用 Range 获取单元格值（WPS 兼容）
                                    let cellAdd = "D" + rowNum;
                                    let cell = ws.Range(cellAdd);
                                    let cellVal = cell.Value2;
                                    if (cellVal === null || cellVal === undefined || cellVal === "") {
                                        cellVal = cell.Value();
                                    }
                                    let seqNum = parseInt(cellVal);
                                    if (!isNaN(seqNum) && seqNum > 0) {
                                        result.visibleRows.push(rowNum);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error("遍历 Areas 失败:", e);
                        }
                    }
                } catch (e) {
                    console.log("SpecialCells 获取 D 列可见行失败:", e.message);
                }
                
                // 计算总数据行数（只统计有有效序列号的行）
                let totalDataRows = 0;
                for (let i = filterStartRow; i <= filterEndRow; i++) {
                    try {
                        // 使用 Range 获取单元格值（WPS 兼容）
                        let cell = ws.Range("D" + i);
                        let cellVal = cell.Value2;
                        if (cellVal === null || cellVal === undefined || cellVal === "") {
                            cellVal = cell.Value();
                        }
                        let seqNum = parseInt(cellVal);
                        if (!isNaN(seqNum) && seqNum > 0) {
                            totalDataRows++;
                        }
                    } catch (e) {}
                }
                result.totalRows = totalDataRows;
                // 计算隐藏行 - 只统计有有效序列号但被隐藏的行
                if (result.visibleRows.length > 0) {
                    let visibleSet = new Set(result.visibleRows);
                    for (let i = filterStartRow; i <= filterEndRow; i++) {
                        try {
                            // 使用 Range 获取单元格值（WPS 兼容）
                            let cell = ws.Range("D" + i);
                            let cellVal = cell.Value2;
                            if (cellVal === null || cellVal === undefined || cellVal === "") {
                                cellVal = cell.Value();
                            }
                            let seqNum = parseInt(cellVal);
                            if (!isNaN(seqNum) && seqNum > 0) {
                                if (!visibleSet.has(i)) {
                                    result.hiddenRows.push(i);
                                }
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {
            console.log("AutoFilter SpecialCells 方式失败:", e.message);
        }
        
        // 回退到逐行扫描方式
        if (result.visibleRows.length === 0 && result.hiddenRows.length === 0) {
            console.log("getFilterStatus - 进入回退逻辑, filterStartRow:", filterStartRow, "scanEndRow:", scanEndRow);
            for (let i = filterStartRow; i <= scanEndRow; i++) {
                try {
                    let rowHidden = false;
                    try {
                        rowHidden = ws.Rows(i).Hidden;
                    } catch (e1) {
                        try {
                            rowHidden = ws.Rows.Item(i).Hidden;
                        } catch (e2) {
                            rowHidden = false;
                        }
                    }
                    
                    if (rowHidden === true) {
                        result.hiddenRows.push(i);
                    } else {
                        result.visibleRows.push(i);
                    }
                } catch (e) {
                    result.visibleRows.push(i);
                }
            }
        }
        
        // 设置计数
        result.visibleCount = result.visibleRows.length;
        result.hiddenCount = result.hiddenRows.length;
        
        // 如果需要获取各列的唯一值计数
        if (getColumnCounts === true) {
            result.columnCounts = getColumnValueCounts(ws, scanEndRow);
        }
        
        console.log("getFilterStatus 完成:", {
            hasFilter: result.hasFilter,
            totalRows: result.totalRows,
            visibleCount: result.visibleCount,
            hiddenCount: result.hiddenCount
        });
    } catch (e) {
        console.error("getFilterStatus error:", e);
    }
    
    return result;
}

// ========== 获取指定范围内各列的唯一值计数（==========
// @param {object} ws - 工作表对象
// @param {number} endRow - 结束行号
// @returns {object} - {colIndex: {value: count, ...}, ...}
function getColumnValueCounts(ws, endRow) {
    let counts = {};
    let startRow = 2; // 假设第2行开始是数据
    
    // 扫描 AutoFilter 应用的列
    try {
        let autoFilter = ws.AutoFilter;
        if (autoFilter && autoFilter.Range) {
            let filterRange = autoFilter.Range;
            let colCount = filterRange.Columns.Count;
            
            // 扫描每一列
            for (let col = 1; col <= colCount; col++) {
                let valueCounts = {};
                let blankCount = 0;
                
                for (let row = startRow; row <= endRow; row++) {
                    try {
                        let cell = ws.Cells(row, col);
                        let val = cell.Value();
                        
                        // 处理空值
                        if (val === null || val === undefined || val === "") {
                            blankCount++;
                        } else {
                            let key = String(val).substring(0, 50); // 限制长度
                            valueCounts[key] = (valueCounts[key] || 0) + 1;
                        }
                    } catch (e) {}
                }
                
                // 如果有空白项，添加到结果中
                if (blankCount > 0) {
                    valueCounts["(空白)"] = blankCount;
                }
                
                // 只保存有数据的列
                if (Object.keys(valueCounts).length > 0) {
                    counts[col] = valueCounts;
                }
            }
        }
    } catch (e) {
        console.log("getColumnValueCounts error:", e.message);
    }
    
    return counts;
}

// ========== 获取筛选后的可见行 ==========
function getVisibleRows() {
    let status = getFilterStatus();
    return status ? status.visibleRows : [];
}

// ========== 获取被筛选掉的行 ==========
function getFilteredRows() {
    let status = getFilterStatus();
    return status ? status.hiddenRows : [];
}

// ========== 根据序列号获取连续数据行（支持筛选状态）==========
/**
 * 获取序列号连续的行
 * 固定使用D列（第4列）作为序列号列
 * 支持筛选模式：自动检测被隐藏的行并识别序列号跳跃
 * @param {number} startRow - 起始行（默认从第2行开始）
 * @param {number} endRow - 结束行（0表示自动检测）
 * @returns {object} - 包含连续行信息和被筛选的行信息
 */
function getSequentialRowsBySeqCol(startRow, endRow) {
    let app = getApp();
    if (!app) return { validRows: [], filteredRows: [], totalFiltered: 0 };
    
    let ws = app.ActiveSheet;
    if (!ws) return { validRows: [], filteredRows: [], totalFiltered: 0 };
    
    // 获取筛选状态（使用指定的结束行）
    let filterStatus = getFilterStatus(endRow);
    let visibleRows = filterStatus ? filterStatus.visibleRows : [];
    let hiddenRows = filterStatus ? filterStatus.hiddenRows : [];
    let isFiltered = filterStatus ? filterStatus.hasFilter : false;
    
    // 如果有筛选模式，只检查可见行
    let checkRows = isFiltered ? visibleRows : [];
    
    // 结果对象
    let result = {
        validRows: [],        // 序列号连续的有效行
        filteredRows: [],     // 被筛选掉的行（通过序列号跳跃检测）
        totalFiltered: 0,     // 被筛选的总行数
        hasFilter: isFiltered,
        visibleCount: visibleRows.length,
        hiddenCount: hiddenRows.length
    };
    
    // 序列号列（D列=第4列）
    let seqCol = 4;
    
    if (isFiltered) {
        // ========== 筛选模式：只处理可见行 ==========
        // 收集可见行的序列号
        let visibleSeqMap = new Map(); // row -> seqNum
        
        for (let i = 0; i < checkRows.length; i++) {
            let row = checkRows[i];
            let cell = getCell(ws, row, seqCol);
            if (!cell) continue;
            
            let seqValue = null;
            try {
                seqValue = cell.Value2 || cell.Value();
            } catch (e) {}
            if (seqValue === null || seqValue === undefined || seqValue === "") {
                continue;
            }
            
            let seqNum = parseInt(seqValue);
            if (isNaN(seqNum)) continue;
            
            visibleSeqMap.set(row, seqNum);
        }
        
        // 按行号排序
        let sortedRows = Array.from(visibleSeqMap.keys()).sort(function(a, b) { return a - b; });
        
        if (sortedRows.length === 0) {
            return result;
        }
        
        // 第一个可见行
        result.validRows.push(sortedRows[0]);
        
        // 遍历后续行，检测序列号连续性
        for (let i = 1; i < sortedRows.length; i++) {
            let prevRow = sortedRows[i - 1];
            let prevSeq = visibleSeqMap.get(prevRow);
            let currRow = sortedRows[i];
            let currSeq = visibleSeqMap.get(currRow);
            
            let expectedSeq = prevSeq + 1;
            
            if (currSeq === expectedSeq) {
                // 序列号连续，添加该行
                result.validRows.push(currRow);
            } else if (currSeq > expectedSeq) {
                // 序列号跳跃，说明中间有被筛选的行
                let gap = currSeq - expectedSeq;
                result.totalFiltered += gap;
                result.filteredRows.push({
                    startSeq: expectedSeq,
                    endSeq: currSeq - 1,
                    count: gap,
                    afterRow: currRow
                });
                result.validRows.push(currRow);
            }
            // currSeq < expectedSeq 的情况：忽略（可能是重复/倒退）
        }
        
    } else {
        // ========== 非筛选模式：使用指定的结束行 ==========
        let start = startRow || 2;
        let scanEndRow = endRow > 0 ? endRow : getLastRow(ws);
        
        // 收集所有非空序列号行
        let seqMap = new Map(); // row -> seqNum
        
        for (let row = start; row <= scanEndRow; row++) {
            let cell = getCell(ws, row, seqCol);
            if (!cell) continue;
            
            let seqValue = null;
            try {
                seqValue = cell.Value2 || cell.Value();
            } catch (e) {}
            if (seqValue === null || seqValue === undefined || seqValue === "") {
                continue;
            }
            
            let seqNum = parseInt(seqValue);
            if (isNaN(seqNum)) continue;
            
            seqMap.set(row, seqNum);
        }
        
        if (seqMap.size === 0) {
            console.log("getSequentialRowsBySeqCol - seqMap 为空, start:", start, "scanEndRow:", scanEndRow);
            return result;
        }
        
        // 按行号排序
        let sortedRows = Array.from(seqMap.keys()).sort(function(a, b) { return a - b; });
        
        result.validRows = sortedRows;
        console.log("getSequentialRowsBySeqCol - validRows:", sortedRows.length, "行");
    }
    
    return result;
}

// ========== 简化版：只获取连续行 ==========
function getSequentialRows(startRow) {
    let result = getSequentialRowsBySeqCol(startRow);
    return result.validRows;
}


