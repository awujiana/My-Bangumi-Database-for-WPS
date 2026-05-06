/**
 * Bangumi API 同步模块
 * @module bangumi
 * @description 从 Excel 读取条目并批量同步到 Bangumi 收藏
 */

import { XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, BGM } from './util.js';
import { getApp, bgmLog, getCell, getCellValue, sleep, loadBgToken,
         _setBgmUserId, _getBgmUserId, _getUserApiPath, trim,
         colNumToLetter, storeBgToken, readCell } from './util.js';
import { showDialog } from './ui/dialog.js';
import { sendToTaskpane } from './core/unified.js';
import { showTokenDialog, showUserIdDialog } from './ui/handlers.js';
import { httpRequest } from './http.js';
import { Result } from './types/result.js';

// ========== 常量定义 ==========
// Excel 列常量
const COLUMNS = {
    SEQUENCE: 4,      // D列 - 序号
    DEFAULT_START: 1   // 默认起始列
};

// 同步状态颜色常量
const SYNC_STATUS_COLOR = {
    SUCCESS: 10,       // 绿色 - 成功
    FAILURE: 3,        // 红色 - 失败
    WARNING: 6,         // 黄色 - 警告
    INFO: 5,           // 蓝色 - 信息
    SKIP: 16           // 灰色 - 跳过
};

// 状态映射常量（Bangumi type: 1=想看 2=在看 3=看过 4=搁置 5=抛弃）
// 0=不上传（空白、否、想看等）
const WATCH_STATUS_MAP = {
    "\u770b\u8fc7": 3, "\u770b\u5b8c": 3, "\u5df2\u770b": 3, "\u5b8c": 3, "completed": 3, "3": 3,
    "\u5728\u770b": 2, "\u5728\u770b\u52a8\u753b": 2, "\u5728\u8ffd": 2, "\u8ffd": 2, "watching": 2, "2": 2,
    "\u60f3\u770b": 0, "\u60f3\u770b\u52a8\u753b": 0, "\u5426": 0, "wish": 0, "1": 0,
    "\u6401\u7f6e": 4, "\u6682\u505c": 4, "\u505c": 4, "on_hold": 4, "4": 4,
    "\u629b\u5f03": 5, "\u5f03": 5, "\u5f03\u756a": 5, "drop": 5, "dropped": 5, "5": 5
};

// 收藏类型文本映射（仅用于日志显示）
const TYPE_TEXT_MAP = {1:"\u60f3\u770b", 2:"\u5728\u770b", 3:"\u770b\u8fc7", 4:"\u6401\u7f6e", 5:"\u629b\u5f03"};

// URL 解析正则
const URL_PATTERNS = [
    /bgm\.tv\/subject\/(\d+)/i,
    /bangumi\.tv\/subject\/(\d+)/i,
    /chii\.in\/subject\/(\d+)/i,
    /(\d{6,})/
];

// 表头识别关键词（覆盖用户实际表头 + bangumi.js 关键词）
export const HEADER_KEYWORDS = [
    "\u5e8f\u5217\u53f7", "\u662f\u5426\u770b\u5b8c", "\u770b\u5b8c\u65f6\u95f4", "\u5f00\u64ad\u5b63\u5ea6",
    "\u5f00\u64ad\u65e5\u671f", "\u5b8c\u64ad\u65e5", "\u7c7b\u522b", "\u539f\u4f5c\u6807\u7b7e", "\u5236\u4f5c\u516c\u53f8",
    "\u6807\u7b7e/\u5206\u7ea7", "\u7279\u70b9/\u5370\u8c61", "\u6253\u5206", "\u96c6\u53f7", "\u96c6\u6570",
    "\u540d\u79f0", "\u522b\u540d", "\u5267\u900f/\u611f\u8a00", "\u611f\u8a00", "\u5907\u6ce8", "\u8bc4\u4ef7",
    "bangumi url", "url", "\u5236\u7247\u56fd\u5bb6", "\u8bed\u8a00", "\u7c7b\u578b",
    "\u5bfc\u6f14", "\u97f3\u4e50", "\u539f\u4f5c", "\u6807\u7b7e",
    "\u6761\u76eeid", "sid", "\u72b6\u6001", "status", "rate",
    "\u756a\u5267", "\u52a8\u753b", "\u4e66", "\u540d\u5b57", "\u94fe\u63a5",
    "\u89c2\u770b\u72b6\u6001", "\u6536\u85cf\u7c7b\u578b", "\u7ae0\u8282\u72b6\u6001", "\u540c\u6b65\u72b6\u6001",
    "\u5173\u8054\u7684\u52a8\u6f2b", "\u7cfb\u5217", "\u5b63\u6570", "\u65f6\u957f"
];

// 预览时高亮显示的关键列
export const IMPORTANT_COLS = {
    "\u540d\u79f0": true, "\u662f\u5426\u770b\u5b8c": true, "bangumi url": true,
    "url": true, "\u6253\u5206": true, "\u96c6\u6570": true, "\u611f\u8a00": true,
    "\u5267\u900f/\u611f\u8a00": true, "\u7c7b\u578b": true, "\u72b6\u6001": true,
    "status": true, "rate": true, "\u522b\u540d": true
};

// 表头字段映射
const FIELD_NAME_MAP = {
    "\u540d\u79f0": "name", "name": "name", "\u4f5c\u54c1\u540d": "name", "\u6761\u76ee": "name", "\u6807\u9898": "name",
    "\u6761\u76eeid": "subjectId", "sid": "subjectId", "subject_id": "subjectId", "id": "subjectId",
    "bangumi url": "url", "url": "url", "\u94fe\u63a5": "url", "\u5730\u5740": "url",
    "\u72b6\u6001": "type", "type": "type", "\u89c2\u770b\u72b6\u6001": "type", "\u6536\u85cf\u7c7b\u578b": "type",
    "\u662f\u5426\u770b\u5b8c": "watchStatus",
    "\u8bc4\u5206": "rate", "rate": "rate", "\u5206\u6570": "rate", "rating": "rate", "\u6253\u5206": "rate",
    "\u6807\u7b7e": "tags", "tags": "tags", "tag": "tags", "\u6807\u7b7e/\u5206\u7ea7": "tags",
    "\u8bc4\u4ef7": "comment", "comment": "comment", "\u5907\u6ce8": "comment", "notes": "comment",
    "\u5267\u900f/\u611f\u8a00": "comment", "\u611f\u8a00": "comment",
    "\u5b8c\u64ad\u65e5": "finishedDate", "\u5b8c\u64ad\u65e5\u671f": "finishedDate", "\u770b\u5b8c\u65f6\u95f4": "finishedDate",
    "finished": "finishedDate", "\u65e5\u671f": "finishedDate",
    "\u7ae0\u8282\u72b6\u6001": "epStatus", "ep_status": "epStatus", "\u96c6\u6570": "epStatus",
    "\u540c\u6b65\u72b6\u6001": "syncStatus", "sync_status": "syncStatus",
    "\u5f00\u64ad\u5b63\u5ea6": "startSeason", "\u5f00\u64ad\u65e5\u671f": "startDate",
    "\u522b\u540d": "alias", "\u7c7b\u522b": "category", "\u5236\u4f5c\u516c\u53f8": "studio",
    "\u539f\u4f5c\u6807\u7b7e": "originalTag", "\u7279\u70b9/\u5370\u8c61": "impression",
    "\u96c6\u53f7": "epNum", "\u7cfb\u5217": "series", "\u5b63\u6570": "season",
    "\u65f6\u957f": "duration", "\u5bfc\u6f14": "director", "\u97f3\u4e50": "music",
    "\u5236\u7247\u56fd\u5bb6": "country", "\u5e8f\u5217\u53f7": "sequence"
};

