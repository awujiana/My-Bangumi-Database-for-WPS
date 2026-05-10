/**
 * Bangumi API 同步模块（修复版）
 * @module bangumi
 * @description 从 Excel 读取条目并批量同步到 Bangumi 收藏
 */
import { showUserIdDialog, httpRequest, showAlert, Result, getApp, bgmLog, getCell, getCellValue, sleep, loadBgToken, _getBgmUserId, _getUserApiPath, trim, colNumToLetter, BGM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS } from '../index.js';
// ========== 常量定义 ==========
const COLUMNS = {
    SEQUENCE: 4, // D列 - 序号
    DEFAULT_START: 1
};
const WATCH_STATUS_MAP = {
    "看过": 3, "看完": 3, "已看": 3, "完": 3, "completed": 3, "3": 3,
    "在看": 2, "在看动画": 2, "在追": 2, "追": 2, "watching": 2, "2": 2,
    "想看": 0, "想看动画": 0, "否": 0, "wish": 0, "1": 0,
    "搁置": 4, "暂停": 4, "停": 4, "on_hold": 4, "4": 4,
    "抛弃": 5, "弃": 5, "弃番": 5, "drop": 5, "dropped": 5, "5": 5
};
const TYPE_TEXT_MAP = { 1: "想看", 2: "在看", 3: "看过", 4: "搁置", 5: "抛弃" };
const URL_PATTERNS = [
    /bgm\.tv\/subject\/(\d+)/i,
    /bangumi\.tv\/subject\/(\d+)/i,
    /chii\.in\/subject\/(\d+)/i,
    /(\d{6,})/
];
export const HEADER_KEYWORDS = [
    "序列号", "是否看完", "看完时间", "开播季度",
    "开播日期", "完播日", "类别", "原作标签", "制作公司",
    "标签/分级", "特点/印象", "打分", "集号", "集数",
    "名称", "别名", "剧透/感言", "感言", "备注", "评价",
    "bangumi url", "url", "制片国家", "语言", "类型",
    "导演", "音乐", "原作", "标签",
    "条目id", "sid", "状态", "status", "rate",
    "番剧", "动画", "书", "名字", "链接",
    "观看状态", "收藏类型", "章节状态", "同步状态",
    "关联的动漫", "系列", "季数", "时长"
];
export const IMPORTANT_COLS = {
    "名称": true, "是否看完": true, "bangumi url": true,
    "url": true, "打分": true, "集数": true, "感言": true,
    "剧透/感言": true, "类型": true, "状态": true,
    "status": true, "rate": true, "别名": true
};
const FIELD_NAME_MAP = {
    "名称": "name", "name": "name", "作品名": "name", "条目": "name", "标题": "name",
    "条目id": "subjectId", "sid": "subjectId", "subject_id": "subjectId", "id": "subjectId",
    "bangumi url": "url", "url": "url", "链接": "url", "地址": "url",
    "状态": "type", "type": "type", "观看状态": "type", "收藏类型": "type",
    "是否看完": "watchStatus",
    "评分": "rate", "rate": "rate", "分数": "rate", "rating": "rate", "打分": "rate",
    "标签": "tags", "tags": "tags", "tag": "tags", "标签/分级": "tags",
    "评价": "comment", "comment": "comment", "备注": "comment", "notes": "comment",
    "剧透/感言": "comment", "感言": "comment",
    "完播日": "finishedDate", "完播日期": "finishedDate", "看完时间": "finishedDate",
    "finished": "finishedDate", "日期": "finishedDate",
    "章节状态": "epStatus", "ep_status": "epStatus", "集数": "epStatus",
    "同步状态": "syncStatus", "sync_status": "syncStatus",
    "开播季度": "startSeason", "开播日期": "startDate",
    "别名": "alias", "类别": "category", "制作公司": "studio",
    "原作标签": "originalTag", "特点/印象": "impression",
    "集号": "epNum", "系列": "series", "季数": "season",
    "时长": "duration", "导演": "director", "音乐": "music",
    "制片国家": "country", "序列号": "sequence"
};
let _cachedTotalRows = 0;
// ========== 工具函数 ==========
export function parseJsonBodySummary(jsonStr) {
    if (!jsonStr)
        return "(空)";
    try {
        let obj = JSON.parse(jsonStr);
        let parts = [];
        if (obj.type !== undefined)
            parts.push("状态:" + (TYPE_TEXT_MAP[obj.type] || obj.type));
        if (obj.rate !== undefined && obj.rate > 0)
            parts.push("评分:" + obj.rate);
        if (obj.tags && obj.tags.length > 0)
            parts.push("标签:[" + obj.tags.join(",") + "]");
        if (obj.comment) {
            let comment = obj.comment.length > 30 ? obj.comment.substring(0, 30) + "..." : obj.comment;
            parts.push("评价:" + comment);
        }
        return parts.length > 0 ? parts.join(" | ") : "(仅标记状态)";
    }
    catch (e) {
        return jsonStr;
    }
}
export function isEmptyValue(val) {
    return val === null || val === undefined || val === "" ||
        val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}