// 缓存的总数据行数，用于优化扫描范围
let _cachedTotalRows = 0;

// ========== 工具函数 ==========
/**
 * 解析 JSON 请求体为可读描述
 */
export function parseJsonBodySummary(jsonStr) {
    if (!jsonStr) return "(\u7a7a)";
    try {
        let obj = JSON.parse(jsonStr);
        let parts = [];
        if (obj.type !== undefined) parts.push("\u72b6\u6001:" + (TYPE_TEXT_MAP[obj.type] || obj.type));
        if (obj.rate !== undefined && obj.rate > 0) parts.push("\u8bc4\u5206:" + obj.rate);
        if (obj.tags && obj.tags.length > 0) parts.push("\u6807\u7b7e:[" + obj.tags.join(",") + "]");
        if (obj.comment) {
            let comment = obj.comment.length > 30 ? obj.comment.substring(0, 30) + "..." : obj.comment;
            parts.push("\u8bc4\u4ef7:" + comment);
        }
        return parts.length > 0 ? parts.join(" | ") : "(\u4ec5\u6807\u8bb0\u72b6\u6001)";
    } catch (e) {
        return jsonStr;
    }
}

/**
 * 检查是否为空值
 */
export function isEmptyValue(val) {
    return val === null || val === undefined || val === "" ||
           val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}

/**
 * JSON 转义
 */
function jsonEscape(s) {
    s = s.split("\\").join("\\\\");
    s = s.split('"').join('\\"');
    s = s.split("\n").join("\\n");
    s = s.split("\r").join("\\n");
    s = s.split("\t").join("\\t");
    return s;
}

// ========== 获取数据工作表（优先使用锁定的工作表）==========
/**
 * 获取数据工作表
 */
export function getDataSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        return null;
    }

    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        try {
            return app.ActiveWorkbook.Worksheets.Item(BGM.sheet.lockedIndex);
        } catch (e) {
            bgmLog(LOG_LEVELS.WARN, "getDataSheet \u9501\u5b9a\u5de5\u4f5c\u8868\u5931\u8d25: " + e.message);
        }
    }

    return app.ActiveWorkbook.ActiveSheet;
}

/**
 * 获取 Bangumi Token
 */
export function getBgmtoken() {
    return loadBgToken();
}

// ========== 获取D列最后一行 ==========
/**
 * 获取 D 列最后一行
 */
export function getLastRow(ws) {
    try {
        let cell = getCell(ws, ws.Rows.Count, COLUMNS.SEQUENCE);
        if (cell && cell.Value) {
            return cell.End(XL.UP).Row;
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.WARN, "getLastRow \u5931\u8d25: " + e.message);
    }

    return 1000;
}

// ========== URL 解析 ==========
/**
 * 从 Bangumi URL 提取 subject_id
 */
export function extractSubjectId(url) {
    if (!url) return "";
    for (let pattern of URL_PATTERNS) {
        let match = url.match(pattern);
        if (match) return match[1];
    }
    return "";
}

// ========== 表头识别 ==========
/**
 * 查找表头行
 * 扫描前 50 行 x 50 列，匹配已知表头关键词，>=3 个匹配确认为表头行
 */
export function findHeaderRow(ws, startRow) {
    startRow = startRow || 1;

    for (let row = startRow; row <= 50; row++) {
        let matchCount = 0;
        for (let col = 1; col <= 50; col++) {
            try {
                let cellVal = String(getCellValue(ws, row, col)).toLowerCase();
                if (!cellVal) continue;
                for (let header of HEADER_KEYWORDS) {
                    if (cellVal.indexOf(header.toLowerCase()) >= 0) {
                        matchCount++;
                        break;
                    }
                }
                if (matchCount >= 3) break;
            } catch (e) {}
        }
        if (matchCount >= 3) {
            return row;
        }
    }

    return 0;
}

// ========== 列映射 ==========
/**
 * 获取列名到列号的映射（使用 Map，兼容丰富的列名）
 * @returns {Map<string, number>}
 */
export function getColumnMap(ws, headerRow) {
    let colMap = new Map();
    let lastCol = 50;

    for (let i = 1; i <= lastCol; i++) {
        let colName = trim(String(getCellValue(ws, headerRow, i)));
        if (colName === "") continue;

        let lowerName = colName.toLowerCase();

        // Bangumi URL 列（优先级最高）
        if (lowerName.indexOf("bangumi") >= 0 || lowerName.indexOf("bgm") >= 0 ||
            colName.indexOf("URL") >= 0 || lowerName.indexOf("subject") >= 0) {
            colMap.set("Bangumi_URL", i);
        }
        // 观看状态
        else if (colName.indexOf("\u662f\u5426\u770b\u5b8c") >= 0 || colName.indexOf("\u89c2\u770b\u72b6\u6001") >= 0 ||
                 colName.indexOf("\u72b6\u6001") >= 0) {
            colMap.set("\u662f\u5426\u770b\u5b8c", i);
        }
        // 完播相关
        else if (colName.indexOf("\u5b8c\u64ad") >= 0 || colName.indexOf("\u770b\u5b8c\u65f6\u95f4") >= 0) {
            colMap.set("\u5b8c\u64ad\u65e5", i);
        }
        // 开播日期
        else if (colName.indexOf("\u5f00\u64ad\u65e5\u671f") >= 0 || colName.indexOf("\u5f00\u64ad\u65f6\u95f4") >= 0 ||
                 colName.indexOf("\u9996\u64ad") >= 0) {
            colMap.set("\u5f00\u64ad\u65e5\u671f", i);
        }
        // 开播季度
        else if (colName.indexOf("\u5f00\u64ad\u5b63\u5ea6") >= 0 || colName.indexOf("\u5b63\u5ea6") >= 0 ||
                 colName.indexOf("\u5e74\u4efd") >= 0) {
            colMap.set("\u5f00\u64ad\u5b63\u5ea6", i);
        }
        // 打分
        else if (colName.indexOf("\u6253\u5206") >= 0 || colName.indexOf("\u8bc4\u5206") >= 0 ||
                 colName.indexOf("\u5206\u6570") >= 0 || lowerName.indexOf("rate") >= 0) {
            colMap.set("\u6253\u5206", i);
        }
        // 评论/感言
        else if (colName.indexOf("\u611f\u8a00") >= 0 || colName.indexOf("\u5267\u900f") >= 0 ||
                 colName.indexOf("\u8bc4\u4ef7") >= 0 || colName.indexOf("\u8bc4\u8bba") >= 0 ||
                 colName.indexOf("comment") >= 0) {
            colMap.set("\u5267\u900f/\u611f\u8a00", i);
        }
        // 标签/分级
        else if (colName.indexOf("\u6807\u7b7e") >= 0 || colName.indexOf("\u5206\u7ea7") >= 0 ||
                 colName.indexOf("tag") >= 0) {
            colMap.set("\u6807\u7b7e/\u5206\u7ea7", i);
        }
        // 特点/印象
        else if (colName.indexOf("\u7279\u70b9") >= 0 || colName.indexOf("\u5370\u8c61") >= 0) {
            colMap.set("\u7279\u70b9/\u5370\u8c61", i);
        }
        // 集号/看到
        else if (colName.indexOf("\u96c6\u53f7") >= 0 || colName.indexOf("\u770b\u5230") >= 0 ||
                 colName.indexOf("ep") >= 0) {
            colMap.set("\u96c6\u53f7", i);
        }
        // 集数
        else if (colName.indexOf("\u96c6\u6570") >= 0 || colName.indexOf("\u603b\u96c6") >= 0) {
            colMap.set("\u96c6\u6570", i);
        }
        // 名称/标题
        else if (colName.indexOf("\u540d\u79f0") >= 0 || colName.indexOf("\u6807\u9898") >= 0 ||
                 colName.indexOf("name") >= 0 || lowerName.indexOf("title") >= 0) {
            colMap.set("\u540d\u79f0", i);
        }
        // 别名
        else if (colName.indexOf("\u522b\u540d") >= 0 || colName.indexOf("\u539f\u540d") >= 0 ||
                 lowerName.indexOf("alias") >= 0) {
            colMap.set("\u522b\u540d", i);
        }
        // 类别
        else if (colName.indexOf("\u7c7b\u522b") >= 0 || colName.indexOf("\u5206\u7c7b") >= 0 ||
                 colName.indexOf("type") >= 0) {
            colMap.set("\u7c7b\u522b", i);
        }
        // 原作标签
        else if (colName.indexOf("\u539f\u4f5c\u6807\u7b7e") >= 0 || colName.indexOf("\u539f\u4f5c") >= 0) {
            colMap.set("\u539f\u4f5c\u6807\u7b7e", i);
        }
        // 制作公司
        else if (colName.indexOf("\u5236\u4f5c\u516c\u53f8") >= 0 || lowerName.indexOf("studio") >= 0) {
            colMap.set("\u5236\u4f5c\u516c\u53f8", i);
        }
        // 系列
        else if (colName.indexOf("\u7cfb\u5217") >= 0) {
            colMap.set("\u7cfb\u5217", i);
        }
        // 季数
        else if (colName.indexOf("\u5b63\u6570") >= 0 || (colName.indexOf("\u7b2c") >= 0 && colName.indexOf("\u5b63") >= 0)) {
            colMap.set("\u5b63\u6570", i);
        }
        // 时长
        else if (colName.indexOf("\u65f6\u957f") >= 0 || colName.indexOf("\u5206\u949f") >= 0) {
            colMap.set("\u65f6\u957f", i);
        }
        // 导演
        else if (colName.indexOf("\u5bfc\u6f14") >= 0 || lowerName.indexOf("director") >= 0) {
            colMap.set("\u5bfc\u6f14", i);
        }
        // 音乐
        else if (colName.indexOf("\u97f3\u4e50") >= 0 || lowerName.indexOf("music") >= 0) {
            colMap.set("\u97f3\u4e50", i);
        }
        // 序列号
        else if (colName.indexOf("\u5e8f\u5217\u53f7") >= 0 || colName.indexOf("\u5e8f\u53f7") >= 0 ||
                 colName.indexOf("\u7f16\u53f7") >= 0) {
            colMap.set("\u5e8f\u5217\u53f7", i);
        }
        // 制片国家
        else if (colName.indexOf("\u5236\u7247\u56fd\u5bb6") >= 0) {
            colMap.set("\u5236\u7247\u56fd\u5bb6", i);
        }
        // 语言
        else if (colName.indexOf("\u8bed\u8a00") >= 0) {
            colMap.set("\u8bed\u8a00", i);
        }
    }
    return colMap;
}

// ========== 映射观看状态 -> Bangumi type ==========
/**
 * 映射观看状态到 Bangumi type
 * Bangumi type: 1=想看 2=在看 3=看过 4=搁置 5=抛弃
 * 0=不上传（空白、否、想看等）
 * 上传条件：看过(3) / 在看(2) / 搁置(4) / 抛弃(5)
 */
export function mapWatchStatus(status) {
    if (isEmptyValue(status)) {
        return 0; // 不上传
    }

    let s = trim(status);
    let result = WATCH_STATUS_MAP[s.toLowerCase()];

    if (result !== undefined) return result;

    // 模糊匹配
    if (s.indexOf("\u8ffd") >= 0) return 2; // 在看
    if (s.indexOf("\u6401") >= 0 || s.indexOf("\u505c") >= 0) return 4;
    if (s.indexOf("\u5f03") >= 0) return 5;

    return 0; // 其他情况不上传
}

// ========== 构建标签 ==========
/**
 * 从字符串提取标签
 */
function addTagsFromStr(tagSet, raw) {
    if (raw === "") return;

    // 主要分隔符是 | ，同时支持其他常见分隔符
    let seps = ["|", "\u3001", "/", "\\", ",", ";", "\uff5c", "\uff0c", "\u3002"];
    let s = String(raw);

    for (let sep of seps) {
        s = s.split(sep).join("|");
    }

    let parts = s.split("|");
    for (let p of parts) {
        let tag = trim(p);
        tag = tag.replace(/^\s+|\s+$/g, "");
        tag = tag.split(" ").join("_");
        tag = tag.split("\t").join("_");
        if (tag !== "" && !tagSet.has(tag) && tag.length > 0) {
            tagSet.add(tag);
        }
    }
}

/**
 * 构建标签数组
 */
function buildTags(ws, row, colMap) {
    let tagSet = new Set();

    if (colMap.has("\u6807\u7b7e/\u5206\u7ea7")) {
        addTagsFromStr(tagSet, trim(getCellValue(ws, row, colMap.get("\u6807\u7b7e/\u5206\u7ea7"))));
    }

    if (colMap.has("\u7279\u70b9/\u5370\u8c61")) {
        addTagsFromStr(tagSet, trim(getCellValue(ws, row, colMap.get("\u7279\u70b9/\u5370\u8c61"))));
    }

    if (tagSet.size === 0) return "";

    let tags = [];
    for (let tag of tagSet) {
        tags.push('"' + tag + '"');
    }
    return tags.join(",");
}