function jsonEscape(s) {
    s = s.split("\\").join("\\\\");
    s = s.split('"').join('\\"');
    s = s.split("\n").join("\\n");
    s = s.split("\r").join("\\n");
    s = s.split("\t").join("\\t");
    return s;
}
// ========== 获取数据工作表 ==========
export function getDataSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook)
        return null;
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        try {
            return app.ActiveWorkbook.Worksheets.Item(BGM.sheet.lockedIndex);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, "getDataSheet 锁定工作表失败: " + e.message);
        }
    }
    return app.ActiveWorkbook.ActiveSheet;
}
export function getBgmtoken() {
    return loadBgToken();
}
export function getLastRow(ws) {
    try {
        const cell = getCell(ws, ws.Rows.Count, COLUMNS.SEQUENCE);
        if (cell?.Value2) {
            return cell.End(XL.UP).Row;
        }
    }
    catch (e) { }
    return 1000;
}
export function extractSubjectId(url) {
    if (!url)
        return "";
    for (let pattern of URL_PATTERNS) {
        let match = url.match(pattern);
        if (match)
            return match[1];
    }
    return "";
}
export function findHeaderRow(ws, startRow) {
    startRow = startRow || 1;
    for (let row = startRow; row <= 50; row++) {
        let matchCount = 0;
        for (let col = 1; col <= 50; col++) {
            try {
                let cellVal = String(getCellValue(ws, row, col)).toLowerCase();
                if (!cellVal)
                    continue;
                for (let header of HEADER_KEYWORDS) {
                    if (cellVal.indexOf(header.toLowerCase()) >= 0) {
                        matchCount++;
                        break;
                    }
                }
                if (matchCount >= 3)
                    break;
            }
            catch (e) { }
        }
        if (matchCount >= 3)
            return row;
    }
    return 0;
}
// 在文件顶部或函数外定义匹配规则数组（按优先级顺序）
const COLUMN_RULES = [
    [/bangumi.*url|bgm.*url|subject.*url|url.*bgm/i, "Bangumi_URL"],
    [/是否看完|观看状态/, "是否看完"],
    [/完播日|完播时间|看完时间/, "完播日"],
    [/开播日期|开播时间|首播/, "开播日期"],
    [/开播季度|季度|年份/, "开播季度"],
    [/打分|评分|分数|\brate\b/i, "打分"],
    [/感言|剧透|评价|评论|\bcomment\b/i, "剧透/感言"],
    [/标签|分级|\btag\b/i, "标签/分级"],
    [/特点|印象/, "特点/印象"],
    [/集号|看到|ep/i, "集号"],
    [/集数|总集/, "集数"],
    [/名称|标题|\bname\b|\btitle\b/i, "名称"],
    [/别名|原名|alias/i, "别名"],
    [/类别|分类|\btype\b/i, "类别"],
    [/原作标签|原作/, "原作标签"],
    [/制作公司|studio/i, "制作公司"],
    [/系列/, "系列"],
    [/季数/, "季数"],
    [/时长|分钟/, "时长"],
    [/导演|director/i, "导演"],
    [/音乐|music/i, "音乐"],
    [/序列号|序号|编号/, "序列号"],
    [/制片国家/, "制片国家"],
    [/语言/, "语言"]
];
/**
 * 获取列名到列号的映射（优化版：使用正则规则数组，时间复杂度 O(N*M) 但 M 较小）
 * @param ws 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列映射
 */