// ========== 构建 JSON 请求体 ==========
/**
 * 构建 Bangumi API 请求体
 * @returns {string} JSON 字符串，空字符串表示不上传
 */
export function buildJsonPayload(ws, row, colMap, finishedDate) {
    // --- type: 收藏类型 ---
    let watchStatus = "";
    if (colMap.has("\u662f\u5426\u770b\u5b8c")) {
        watchStatus = trim(getCellValue(ws, row, colMap.get("\u662f\u5426\u770b\u5b8c")));
    }
    let bgmType = mapWatchStatus(watchStatus, finishedDate);

    // type=0 表示不需要上传（空白、否、想看等）
    if (bgmType === 0) {
        return "";
    }

    let parts = [];
    parts.push('"type":' + bgmType);

    // --- rate: 评分 ---
    if (colMap.has("\u6253\u5206")) {
        let rateVal = getCellValue(ws, row, colMap.get("\u6253\u5206"));
        if (!isNaN(rateVal)) {
            let rate = Math.max(0, Math.min(10, parseInt(rateVal)));
            if (rate > 0) {
                parts.push('"rate":' + rate);
            }
        }
    }

    // --- comment: 评价/感言 ---
    if (colMap.has("\u5267\u900f/\u611f\u8a00")) {
        let comment = trim(getCellValue(ws, row, colMap.get("\u5267\u900f/\u611f\u8a00")));
        if (comment !== "") {
            parts.push('"comment":"' + jsonEscape(comment) + '"');
        }
    }

    // --- tags: 标签 ---
    let tags = buildTags(ws, row, colMap);
    if (tags !== "") {
        parts.push('"tags":[' + tags + ']');
    }

    return "{" + parts.join(",") + "}";
}

// ========== BGM API 请求 ==========
/**
 * 同步发送 BGM API 请求（含 429 自动重试）
 * @param {string} method - HTTP 方法 (GET, POST, PUT, DELETE)
 * @param {string} endpoint - API 端点
 * @param {string} body - 请求体（JSON 字符串）
 * @param {string} token - 认证 Token
 * @returns {object} { code: number, message: string }
 */
export function bgmRequestSync(method, endpoint, body, token) {
    const { MAX_RETRIES, RETRY_DELAY_BASE } = BGM_CONFIG;
    let retries = 0;

    // 输入验证
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (!validMethods.includes(method.toUpperCase())) {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: \u65e0\u6548\u7684 HTTP \u65b9\u6cd5: " + method);
        return { code: 0, message: "Invalid HTTP method" };
    }

    if (!endpoint || typeof endpoint !== 'string') {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: endpoint \u65e0\u6548");
        return { code: 0, message: "Invalid endpoint" };
    }

    if (endpoint.includes('..') || endpoint.includes('//') || endpoint.startsWith('http')) {
        bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: endpoint \u5305\u542b\u975e\u6cd5\u5b57\u7b26: " + endpoint);
        return { code: 0, message: "Invalid endpoint path" };
    }

    if (body && typeof body === 'string' && body.trim().startsWith('{')) {
        try {
            JSON.parse(body);
        } catch (e) {
            bgmLog(LOG_LEVELS.ERROR, "bgmRequestSync: \u65e0\u6548\u7684 JSON body");
            return { code: 0, message: "Invalid JSON body" };
        }
    }

    while (retries <= MAX_RETRIES) {
        let xhr = new XMLHttpRequest();
        xhr.open(method, BGM_CONFIG.API_BASE + endpoint, false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");

        try {
            xhr.send(body);
            let statusCode = xhr.status;
            let responseText = xhr.responseText;

            if (statusCode === 204) {
                return { code: statusCode, message: "OK" };
            }
            if (statusCode === 200 || statusCode === 201 || statusCode === 202) {
                return { code: statusCode, message: responseText };
            }
            if (statusCode === 429 && retries < MAX_RETRIES) {
                retries++;
                let retryDelay = RETRY_DELAY_BASE * Math.pow(2, retries - 1);
                bgmLog(LOG_LEVELS.WARN, `API \u9650\u6d41(429)\uff0c\u7b2c ${retries}/${MAX_RETRIES} \u6b21\u91cd\u8bd5\uff0c\u7b49\u5f85 ${retryDelay}ms`);
                sleep(retryDelay);
                continue;
            }
            return { code: statusCode, message: responseText || "Error" };
        } catch (err) {
            return { code: 0, message: "Error: " + err.message };
        }
    }

    return { code: 429, message: `\u8d85\u8fc7\u6700\u5927\u91cd\u8bd5\u6b21\u6570(${MAX_RETRIES}\u6b21)` };
}

/**
 * 异步发送 BGM API 请求
 */
export async function bgmRequest(method, endpoint, body, token) {
    return bgmRequestSync(method, endpoint, body, token);
}

// ========== 主入口：批量同步 ==========
/**
 * 批量同步 Excel 数据到 Bangumi
 */
export function SyncToBangumi() {
    let app = getApp();
    if (!app) {
        showDialog("\u9519\u8bef", "\u65e0\u6cd5\u83b7\u53d6 WPS Application \u5bf9\u8c61\uff01");
        return;
    }
    let ws = getDataSheet();
    if (!ws) {
        showDialog("\u63d0\u793a", "\u672a\u627e\u5230\u6570\u636e\u5de5\u4f5c\u8868\uff01\u8bf7\u5728\u5de5\u4f5c\u8868\u9009\u62e9\u5668\u4e2d\u9009\u62e9\u4e00\u4e2a\u5de5\u4f5c\u8868\u3002");
        return;
    }

    let token = getBgmtoken();
    if (!token) {
        showDialog("\u63d0\u793a", "\u672a\u8bbe\u7f6e Bangumi Token\uff0c\u65e0\u6cd5\u540c\u6b65\uff01");
        return;
    }

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) {
        showDialog("\u63d0\u793a", "\u672a\u627e\u5230\u8868\u5934\u884c\uff01\u8bf7\u786e\u4fdd\u5de5\u4f5c\u8868\u7b2c\u4e00\u884c\u5305\u542b\u5217\u540d\u3002");
        return;
    }

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap) return;

    if (!colMap.has("Bangumi_URL")) {
        showDialog("\u63d0\u793a", "\u672a\u627e\u5230 \"Bangumi URL\" \u5217\uff0c\u65e0\u6cd5\u83b7\u53d6 subject_id\uff01");
        return;
    }

    // 确保同步记录表存在
    if (typeof getOrCreateSyncRecordSheet === 'function' && !getOrCreateSyncRecordSheet()) {
        showDialog("\u521b\u5efa\u5931\u8d25", "\u521b\u5efa\u540c\u6b65\u8bb0\u5f55\u8868\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5de5\u4f5c\u7c3f\u72b6\u6001");
        return;
    }

    // 如果还没有缓存用户 ID，尝试通过 Token 获取
    if (!BGM.cache.userId && typeof fetchBgmUserInfo === 'function') {
        fetchBgmUserInfo();
    }

    let lastRow = getLastRow(ws);

    // 激活同步记录表（方便查看同步过程）
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        let syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            syncSheet.Activate();
        }
    }

    let successCount = 0, failCount = 0, skipNoUrlCount = 0, skipNoTypeCount = 0;

    // 记录详细日志
    let logEntries = [];

    BGM.sync.isRunning = true;
    BGM.sync.lastSyncTime = null;

    for (let i = headerRow + 1; i <= lastRow; i++) {
        // 获取名称
        let name = "";
        if (colMap.has("\u540d\u79f0")) {
            name = trim(getCellValue(ws, i, colMap.get("\u540d\u79f0")));
        }

        // 从 Bangumi URL 提取 subject_id
        let bgmUrl = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")));
        let subjectId = extractSubjectId(bgmUrl);

        // 获取条目类别
        let itemType = "";
        if (colMap.has("\u7c7b\u522b")) {
            itemType = trim(getCellValue(ws, i, colMap.get("\u7c7b\u522b")));
        }

        if (subjectId === "") {
            skipNoUrlCount++;
            try {
                let firstCell = getCell(ws, i, 1);
                if (firstCell && firstCell.Interior) firstCell.Interior.Color = BGM_COLOR.SKIP;
            } catch (e) {}
            let skipInfo = `\u8df3\u8fc7] \u884c${i}: ${name || "(\u65e0\u540d\u79f0)"} - \u7f3a\u5c11 Bangumi URL`;
            bgmLog(LOG_LEVELS.INFO, "SyncToBangumi - " + skipInfo);
            logEntries.push(skipInfo);

            // 写入同步记录表
            if (typeof getOrCreateSyncRecordSheet === 'function') {
                let syncSheet = getOrCreateSyncRecordSheet();
                if (syncSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncSheet, {
                        name: name || "(\u65e0\u540d\u79f0)",
                        url: bgmUrl,
                        sid: "",
                        type: itemType,
                        content: "\u8df3\u8fc7\u539f\u56e0\uff1a\u7f3a\u5c11 Bangumi URL",
                        status: "\u8df3\u8fc7",
                        comment: "\u884c" + i + " \u65e0BGM\u94fe\u63a5",
                        count: 1
                    });
                }
            }
            sleep(BGM_CONFIG.REQUEST_DELAY);
            continue;
        }

        // 获取完播日
        let finishedDate = "";
        if (colMap.has("\u5b8c\u64ad\u65e5")) {
            finishedDate = trim(getCellValue(ws, i, colMap.get("\u5b8c\u64ad\u65e5")));
        }

        // 获取观看状态
        let watchStatus = "";
        if (colMap.has("\u662f\u5426\u770b\u5b8c")) {
            watchStatus = trim(getCellValue(ws, i, colMap.get("\u662f\u5426\u770b\u5b8c")));
        }

        // 构建请求体
        let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);

        if (jsonBody === "") {
            skipNoTypeCount++;
            let skipInfo = `\u8df3\u8fc7] \u884c${i}: ${name || "(\u65e0\u540d\u79f0)"} (SID=${subjectId}) - \u89c2\u770b\u72b6\u6001\u300c${watchStatus}\u300d\u4e0d\u4e0a\u4f20`;
            bgmLog(LOG_LEVELS.INFO, "SyncToBangumi - " + skipInfo);
            logEntries.push(skipInfo);

            // 写入同步记录表
            if (typeof getOrCreateSyncRecordSheet === 'function') {
                let syncSheet = getOrCreateSyncRecordSheet();
                if (syncSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncSheet, {
                        name: name || "(\u65e0\u540d\u79f0)",
                        url: bgmUrl,
                        sid: subjectId,
                        type: itemType,
                        content: "\u8df3\u8fc7\u539f\u56e0\uff1a\u89c2\u770b\u72b6\u6001\u300c" + watchStatus + "\u300d\u4e0d\u9700\u8981\u4e0a\u4f20",
                        status: "\u8df3\u8fc7",
                        comment: "\u884c" + i + " \u72b6\u6001=\u4e0d\u4f20",
                        count: 1
                    });
                }
            }
            continue;
        }

        // 解析请求体摘要
        let bodySummary = parseJsonBodySummary(jsonBody);

        // 发送请求
        let result = bgmRequestSync("POST", "/v0/users/" + _getUserApiPath() + "/collections/" + subjectId, jsonBody, token);
        let statusCode = result.code;

        // 处理结果
        if (statusCode === 200 || statusCode === 201 || statusCode === 202 || statusCode === 204) {
            successCount++;
            try {
                let successCell = getCell(ws, i, 1);
                if (successCell && successCell.Interior) successCell.Interior.Color = BGM_COLOR.SUCCESS;
            } catch (e) {}
            let successInfo = `\u6210\u529f] \u884c${i}: ${name || "(\u65e0\u540d\u79f0)"} (SID=${subjectId}) - ${bodySummary}`;
            bgmLog(LOG_LEVELS.INFO, "SyncToBangumi - " + successInfo);
            logEntries.push(successInfo);

            // 写入同步记录表
            if (typeof getOrCreateSyncRecordSheet === 'function') {
                let syncSheet = getOrCreateSyncRecordSheet();
                if (syncSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncSheet, {
                        name: name || "(\u65e0\u540d\u79f0)",
                        url: bgmUrl,
                        sid: subjectId,
                        type: itemType,
                        content: "\u4e0a\u4f20\u540c\u6b65\uff1a" + bodySummary,
                        status: "\u6210\u529f",
                        comment: "\u884c" + i,
                        count: 1
                    });
                }
            }
        } else {
            failCount++;
            try {
                let failCell = getCell(ws, i, 1);
                if (failCell && failCell.Interior) failCell.Interior.Color = BGM_COLOR.FAIL;
            } catch (e) {}
            let errMsg = result.message || "HTTP " + statusCode;
            let failInfo = `\u5931\u8d25] \u884c${i}: ${name || "(\u65e0\u540d\u79f0)"} (SID=${subjectId}) - \u9519\u8bef: ${errMsg} | \u6570\u636e: ${bodySummary}`;
            bgmLog(LOG_LEVELS.ERROR, "SyncToBangumi - " + failInfo);
            logEntries.push(failInfo);

            // 写入同步记录表
            if (typeof getOrCreateSyncRecordSheet === 'function') {
                let syncSheet = getOrCreateSyncRecordSheet();
                if (syncSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncSheet, {
                        name: name || "(\u65e0\u540d\u79f0)",
                        url: bgmUrl,
                        sid: subjectId,
                        type: itemType,
                        content: "\u4e0a\u4f20\u540c\u6b65\uff1a" + bodySummary,
                        status: "\u5931\u8d25",
                        comment: errMsg,
                        count: 1
                    });
                }
            }
        }

        // 进度提示
        if (i % 10 === 0 && app.StatusBar !== undefined) {
            app.StatusBar = "\u5904\u7406\u8fdb\u5ea6: " + (i - headerRow) + "/" + (lastRow - headerRow) +
                           " \u6210\u529f:" + successCount + " \u5931\u8d25:" + failCount +
                           " \u8df3\u8fc7:" + (skipNoUrlCount + skipNoTypeCount);
        }

        sleep(BGM_CONFIG.REQUEST_DELAY);
    }

    BGM.sync.isRunning = false;
    BGM.sync.lastSyncTime = new Date().toISOString();

    if (app.StatusBar !== undefined) app.StatusBar = false;

    let skipTotal = skipNoUrlCount + skipNoTypeCount;
    let totalCount = lastRow - headerRow;

    // 构建详细的同步报告
    let report = "\u540c\u6b65\u5b8c\u6210\uff01\n";
    report += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
    report += "\u6210\u529f: " + successCount + " \u6761\n";
    report += "\u5931\u8d25: " + failCount + " \u6761\n";
    report += "\u8df3\u8fc7(\u65e0URL): " + skipNoUrlCount + " \u6761\n";
    report += "\u8df3\u8fc7(\u4e0d\u987b\u4e0a\u4f20): " + skipNoTypeCount + " \u6761\n";
    report += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n";

    // 显示详细日志（最多20条）
    if (logEntries.length > 0) {
        report += "\u8be6\u7ec6\u65e5\u5fd7\uff1a\n";
        let showCount = Math.min(logEntries.length, 20);
        for (let e = 0; e < showCount; e++) {
            report += logEntries[e] + "\n";
        }
        if (logEntries.length > 20) {
            report += "... \u8fd8\u6709 " + (logEntries.length - 20) + " \u6761\u65e5\u5fd7\n";
        }
    }

    report += "\n\u540c\u6b65\u8bb0\u5f55\u5df2\u4fdd\u5b58\u5230\u300c\u540c\u6b65\u8bb0\u5f55\u300d\u5de5\u4f5c\u8868";

    showDialog("\u540c\u6b65\u5b8c\u6210", report);

    bgmLog(LOG_LEVELS.INFO, "SyncToBangumi \u5b8c\u6210: \u6210\u529f=" + successCount + " \u5931\u8d25=" + failCount +
        " \u8df3\u8fc7=" + skipTotal + " \u603b\u8ba1=" + totalCount);

    return { success: successCount, fail: failCount, skip: skipTotal };
}