export function getColumnMap(ws, headerRow) {
    const colMap = new Map();
    const lastCol = 50;
    for (let i = 1; i <= lastCol; i++) {
        const colName = trim(String(getCellValue(ws, headerRow, i)));
        if (!colName)
            continue;
        // 遍历规则，找到第一个匹配的规则则跳出
        for (const [pattern, key] of COLUMN_RULES) {
            if (pattern.test(colName)) {
                colMap.set(key, i);
                break; // 一个重要列名只匹配一个规则
            }
        }
    }
    return colMap;
}
export function mapWatchStatus(status) {
    if (isEmptyValue(status))
        return 0;
    let s = trim(status);
    let result = WATCH_STATUS_MAP[s.toLowerCase()];
    if (result !== undefined)
        return result;
    if (s.indexOf("追") >= 0)
        return 2;
    if (s.indexOf("搁") >= 0 || s.indexOf("停") >= 0)
        return 4;
    if (s.indexOf("弃") >= 0)
        return 5;
    return 0;
}
export function addTagsFromStr(tagSet, raw) {
    if (raw === "")
        return;
    let seps = ["|", "、", "/", "\\", ",", ";", "｜", "，", "。"];
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
function buildTags(ws, row, colMap) {
    let tagSet = new Set();
    if (colMap.has("标签/分级")) {
        addTagsFromStr(tagSet, trim(getCellValue(ws, row, colMap.get("标签/分级"))));
    }
    if (colMap.has("特点/印象")) {
        addTagsFromStr(tagSet, trim(getCellValue(ws, row, colMap.get("特点/印象"))));
    }
    if (tagSet.size === 0)
        return "";
    let tags = [];
    for (let tag of tagSet) {
        tags.push('"' + tag + '"');
    }
    return tags.join(",");
}
export function buildJsonPayload(ws, row, colMap, finishedDate) {
    let watchStatus = "";
    if (colMap.has("是否看完")) {
        watchStatus = trim(getCellValue(ws, row, colMap.get("是否看完")));
    }
    let bgmType = mapWatchStatus(watchStatus);
    if (bgmType === 0)
        return "";
    let parts = [];
    parts.push('"type":' + bgmType);
    if (colMap.has("打分")) {
        let rateVal = getCellValue(ws, row, colMap.get("打分"));
        let rateNum = parseInt(String(rateVal), 10);
        if (!isNaN(rateNum)) {
            let rate = Math.max(0, Math.min(10, rateNum));
            if (rate >= 0)
                parts.push('"rate":' + rate);
        }
    }
    if (colMap.has("剧透/感言")) {
        let comment = trim(getCellValue(ws, row, colMap.get("剧透/感言")));
        if (comment !== "") {
            parts.push('"comment":"' + jsonEscape(comment) + '"');
        }
    }
    let tags = buildTags(ws, row, colMap);
    if (tags !== "")
        parts.push('"tags":[' + tags + ']');
    // 新增：支持私密收藏
    if (colMap.has("私密收藏")) {
        const privateVal = trim(getCellValue(ws, row, colMap.get("私密收藏"))).toLowerCase();
        if (privateVal === "是" || privateVal === "1" || privateVal === "true") {
            parts.push('"private":true');
        }
    }
    return "{" + parts.join(",") + "}";
}
export function bgmRequestSync(method, endpoint, body, token) {
    const { MAX_RETRIES, RETRY_DELAY_BASE } = BGM_CONFIG;
    let retries = 0;
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (!validMethods.includes(method.toUpperCase())) {
        return { code: 0, message: "Invalid HTTP method" };
    }
    if (!endpoint || typeof endpoint !== 'string') {
        return { code: 0, message: "Invalid endpoint" };
    }
    if (endpoint.includes('..') || endpoint.includes('//') || endpoint.startsWith('http')) {
        return { code: 0, message: "Invalid endpoint path" };
    }
    if (body && typeof body === 'string' && body.trim().startsWith('{')) {
        try {
            JSON.parse(body);
        }
        catch (e) {
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
            if (statusCode === 204)
                return { code: statusCode, message: "OK" };
            if (statusCode === 200 || statusCode === 201 || statusCode === 202)
                return { code: statusCode, message: xhr.responseText };
            if (statusCode === 429 && retries < MAX_RETRIES) {
                retries++;
                let retryDelay = RETRY_DELAY_BASE * Math.pow(2, retries - 1);
                sleep(retryDelay);
                continue;
            }
            return { code: statusCode, message: xhr.responseText || "Error" };
        }
        catch (err) {
            return { code: 0, message: "Error: " + err.message };
        }
    }
    return { code: 429, message: `超过最大重试次数(${MAX_RETRIES}次)` };
}
export async function bgmRequest(method, endpoint, body, token) {
    return bgmRequestSync(method, endpoint, body, token);
}
// ========== 异步批量同步 ==========
export async function SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options = {}) {
    const { onProgress, onItemComplete } = options; // 先解构出回调
    if (!ws || !colMap || !token || !lastRow || !headerRow)
        throw new Error('缺少必要的同步参数');
    BGM.sync.isRunning = true;
    BGM.sync.lastSyncTime = null;
    let syncRecordSheet = null;
    if (typeof window.getOrCreateSyncRecordSheet === 'function') {
        syncRecordSheet = window.getOrCreateSyncRecordSheet();
    }
    let successCount = 0, failCount = 0, skipCount = 0;
    const totalCount = lastRow - headerRow;
    const getCellStr = (row, key) => {
        if (!colMap.has(key))
            return '';
        return trim(getCellValue(ws, row, colMap.get(key)));
    };
    for (let i = headerRow + 1; i <= lastRow; i++) {
        const currentIndex = i - headerRow;
        if (onProgress)
            onProgress(currentIndex, totalCount, `正在处理第 ${i} 行...`);
        try {
            const bgmUrl = getCellStr(i, 'Bangumi_URL');
            const name = getCellStr(i, '名称');
            const itemType = getCellStr(i, '类别');
            const finishedDate = getCellStr(i, '完播日');
            if (!bgmUrl) {
                skipCount++;
                onItemComplete?.(i, false, { code: 0, message: '无 Bangumi URL' });
                continue;
            }
            const sid = extractSubjectId(bgmUrl);
            if (!sid) {
                skipCount++;
                onItemComplete?.(i, false, { code: 0, message: '无 SID' });
                continue;
            }
            const jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);
            if (!jsonBody) {
                skipCount++;
                onItemComplete?.(i, false, { code: 0, message: '状态不上传' });
                continue;
            }
            // 请求（优先 httpRequest，否则 bgmRequestSync）
            const result = await (typeof httpRequest === 'function'
                ? httpRequest(`/subject/${sid}/update`, { method: 'POST', body: jsonBody, token })
                : Promise.resolve(bgmRequestSync('POST', `/v0/users/${_getUserApiPath()}/collections/${sid}`, jsonBody, token)));
            let syncSuccess = false, statusCode = 0, errMsg = '';
            if (result instanceof Result) {
                syncSuccess = result.isOk();
                statusCode = result.data?.status || 0;
                errMsg = result.error?.message || '';
            }
            else {
                statusCode = result.code || 0;
                syncSuccess = [200, 201, 202, 204].includes(statusCode);
                errMsg = result.message || '';
            }
            const bodySummary = parseJsonBodySummary(jsonBody);
            const recordData = {
                name: name || '(无名称)',
                url: bgmUrl,
                sid,
                type: itemType,
                content: bodySummary,
                status: syncSuccess ? '成功' : '失败',
                message: syncSuccess ? `行 ${i}` : (errMsg || `HTTP ${statusCode}`),
                count: 1
            };
            if (syncSuccess) {
                successCount++;
                try {
                    const cell = getCell(ws, i, 1);
                    if (cell?.Interior)
                        cell.Interior.Color = BGM_COLOR.SUCCESS;
                }
                catch (_) { }
            }
            else {
                failCount++;
                try {
                    const cell = getCell(ws, i, 1);
                    if (cell?.Interior)
                        cell.Interior.Color = BGM_COLOR.FAIL;
                }
                catch (_) { }
            }
            if (syncRecordSheet && typeof window.addSyncRecord === 'function') {
                window.addSyncRecord(syncRecordSheet, recordData);
            }
            onItemComplete?.(i, syncSuccess, { code: statusCode, message: errMsg });
            await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY));
        }
        catch (err) {
            failCount++;
            bgmLog(LOG_LEVELS.ERROR, `同步第 ${i} 行出错: ${err.message}`);
            onItemComplete?.(i, false, { code: 0, message: err.message });
        }
    }
    BGM.sync.isRunning = false;
    // 修复：确保这里赋值的是字符串，不是数字
    BGM.sync.lastSyncTime = new Date().toISOString(); // 这返回的是字符串
    return { success: successCount, fail: failCount, skip: skipCount };
}
// ========== 筛选相关 ==========
export function getFilterStatus(endRow, getColumnCounts) {
    let app = getApp();
    if (!app)
        return null;
    let ws = getDataSheet();
    if (!ws)
        return null;
    let result = { hasFilter: false, filteredColumns: [], hiddenRows: [], visibleRows: [], filterDetails: "", columnCounts: {}, totalRows: 0, visibleCount: 0, hiddenCount: 0 };
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
                result.totalRows = filterRange.Rows.Count - 1;
                _cachedTotalRows = result.totalRows;
            }
            let filters = autoFilter.Filters;
            if (filters && filters.Count > 0) {
                let details = [];
                for (let i = 1; i <= filters.Count; i++) {
                    try {
                        let f = filters(i);
                        if (f && f.On) {
                            let colLetter = colNumToLetter(i);
                            let headerCell = ws.Range(colLetter + "1") || ws.Cells(1, i);
                            let colName = headerCell.Value2 ? String(headerCell.Value2).substring(0, 10) : "列" + i;
                            let criteria = f.Criteria1 || "";
                            if (f.Criteria2)
                                criteria += " / " + f.Criteria2;
                            if (f.Operator === 1)
                                criteria = f.Criteria1 + " 且 " + f.Criteria2;
                            details.push(colName + ": " + criteria);
                            result.filteredColumns.push({ column: i, columnName: colName, criteria });
                        }
                    }
                    catch (e) { }
                }
                result.filterDetails = details.join(" | ");
            }
        }
        let scanEndRow;
        if (endRow && endRow > 0)
            scanEndRow = endRow;
        else if (_cachedTotalRows > 0)
            scanEndRow = filterStartRow + _cachedTotalRows + 50;
        else
            scanEndRow = getLastRow(ws);
        try {
            if (filterMode && autoFilter && autoFilter.Range) {
                let filterRange = autoFilter.Range;
                let actualLastRow = getLastRow(ws);
                let filterEndRow = Math.min(filterRange.Row + filterRange.Rows.Count - 1, actualLastRow);
                try {
                    let visibleCells = ws.Range(`D${filterStartRow}:D${filterEndRow}`).SpecialCells(12);
                    if (visibleCells) {
                        try {
                            for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                                let area = visibleCells.Areas.Item(a);
                                for (let r = 1; r <= area.Rows.Count; r++) {
                                    let rowNum = area.Rows.Item(r).Row;
                                    let seqNum = parseInt(ws.Range("D" + rowNum).Value2);
                                    if (!isNaN(seqNum) && seqNum > 0)
                                        result.visibleRows.push(rowNum);
                                }
                            }
                        }
                        catch (e) { }
                    }
                }
                catch (e) { }
                let totalDataRows = 0;
                for (let i = filterStartRow; i <= filterEndRow; i++) {
                    let seqNum = parseInt(ws.Range("D" + i).Value2);
                    if (!isNaN(seqNum) && seqNum > 0)
                        totalDataRows++;
                }
                result.totalRows = totalDataRows;
                if (result.visibleRows.length > 0) {
                    let visibleSet = new Set(result.visibleRows);
                    for (let i = filterStartRow; i <= filterEndRow; i++) {
                        let seqNum = parseInt(ws.Range("D" + i).Value2);
                        if (!isNaN(seqNum) && seqNum > 0 && !visibleSet.has(i))
                            result.hiddenRows.push(i);
                    }
                }
            }
        }
        catch (e) { }
        if (result.visibleRows.length === 0 && result.hiddenRows.length === 0) {
            for (let i = filterStartRow; i <= scanEndRow; i++) {
                try {
                    let hidden = ws.Rows(i).Hidden;
                    if (hidden === true)
                        result.hiddenRows.push(i);
                    else
                        result.visibleRows.push(i);
                }
                catch (e) {
                    result.visibleRows.push(i);
                }
            }
        }
        result.visibleCount = result.visibleRows.length;
        result.hiddenCount = result.hiddenRows.length;
        if (getColumnCounts)
            result.columnCounts = getColumnValueCounts(ws, scanEndRow);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, "getFilterStatus error: " + e.message);
    }
    return result;
}
export function getColumnValueCounts(ws, endRow) {
    let counts = {};
    try {
        let autoFilter = ws.AutoFilter;
        if (autoFilter && autoFilter.Range) {
            let filterRange = autoFilter.Range;
            let colCount = filterRange.Columns.Count;
            for (let col = 1; col <= colCount; col++) {
                let valueCounts = { "(空白)": 0 };
                for (let row = 2; row <= endRow; row++) {
                    let val = ws.Cells(row, col).Value2;
                    if (val === null || val === undefined || val === "")
                        valueCounts["(空白)"]++;
                    else {
                        let key = String(val).substring(0, 50);
                        valueCounts[key] = (valueCounts[key] || 0) + 1;
                    }
                }
                if (Object.keys(valueCounts).length > 1 || valueCounts["(空白)"] !== endRow - 1)
                    counts[col] = valueCounts;
            }
        }
    }
    catch (e) { }
    return counts;
}
export function getVisibleRows() {
    let status = getFilterStatus();
    return status ? status.visibleRows : [];
}
export function getFilteredRows() {
    let status = getFilterStatus();
    return status ? status.hiddenRows : [];
}
export function getSequentialRowsBySeqCol(startRow, endRow) {
    let app = getApp();
    if (!app)
        return { validRows: [], filteredRows: [], totalFiltered: 0, hasFilter: false, visibleCount: 0, hiddenCount: 0 };
    let ws = getDataSheet();
    if (!ws)
        return { validRows: [], filteredRows: [], totalFiltered: 0, hasFilter: false, visibleCount: 0, hiddenCount: 0 };
    let filterStatus = getFilterStatus(endRow);
    let visibleRows = filterStatus ? filterStatus.visibleRows : [];
    let isFiltered = filterStatus ? filterStatus.hasFilter : false;
    let result = { validRows: [], filteredRows: [], totalFiltered: 0, hasFilter: isFiltered, visibleCount: visibleRows.length, hiddenCount: filterStatus ? filterStatus.hiddenCount : 0 };
    let seqCol = 4;
    if (isFiltered) {
        let visibleSeqMap = new Map();
        for (let row of visibleRows) {
            let seqValue = parseInt(ws.Range("D" + row).Value2);
            if (!isNaN(seqValue))
                visibleSeqMap.set(row, seqValue);
        }
        let sortedRows = Array.from(visibleSeqMap.keys()).sort((a, b) => a - b);
        if (sortedRows.length === 0)
            return result;
        result.validRows.push(sortedRows[0]);
        for (let i = 1; i < sortedRows.length; i++) {
            let prevSeq = visibleSeqMap.get(sortedRows[i - 1]);
            let currSeq = visibleSeqMap.get(sortedRows[i]);
            if (currSeq === prevSeq + 1)
                result.validRows.push(sortedRows[i]);
            else if (currSeq > prevSeq + 1) {
                let gap = currSeq - prevSeq - 1;
                result.totalFiltered += gap;
                result.filteredRows.push({ startSeq: prevSeq + 1, endSeq: currSeq - 1, count: gap, afterRow: sortedRows[i] });
                result.validRows.push(sortedRows[i]);
            }
        }
    }
    else {
        let start = startRow || 2;
        let scanEnd = endRow && endRow > 0 ? endRow : getLastRow(ws);
        for (let row = start; row <= scanEnd; row++) {
            let seq = parseInt(ws.Range("D" + row).Value2);
            if (!isNaN(seq) && seq > 0)
                result.validRows.push(row);
        }
    }
    return result;
}
export function clearRowColors() {
    let ws = getDataSheet();
    if (!ws)
        return;
    let lastRow = getLastRow(ws);
    for (let i = 2; i <= lastRow; i++) {
        try {
            let cell = getCell(ws, i, 1);
            if (cell?.Interior)
                cell.Interior.ColorIndex = -4142;
        }
        catch (e) { }
    }
    showAlert("完成", "已清除所有颜色标记");
}
export function testSingleUpdate() {
    let ws = getDataSheet();
    if (!ws) {
        showAlert("错误", "未找到数据工作表！");
        return;
    }
    let token = getBgmtoken();
    if (!token) {
        showAlert("提示", "请先设置 Token！");
        return;
    }
    let app = getApp();
    if (!app?.ActiveCell) {
        showAlert("提示", "请先选中一个单元格");
        return;
    }
    let row = app.ActiveCell.Row;
    let headerRow = findHeaderRow(ws);
    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.has("Bangumi_URL")) {
        showAlert("提示", "未找到 Bangumi URL 列");
        return;
    }
    let bgmUrl = trim(getCellValue(ws, row, colMap.get("Bangumi_URL")));
    let sid = extractSubjectId(bgmUrl);
    if (!sid) {
        showAlert("提示", "当前行没有 Bangumi URL");
        return;
    }
    let finishedDate = colMap.has("完播日") ? trim(getCellValue(ws, row, colMap.get("完播日"))) : "";
    let jsonBody = buildJsonPayload(ws, row, colMap, finishedDate);
    if (!jsonBody) {
        showAlert("提示", "当前行观看状态不上传");
        return;
    }
    let result = bgmRequestSync("POST", `/v0/users/${_getUserApiPath()}/collections/${sid}`, jsonBody, token);
    if (result.code === 204 || result.code === 200 || result.code === 201) {
        showAlert("测试成功", `条目 ${sid} 更新成功！\n\n请求体: ${parseJsonBodySummary(jsonBody)}`);
    }
    else {
        showAlert("测试失败", `条目 ${sid} 更新失败！\n\n状态码: ${result.code}\n响应: ${result.message}`);
    }
}
export function previewSubjectIdExtraction() {
    let ws = getDataSheet();
    if (!ws)
        return;
    let headerRow = findHeaderRow(ws);
    if (headerRow === 0)
        return;
    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.has("Bangumi_URL")) {
        showAlert("提示", "未找到 Bangumi URL 列");
        return;
    }
    let lastRow = getLastRow(ws);
    let previewRows = Math.min(10, lastRow - headerRow);
    let msg = `前${previewRows}行的 URL -> subject_id 提取结果：\n\n`;
    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")));
        msg += `行${i}: ${url.length > 50 ? url.substring(0, 50) + '...' : url} -> [${extractSubjectId(url)}]\n`;
    }
    showAlert("预览 URL 提取", msg);
}
export function previewJsonPayload() {
    let ws = getDataSheet();
    if (!ws)
        return;
    let headerRow = findHeaderRow(ws);
    if (headerRow === 0)
        return;
    let colMap = getColumnMap(ws, headerRow);
    let previewRows = Math.min(5, 5);
    let msg = `前${previewRows}行的请求体预览：\n\n`;
    for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
        let url = colMap.has("Bangumi_URL") ? trim(getCellValue(ws, i, colMap.get("Bangumi_URL"))) : "";
        let sid = extractSubjectId(url);
        let finishedDate = colMap.has("完播日") ? trim(getCellValue(ws, i, colMap.get("完播日"))) : "";
        let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);
        msg += `行${i} [ID:${sid}]\n${jsonBody || "(空)"}\n\n`;
    }
    showAlert("预览请求体", msg);
}
export function setBangumiToken() {
    openBangumiTokenPage();
    // 打开 Token 页面后定时检查是否已保存（用户可能已复制粘贴）
    setTimeout(() => {
        const token = loadBgToken();
        if (token)
            testTokenValidityForRibbon(token);
    }, 2000);
}
export function openBangumiTokenPage() {
    let tokenUrl = "https://next.bgm.tv/demo/access-token/create";
    let app = getApp();
    try {
        if (app?.OAAssist)
            app.OAAssist.ShellExecute(tokenUrl);
        else
            window.open(tokenUrl, "_blank");
    }
    catch (e) {
        window.open(tokenUrl, "_blank");
    }
}
export function testTokenValidityForRibbon(token) {
    if (!token)
        return;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/v0/me", false);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    try {
        xhr.send();
        if (xhr.status === 200) {
            let userData = JSON.parse(xhr.responseText);
            showAlert("Token 有效", `Token 验证成功！\n\n用户: ${userData.nickname || userData.username}\nID: ${userData.id}`);
        }
        else if (xhr.status === 401) {
            showAlert("Token 无效", "Token 验证失败！请检查 Token 是否正确。");
        }
        else {
            showAlert("验证失败", `验证失败 (${xhr.status}): ${xhr.responseText}`);
        }
    }
    catch (err) {
        showAlert("验证出错", `验证出错: ${err.message}`);
    }
}
export function openUserCollection() {
    let userId = _getBgmUserId();
    if (!userId) {
        if (typeof showUserIdDialog === 'function')
            showUserIdDialog();
        return;
    }
    window.open(`https://bgm.tv/user/${userId}/collection`, "_blank");
}
export function buildTagsArray(tagsStr) {
    if (!tagsStr)
        return [];
    let tagSet = new Set();
    addTagsFromStr(tagSet, tagsStr);
    return Array.from(tagSet).slice(0, 5);
}