// ========== 异步批量同步（推荐使用）==========
/**
 * 异步批量同步 Excel 数据到 Bangumi
 * @param {Function} onProgress - 进度回调 (current, total, message)
 * @param {Function} onItemComplete - 单项完成回调 (row, success, result)
 */
export async function syncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options = {}) {
    const { onProgress, onItemComplete } = options;

    BGM.sync.isRunning = true;
    BGM.sync.lastSyncTime = null;

    let syncRecordSheet = null;
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncRecordSheet = getOrCreateSyncRecordSheet();
    }

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let totalCount = lastRow - headerRow;

    for (let i = headerRow + 1; i <= lastRow; i++) {
        if (onProgress) {
            onProgress(i - headerRow, totalCount, `\u6b63\u5728\u5904\u7406\u7b2c ${i} \u884c...`);
        }

        try {
            let bgmUrl = colMap.url ? trim(getCellValue(ws, i, colMap.url)) : "";
            let sid = extractSubjectId(bgmUrl);

            if (!sid) {
                skipCount++;
                if (onItemComplete) onItemComplete(i, false, { code: 0, message: '\u65e0SID' });
                continue;
            }

            let jsonBody = buildJsonPayload(ws, i, colMap);
            if (!jsonBody) {
                skipCount++;
                if (onItemComplete) onItemComplete(i, false, { code: 0, message: '\u72b6\u6001\u4e0d\u4e0a\u4f20' });
                continue;
            }

            const result = await httpRequest(`/subject/${sid}/update`, {
                method: 'POST',
                body: jsonBody,
                token: token
            });

            const syncSuccess = result.isOk() && (result.data?.status === 204 || result.data?.status === 200 || result.data?.status === 201);

            if (syncSuccess) {
                successCount++;
                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: bgmUrl,
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "\u6210\u529f"
                    });
                }
            } else {
                failCount++;
                const errorMsg = result.isFail() ? result.error.message : `HTTP ${result.data?.status}`;
                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: bgmUrl,
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "\u5931\u8d25:" + errorMsg
                    });
                }
            }

            if (onItemComplete) {
                onItemComplete(i, syncSuccess, { code: result.data?.status, message: result.error?.message });
            }

            await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY));

        } catch (err) {
            failCount++;
            bgmLog(LOG_LEVELS.ERROR, "\u540c\u6b65\u7b2c " + i + " \u884c\u51fa\u9519: " + err.message);

            if (onItemComplete) {
                onItemComplete(i, false, { code: 0, message: err.message });
            }
        }
    }

    BGM.sync.isRunning = false;
    BGM.sync.lastSyncTime = new Date().toISOString();

    return { success: successCount, fail: failCount, skip: skipCount };
}

// ========== 筛选状态检测（增强版）==========
/**
 * 获取筛选状态
 * @param {number} endRow - 用户指定的结束行号，0表示自动检测
 * @param {boolean} getColumnCounts - 是否获取各列的唯一值计数
 */
export function getFilterStatus(endRow, getColumnCounts) {
    let app = getApp();
    if (!app) return null;

    let ws = getDataSheet();
    if (!ws) return null;

    let result = {
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

    try {
        let autoFilter = ws.AutoFilter;
        let filterMode = false;
        let filterStartRow = 2;

        if (autoFilter) {
            filterMode = autoFilter.FilterMode === true;
            result.hasFilter = filterMode;

            if (autoFilter.Range) {
                let filterRange = autoFilter.Range;
                filterStartRow = filterRange.Row + 1;
                let estimatedEndRow = _cachedTotalRows > 0 ? _cachedTotalRows + filterStartRow + 50 : 0;
                result.totalRows = filterRange.Rows.Count - 1;
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
                            let colLetter = colNumToLetter(i);
                            let headerCell = ws.Range(colLetter + "1") || ws.Cells(1, i);
                            let colName = headerCell.Value ? String(headerCell.Value).substring(0, 10) : "\u5217" + i;

                            let criteria = f.Criteria1 || "";
                            if (f.Criteria2) {
                                criteria += " / " + f.Criteria2;
                            }
                            if (f.Operator === 1) {
                                criteria = f.Criteria1 + " \u4e14 " + f.Criteria2;
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

        // 检测被隐藏的行
        let scanEndRow;
        if (endRow > 0) {
            scanEndRow = endRow;
        } else if (_cachedTotalRows > 0) {
            scanEndRow = filterStartRow + _cachedTotalRows + 50;
        } else {
            scanEndRow = getLastRow(ws);
        }

        // 使用 SpecialCells 获取 D 列可见行
        try {
            if (filterMode && autoFilter && autoFilter.Range) {
                let filterRange = autoFilter.Range;
                let actualLastRow = getLastRow(ws);
                let filterEndRow = Math.min(filterRange.Row + filterRange.Rows.Count - 1, actualLastRow);

                try {
                    let filterRangeStr = "D" + filterStartRow + ":D" + filterEndRow;
                    let visibleCells = ws.Range(filterRangeStr).SpecialCells(12);

                    if (visibleCells) {
                        try {
                            let areas = visibleCells.Areas;
                            for (let a = 1; a <= areas.Count; a++) {
                                let area = areas.Item(a);
                                let rows = area.Rows;
                                for (let r = 1; r <= rows.Count; r++) {
                                    let rowNum = rows.Item(r).Row;
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
                            bgmLog(LOG_LEVELS.WARN, "\u904d\u5386 Areas \u5931\u8d25: " + e.message);
                        }
                    }
                } catch (e) {}

                // 计算总数据行数
                let totalDataRows = 0;
                for (let i = filterStartRow; i <= filterEndRow; i++) {
                    try {
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

                // 计算隐藏行
                if (result.visibleRows.length > 0) {
                    let visibleSet = new Set(result.visibleRows);
                    for (let i = filterStartRow; i <= filterEndRow; i++) {
                        try {
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
        } catch (e) {}

        // 回退到逐行扫描方式
        if (result.visibleRows.length === 0 && result.hiddenRows.length === 0) {
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

        result.visibleCount = result.visibleRows.length;
        result.hiddenCount = result.hiddenRows.length;

        // 获取各列的唯一值计数
        if (getColumnCounts === true) {
            result.columnCounts = getColumnValueCounts(ws, scanEndRow);
        }
    } catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "getFilterStatus error: " + e.message);
    }

    return result;
}

/**
 * 获取指定范围内各列的唯一值计数
 */
export function getColumnValueCounts(ws, endRow) {
    let counts = {};
    let startRow = 2;

    try {
        let autoFilter = ws.AutoFilter;
        if (autoFilter && autoFilter.Range) {
            let filterRange = autoFilter.Range;
            let colCount = filterRange.Columns.Count;

            for (let col = 1; col <= colCount; col++) {
                let valueCounts = {};
                let blankCount = 0;

                for (let row = startRow; row <= endRow; row++) {
                    try {
                        let cell = ws.Cells(row, col);
                        let val = cell.Value();

                        if (val === null || val === undefined || val === "") {
                            blankCount++;
                        } else {
                            let key = String(val).substring(0, 50);
                            valueCounts[key] = (valueCounts[key] || 0) + 1;
                        }
                    } catch (e) {}
                }

                if (blankCount > 0) {
                    valueCounts["(\u7a7a\u767d)"] = blankCount;
                }

                if (Object.keys(valueCounts).length > 0) {
                    counts[col] = valueCounts;
                }
            }
        }
    } catch (e) {}

    return counts;
}

/**
 * 获取筛选后的可见行
 */
export function getVisibleRows() {
    let status = getFilterStatus();
    return status ? status.visibleRows : [];
}

/**
 * 获取被筛选掉的行
 */
export function getFilteredRows() {
    let status = getFilterStatus();
    return status ? status.hiddenRows : [];
}

/**
 * 根据序列号获取连续数据行（支持筛选状态）
 * @param {number} startRow - 起始行（默认从第2行开始）
 * @param {number} endRow - 结束行（0表示自动检测）
 */
export function getSequentialRowsBySeqCol(startRow, endRow) {
    let app = getApp();
    if (!app) return { validRows: [], filteredRows: [], totalFiltered: 0 };

    let ws = getDataSheet();
    if (!ws) return { validRows: [], filteredRows: [], totalFiltered: 0 };

    let filterStatus = getFilterStatus(endRow);
    let visibleRows = filterStatus ? filterStatus.visibleRows : [];
    let hiddenRows = filterStatus ? filterStatus.hiddenRows : [];
    let isFiltered = filterStatus ? filterStatus.hasFilter : false;

    let checkRows = isFiltered ? visibleRows : [];

    let result = {
        validRows: [],
        filteredRows: [],
        totalFiltered: 0,
        hasFilter: isFiltered,
        visibleCount: visibleRows.length,
        hiddenCount: hiddenRows.length
    };

    let seqCol = 4;

    if (isFiltered) {
        let visibleSeqMap = new Map();

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

        let sortedRows = Array.from(visibleSeqMap.keys()).sort(function(a, b) { return a - b; });

        if (sortedRows.length === 0) return result;

        result.validRows.push(sortedRows[0]);

        for (let i = 1; i < sortedRows.length; i++) {
            let prevRow = sortedRows[i - 1];
            let prevSeq = visibleSeqMap.get(prevRow);
            let currRow = sortedRows[i];
            let currSeq = visibleSeqMap.get(currRow);

            let expectedSeq = prevSeq + 1;

            if (currSeq === expectedSeq) {
                result.validRows.push(currRow);
            } else if (currSeq > expectedSeq) {
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
        }
    } else {
        let start = startRow || 2;
        let scanEndRow = endRow > 0 ? endRow : getLastRow(ws);

        let seqMap = new Map();

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

        if (seqMap.size === 0) return result;

        result.validRows = Array.from(seqMap.keys()).sort(function(a, b) { return a - b; });
    }

    return result;
}

// ========== 清除行颜色标记 ==========
/**
 * 清除所有行的颜色标记
 */
export function clearRowColors() {
    let ws = getDataSheet();
    if (!ws) return;

    let lastRow = getLastRow(ws);
    if (lastRow < 2) return;

    for (let i = 2; i <= lastRow; i++) {
        try {
            let cell = getCell(ws, i, 1);
            if (cell && cell.Interior) cell.Interior.ColorIndex = -4142;
        } catch (e) {}
    }
    showDialog("\u5b8c\u6210", "\u5df2\u6e05\u9664\u6240\u6709\u989c\u8272\u6807\u8bb0");
}

// ========== 测试单个条目 ==========
/**
 * 测试单个条目更新
 */
export function testSingleUpdate() {
    let ws = getDataSheet();
    if (!ws) {
        showDialog("\u9519\u8bef", "\u672a\u627e\u5230\u6570\u636e\u5de5\u4f5c\u8868\uff01");
        return;
    }

    let token = getBgmtoken();
    if (!token) {
        showDialog("\u63d0\u793a", "\u8bf7\u5148\u8bbe\u7f6e Token\uff01");
        return;
    }

    let app = getApp();
    if (!app || !app.ActiveCell) {
        showDialog("\u63d0\u793a", "\u8bf7\u5148\u9009\u4e2d\u4e00\u4e2a\u5355\u5143\u683c");
        return;
    }

    let row = app.ActiveCell.Row;
    let headerRow = findHeaderRow(ws);
    let colMap = getColumnMap(ws, headerRow);

    if (!colMap.has("Bangumi_URL")) {
        showDialog("\u63d0\u793a", "\u672a\u627e\u5230 Bangumi URL \u5217");
        return;
    }

    let bgmUrl = trim(getCellValue(ws, row, colMap.get("Bangumi_URL")));
    let sid = extractSubjectId(bgmUrl);

    if (!sid) {
        showDialog("\u63d0\u793a", "\u5f53\u524d\u884c\u6ca1\u6709 Bangumi URL");
        return;
    }

    let finishedDate = "";
    if (colMap.has("\u5b8c\u64ad\u65e5")) {
        finishedDate = trim(getCellValue(ws, row, colMap.get("\u5b8c\u64ad\u65e5")));
    }

    let jsonBody = buildJsonPayload(ws, row, colMap, finishedDate);

    if (!jsonBody) {
        showDialog("\u63d0\u793a", "\u5f53\u524d\u884c\u89c2\u770b\u72b6\u6001\u4e0d\u4e0a\u4f20");
        return;
    }

    let result = bgmRequestSync("POST", "/v0/users/" + _getUserApiPath() + "/collections/" + sid, jsonBody, token);

    if (result.code === 204 || result.code === 200 || result.code === 201) {
        showDialog("\u6d4b\u8bd5\u6210\u529f", "\u6761\u76ee " + sid + " \u66f4\u65b0\u6210\u529f\uff01\n\n\u8bf7\u6c42\u4f53: " + parseJsonBodySummary(jsonBody));
    } else {
        showDialog("\u6d4b\u8bd5\u5931\u8d25", "\u6761\u76ee " + sid + " \u66f4\u65b0\u5931\u8d25\uff01\n\n\u72b6\u6001\u7801: " + result.code + "\n\u54cd\u5e94: " + result.message);
    }
}

// ========== 预览功能 ==========
/**
 * 预览 URL 提取结果
 */
export function previewSubjectIdExtraction() {
    let ws = getDataSheet();
    if (!ws) return;

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) return;

    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.has("Bangumi_URL")) {
        showDialog("\u63d0\u793a", "\u672a\u627e\u5230 Bangumi URL \u5217");
        return;
    }

    let lastRow = getLastRow(ws);
    let previewRows = Math.min(10, lastRow - headerRow);

    let msg = "\u524d" + previewRows + "\u884c\u7684 URL -> subject_id \u63d0\u53d6\u7ed3\u679c\uff1a\n\n";

    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")));
        let sid = extractSubjectId(url);
        msg += "\u884c" + i + ": " + (url.length > 50 ? url.substring(0, 50) + "..." : url) + " -> [" + sid + "]\n";
    }

    showDialog("\u9884\u89c8 URL \u63d0\u53d6", msg);
}

/**
 * 预览 JSON 请求体
 */
export function previewJsonPayload() {
    let ws = getDataSheet();
    if (!ws) return;

    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) return;

    let colMap = getColumnMap(ws, headerRow);

    let previewRows = Math.min(5, 5);
    let msg = "\u524d" + previewRows + "\u884c\u7684\u8bf7\u6c42\u4f53\u9884\u89c8\uff1a\n\n";

    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = "";
        if (colMap.has("Bangumi_URL")) {
            url = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")));
        }
        let sid = extractSubjectId(url);

        let finishedDate = "";
        if (colMap.has("\u5b8c\u64ad\u65e5")) {
            finishedDate = trim(getCellValue(ws, i, colMap.get("\u5b8c\u64ad\u65e5")));
        }

        let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);

        msg += "\u884c" + i + " [ID:" + sid + "]\n";
        msg += (jsonBody || "(\u7a7a)") + "\n\n";
    }

    showDialog("\u9884\u89c8\u8bf7\u6c42\u4f53", msg);
}

// ========== 设置 Token ==========
export function setBangumiToken() {
    openBangumiTokenPage();
}

/**
 * 打开 Bangumi Token 创建页面
 */
export function openBangumiTokenPage() {
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

/**
 * Ribbon 模式测试 Token
 */
export function testTokenValidityForRibbon(token) {
    if (!token) return;

    let xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/v0/me", false);
    xhr.setRequestHeader("Authorization", "Bearer " + token);

    try {
        xhr.send();
        if (xhr.status === 200) {
            let userData = JSON.parse(xhr.responseText);
            showDialog("Token \u6709\u6548", "Token \u9a8c\u8bc1\u6210\u529f\uff01\n\n\u7528\u6237: " + (userData.nickname || userData.username) + "\nID: " + userData.id);
        } else if (xhr.status === 401) {
            showDialog("Token \u65e0\u6548", "Token \u9a8c\u8bc1\u5931\u8d25\uff01\u8bf7\u68c0\u67e5 Token \u662f\u5426\u6b63\u786e\u3002");
        } else {
            showDialog("\u9a8c\u8bc1\u5931\u8d25", "\u9a8c\u8bc1\u5931\u8d25 (" + xhr.status + "): " + xhr.responseText);
        }
    } catch (err) {
        showDialog("\u9a8c\u8bc1\u51fa\u9519", "\u9a8c\u8bc1\u51fa\u9519: " + err.message);
    }
}

/**
 * 打开用户收藏页
 */
export function openUserCollection() {
    let userId = _getBgmUserId();
    if (!userId) {
        if (typeof showUserIdDialog === 'function') {
            showUserIdDialog();
        }
        return;
    }
    window.open("https://bgm.tv/user/" + userId + "/collection", "_blank");
}

/**
 * 构建标签数组（兼容旧接口）
 */
export function buildTagsArray(tagsStr) {
    if (!tagsStr) return [];
    let tagSet = new Set();
    addTagsFromStr(tagSet, tagsStr);
    return Array.from(tagSet).slice(0, 5);
}

// ========== 向后兼容（挂载到 window）==========
window.SyncToBangumi = SyncToBangumi;
window.getDataSheet = getDataSheet;
window.getBgmtoken = getBgmtoken;
window.getLastRow = getLastRow;
window.findHeaderRow = findHeaderRow;
window.getColumnMap = getColumnMap;
window.buildJsonPayload = buildJsonPayload;
window.extractSubjectId = extractSubjectId;
window.clearRowColors = clearRowColors;
window.openUserCollection = openUserCollection;
window.openBangumiTokenPage = openBangumiTokenPage;
window.testTokenValidityForRibbon = testTokenValidityForRibbon;
window.bgmRequestSync = bgmRequestSync;
window.bgmRequest = bgmRequest;
window.previewSubjectIdExtraction = previewSubjectIdExtraction;
window.previewJsonPayload = previewJsonPayload;
window.getFilterStatus = getFilterStatus;
window.getColumnValueCounts = getColumnValueCounts;
window.getSequentialRowsBySeqCol = getSequentialRowsBySeqCol;
window.mapWatchStatus = mapWatchStatus;
window.addTagsFromStr = addTagsFromStr;
window.buildTags = buildTags;
// 以下函数已在 dialog.js / handlers.js 中挂载，不再重复
// window.showTokenDialog, window.showUserIdDialog, window.sendToTaskpane, window.showDialog
