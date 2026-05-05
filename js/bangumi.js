/**
 * Bangumi API 同步模块
 * 功能：从 Excel 读取条目并批量同步到 Bangumi 收藏
 * 
 * @module bangumi
 * @requires util.js (BGM_CONFIG, BGM命名空间, XL常量, BGM.handleError)
 * 
 * 通信：使用 BGM.postMessage() 和 BGM.showDialog() 与 taskpane 通信
 * 
 * @example
 * // 同步收藏
 * SyncToBangumi();
 */

// ========== 向后兼容的别名（已迁移到 util.js 的 BGM 命名空间）==========
/**
 * @deprecated 使用 BGM.postMessage() 替代
 */
function sendToTaskpane(data) {
    return BGM.postMessage(data);
}

/**
 * @deprecated 使用 BGM.showDialog() 替代
 */
function showDialog(title, message) {
    BGM.showDialog(title, message);
}

// ========== 工具函数 ==========
/**
 * 解析 JSON 请求体为可读描述
 * @param {string} jsonStr - JSON 字符串
 * @returns {string} 可读描述
 */
function parseJsonBodySummary(jsonStr) {
    if (!jsonStr) return "(空)";
    try {
        let obj = JSON.parse(jsonStr);
        let parts = [];
        let typeMap = {1:"想看", 2:"在看", 3:"看过", 4:"搁置", 5:"抛弃"};
        if (obj.type !== undefined) parts.push("状态:" + (typeMap[obj.type] || obj.type));
        if (obj.rate !== undefined && obj.rate > 0) parts.push("评分:" + obj.rate);
        if (obj.tags && obj.tags.length > 0) parts.push("标签:[" + obj.tags.join(",") + "]");
        if (obj.comment) {
            let comment = obj.comment.length > 30 ? obj.comment.substring(0, 30) + "..." : obj.comment;
            parts.push("评价:" + comment);
        }
        return parts.length > 0 ? parts.join(" | ") : "(仅标记状态)";
    } catch (e) {
        return jsonStr;
    }
}

// ========== 获取数据工作表 ==========
/**
 * 获取数据工作表（优先使用锁定的工作表）
 * @returns {object|null} 工作表对象
 */
function getDataSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        return null;
    }

    // 优先使用锁定的工作表
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        try {
            return app.ActiveWorkbook.Worksheets(BGM.sheet.lockedIndex);
        } catch (e) {}
    }

    return app.ActiveWorkbook.ActiveSheet;
}

/**
 * 获取 Bangumi Token
 * @returns {string|null} Token
 */
function getBgmtoken() {
    return loadBgToken();
}

// ========== 获取D列最后一行 ==========
/**
 * 获取 D 列最后一行
 * @param {object} ws - 工作表对象
 * @returns {number} 最后一行行号
 */
function getLastRow(ws) {
    const SEQ_COL = 4; // D列（第4列）
    
    try {
        let cell = getCell(ws, ws.Rows.Count, SEQ_COL);
        if (cell && cell.Value) {
            return cell.End(XL.UP).Row;
        }
    } catch (e) {}
    
    return 1000; // 默认值
}

// ========== 主入口：批量同步 ==========
/**
 * 批量同步 Excel 数据到 Bangumi
 * @description 从 Excel 工作表读取条目信息，批量更新到 Bangumi 收藏
 * @requires getDataSheet, getBgmtoken, findHeaderRow, getColumnMap, getLastRow
 * @uses BGM.sync, BGM.cache
 * @see previewSyncContent
 */
function SyncToBangumi() {
    let app = getApp();
    if (!app) {
        showDialog("错误", "无法获取 WPS Application 对象！");
        return;
    }
    let ws = getDataSheet();
    if (!ws) {
        showDialog("提示", "未找到数据工作表！请在工作表选择器中选择一个工作表。");
        return;
    }

    // 检查Token
    let token = getBgmtoken();
    if (!token) {
        showDialog("提示", "未设置 Bangumi Token，无法同步！");
        return;
    }

    // 查找表头行
    let headerRow = findHeaderRow(ws);
    if (headerRow === 0) {
        showDialog("提示", "未找到表头行！请确保工作表第一行包含列名。");
        return;
    }

    // 获取列映射
    let colMap = getColumnMap(ws, headerRow);
    if (!colMap.subjectId && !colMap.url) {
        showDialog("提示", "未找到【条目ID】或【Bangumi URL】列！请检查表头名称。");
        return;
    }

    // 获取结束行
    let lastRow = getLastRow(ws);
    if (lastRow <= headerRow) {
        showDialog("提示", "没有可同步的数据！");
        return;
    }

    // 提示确认
    let dataCount = lastRow - headerRow;
    let confirmMsg = "即将同步第 " + (headerRow + 1) + " 到 " + lastRow + " 行，共 " + dataCount + " 条数据。\n\n是否继续？";
    
    if (!confirm(confirmMsg)) {
        return;
    }

    // 设置同步状态
    BGM.sync.isRunning = true;
    BGM.sync.lastSyncTime = null;

    // 获取或创建同步记录工作表
    let syncRecordSheet = null;
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncRecordSheet = getOrCreateSyncRecordSheet();
    }

    // 开始同步
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let totalCount = lastRow - headerRow;

    // 显示进度对话框
    showDialog("同步进度", "开始同步...\n已处理: 0 / " + totalCount);

    for (let i = headerRow + 1; i <= lastRow; i++) {
        try {
            // 获取 SID
            let sidVal = getCellValue(ws, i, colMap.subjectId);
            let sid = sidVal;
            
            // 如果没有 SID，尝试从 URL 提取
            if (!sid && colMap.url) {
                let urlVal = getCellValue(ws, i, colMap.url);
                sid = extractSubjectId(urlVal);
            }

            if (!sid) {
                // 标记跳过
                if (colMap.syncStatus) {
                    getCell(ws, i, colMap.syncStatus).Value = "跳过(无SID)";
                    getCell(ws, i, colMap.syncStatus).Interior.ColorIndex = XL.NONE;
                }
                skipCount++;
                continue;
            }

            // 构建请求体
            let jsonBody = buildJsonPayload(ws, i, colMap);
            
            // 发送请求
            let result = bgmRequestSync("POST", "/subject/" + sid + "/update", jsonBody, token);
            
            if (result.code === 204 || result.code === 200 || result.code === 201) {
                successCount++;
                
                // 标记成功
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "成功";
                    cell.Interior.ColorIndex = 10; // 绿色
                }

                // 写入同步记录
                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: colMap.url ? getCellValue(ws, i, colMap.url) : "",
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "成功"
                    });
                }
            } else {
                failCount++;
                
                // 标记失败
                if (colMap.syncStatus) {
                    let cell = getCell(ws, i, colMap.syncStatus);
                    cell.Value = "失败:" + result.code;
                    cell.Interior.ColorIndex = 3; // 红色
                }

                // 写入失败记录
                if (syncRecordSheet && typeof addSyncRecord === 'function') {
                    addSyncRecord(syncRecordSheet, {
                        name: getCellValue(ws, i, colMap.name) || "",
                        url: colMap.url ? getCellValue(ws, i, colMap.url) : "",
                        sid: sid,
                        type: getCellValue(ws, i, colMap.type) || "1",
                        count: 1,
                        content: parseJsonBodySummary(jsonBody),
                        status: "失败:" + result.code
                    });
                }
            }

            // 延迟避免限流
            sleep(BGM_CONFIG.REQUEST_DELAY);

            // 更新进度
            if (i % 10 === 0) {
                let progress = Math.round((i - headerRow) / dataCount * 100);
                // showDialog("同步进度", "已处理: " + (i - headerRow) + " / " + dataCount + "\n成功率: " + Math.round(successCount / (i - headerRow) * 100) + "%");
            }
        } catch (err) {
            failCount++;
            bgmLog(BGM.LOG_LEVELS.ERROR, "同步第 " + i + " 行出错: " + err.message);
            
            if (colMap.syncStatus) {
                let cell = getCell(ws, i, colMap.syncStatus);
                cell.Value = "错误:" + err.message;
                cell.Interior.ColorIndex = 3;
            }
        }
    }

    // 完成
    BGM.sync.isRunning = false;
    BGM.sync.lastSyncTime = new Date().toISOString();

    let summary = "同步完成！\n\n成功: " + successCount + "\n失败: " + failCount + "\n跳过: " + skipCount + "\n总计: " + totalCount;
    showDialog("同步完成", summary);
    
    return { success: successCount, fail: failCount, skip: skipCount };
}

// ========== URL 解析 ==========
/**
 * 从 Bangumi URL 提取 subject_id
 * @param {string} url - Bangumi URL
 * @returns {string|null} subject_id
 */
function extractSubjectId(url) {
    if (!url) return null;
    
    // 支持多种 URL 格式
    let patterns = [
        /bgm\.tv\/subject\/(\d+)/i,
        /bangumi\.tv\/subject\/(\d+)/i,
        /chii\.in\/subject\/(\d+)/i,
        /(\d{6,})/  // 纯数字（至少6位）
    ];

    for (let pattern of patterns) {
        let match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }

    return null;
}

// ========== 表头识别 ==========
/**
 * 查找表头行
 * @param {object} ws - 工作表对象
 * @param {number} startRow - 开始行号
 * @returns {number} 表头行号，未找到返回 0
 */
function findHeaderRow(ws, startRow) {
    startRow = startRow || 1;
    
    // 常见表头关键词
    let keywords = ["条目id", "bangumi url", "url", "sid", "名称", "name", "状态", "status", "评分", "rate"];
    
    for (let row = startRow; row <= Math.min(startRow + 5, 10); row++) {
        try {
            let cell = ws.Cells(row, 1);
            if (!cell || !cell.Value) continue;
            
            let cellText = String(cell.Value).toLowerCase();
            
            // 检查是否包含关键词
            for (let keyword of keywords) {
                if (cellText.includes(keyword)) {
                    return row;
                }
            }
        } catch (e) {}
    }
    
    // 默认返回第一行
    return startRow;
}

// ========== 列映射 ==========
/**
 * 获取列名到列号的映射
 * @param {object} ws - 工作表对象
 * @param {number} headerRow - 表头行号
 * @returns {object} 列映射对象
 */
function getColumnMap(ws, headerRow) {
    let colMap = {
        name: null,
        subjectId: null,
        url: null,
        type: null,
        rate: null,
        tags: null,
        comment: null,
        finishedDate: null,
        epStatus: null,
        syncStatus: null
    };

    // 列名到字段的映射
    let fieldMap = {
        // 名称
        "名称": "name", "name": "name", "作品名": "name", "条目": "name", "标题": "name",
        // 条目ID
        "条目id": "subjectId", "条目id": "subjectId", "sid": "subjectId", "subject_id": "subjectId", "id": "subjectId",
        // URL
        "bangumi url": "url", "url": "url", "链接": "url", "地址": "url",
        // 状态
        "状态": "type", "type": "type", "观看状态": "type", "收藏类型": "type",
        // 评分
        "评分": "rate", "rate": "rate", "分数": "rate", "rating": "rate",
        // 标签
        "标签": "tags", "tags": "tags", "tag": "tags",
        // 评价
        "评价": "comment", "comment": "comment", "备注": "comment", "notes": "comment",
        // 看完日期
        "看完日期": "finishedDate", "finished": "finishedDate", "日期": "finishedDate",
        // 章节状态
        "章节状态": "epStatus", "ep_status": "epStatus", "集数": "epStatus",
        // 同步状态（用于标记）
        "同步状态": "syncStatus", "sync_status": "syncStatus"
    };

    // 扫描表头行
    try {
        let lastCol = ws.Cells(headerRow, ws.Columns.Count).End(XL.TO_LEFT).Column;
        
        for (let col = 1; col <= lastCol; col++) {
            let cellValue = getCellValue(ws, headerRow, col);
            if (!cellValue) continue;
            
            let normalized = String(cellValue).toLowerCase().trim();
            
            // 精确匹配
            if (fieldMap[normalized]) {
                colMap[fieldMap[normalized]] = col;
                continue;
            }
            
            // 模糊匹配
            for (let [key, field] of Object.entries(fieldMap)) {
                if (normalized.includes(key) || key.includes(normalized)) {
                    if (!colMap[field]) {
                        colMap[field] = col;
                    }
                }
            }
        }
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "获取列映射失败: " + e.message);
    }

    return colMap;
}

// ========== 构建 JSON 请求体 ==========
/**
 * 构建 Bangumi API 请求体
 * @param {object} ws - 工作表对象
 * @param {number} row - 行号
 * @param {object} colMap - 列映射
 * @param {string} finishedDate - 看完日期
 * @returns {string} JSON 字符串
 */
function buildJsonPayload(ws, row, colMap, finishedDate) {
    let payload = {};

    // 状态
    if (colMap.type) {
        let statusVal = getCellValue(ws, row, colMap.type);
        let mappedType = mapWatchStatus(statusVal);
        if (mappedType !== null) {
            payload.type = mappedType;
        }
    }

    // 评分
    if (colMap.rate) {
        let rateVal = getCellValue(ws, row, colMap.rate);
        let rate = Math.max(0, Math.min(10, parseInt(rateVal)));
        if (rate > 0) {
            payload.rate = rate;
        }
    }

    // 标签
    if (colMap.tags) {
        let tagsVal = getCellValue(ws, row, colMap.tags);
        let tags = buildTagsArray(tagsVal);
        if (tags.length > 0) {
            payload.tags = tags;
        }
    }

    // 评价
    if (colMap.comment) {
        let commentVal = getCellValue(ws, row, colMap.comment);
        if (commentVal && !isEmptyValue(commentVal)) {
            payload.comment = String(commentVal);
        }
    }

    // 看完日期
    if (finishedDate) {
        payload.finished = finishedDate;
    } else if (colMap.finishedDate) {
        let dateVal = getCellValue(ws, row, colMap.finishedDate);
        if (dateVal) {
            payload.finished = dateVal;
        }
    }

    return JSON.stringify(payload);
}

/**
 * 检查是否为空值
 * @param {*} val - 值
 * @returns {boolean} 是否为空
 */
function isEmptyValue(val) {
    return val === null || val === undefined || val === "" || 
           val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}

/**
 * 映射观看状态
 * @param {string} status - 状态文本
 * @returns {number|null} 状态码
 */
function mapWatchStatus(status) {
    if (!status) return null;
    
    let s = String(status).toLowerCase().trim();
    
    // 文本到状态码映射
    let statusMap = {
        // 看过 / 已看
        "看过": 3, "看完": 3, "已看": 3, "completed": 3, "3": 3,
        // 在看 / 看动画中
        "在看": 2, "在看动画": 2, "watching": 2, "2": 2,
        // 想看 / 想看动画
        "想看": 1, "想看动画": 1, "wish": 1, "1": 1,
        // 搁置
        "搁置": 4, "on_hold": 4, "4": 4,
        // 抛弃
        "抛弃": 5, "drop": 5, "dropped": 5, "5": 5
    };

    return statusMap[s] !== undefined ? statusMap[s] : null;
}

/**
 * 构建标签数组
 * @param {string} tagsStr - 标签字符串
 * @returns {Array} 标签数组
 */
function buildTagsArray(tagsStr) {
    if (!tagsStr) return [];
    
    let tags = [];
    let parts = String(tagsStr).split(/[,，;；、\s]+/);
    
    for (let part of parts) {
        part = part.trim();
        if (part && part.length > 0 && part.length <= 20) {
            tags.push(part);
        }
    }
    
    return tags.slice(0, 5); // 限制最多5个标签
}

// ========== BGM API 请求 ==========
/**
 * 发送 BGM API 请求
 * @param {string} method - HTTP 方法
 * @param {string} endpoint - API 端点
 * @param {string} body - 请求体
 * @param {string} token - 认证令牌
 * @returns {Promise<{code: number, message: string}>} 响应结果
 */
async function bgmRequest(method, endpoint, body, token) {
    // 异步包装 bgmRequestSync，保持向后兼容
    return bgmRequestSync(method, endpoint, body, token);
}

/**
 * 同步发送 BGM API 请求（含 429 自动重试）
 * @param {string} method - HTTP 方法
 * @param {string} endpoint - API 端点
 * @param {string} body - 请求体
 * @param {string} token - 认证令牌
 * @returns {{code: number, message: string}} 响应结果
 */
function bgmRequestSync(method, endpoint, body, token) {
    const { MAX_RETRIES, RETRY_DELAY_BASE } = BGM_CONFIG;
    let retries = 0;
    
    while (retries <= MAX_RETRIES) {
        let xhr = new XMLHttpRequest();
        xhr.open(method, BGM_CONFIG.API_BASE + endpoint, false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");

        try {
            xhr.send(body);
            let statusCode = xhr.status;
            let responseText = xhr.responseText;
            
            // 204 No Content 不返回 body
            if (statusCode === 204) {
                return { code: statusCode, message: "OK" };
            }
            // 其他成功状态码都返回响应内容
            if (statusCode === 200 || statusCode === 201 || statusCode === 202) {
                return { code: statusCode, message: responseText };
            }
            // 429 Too Many Requests - 自动重试
            if (statusCode === 429 && retries < MAX_RETRIES) {
                retries++;
                let retryDelay = RETRY_DELAY_BASE * Math.pow(2, retries - 1); // 指数退避
                bgmLog(BGM.LOG_LEVELS.WARN, `API 限流(429)，第 ${retries}/${MAX_RETRIES} 次重试，等待 ${retryDelay}ms`);
                sleep(retryDelay);
                continue;
            }
            // 失败情况
            return { code: statusCode, message: responseText || "Error" };
        } catch (err) {
            return { code: 0, message: "Error: " + err.message };
        }
    }
    
    return { code: 429, message: `超过最大重试次数(${MAX_RETRIES}次)` };
}

// ========== 清除行颜色标记 ==========
/**
 * 清除所有行的颜色标记
 */
function clearRowColors() {
    let ws = getDataSheet();
    if (!ws) return;

    let lastRow = getLastRow(ws);
    let headerRow = findHeaderRow(ws);
    let colMap = getColumnMap(ws, headerRow);

    if (!colMap.syncStatus) {
        showDialog("提示", "未找到【同步状态】列");
        return;
    }

    for (let i = headerRow + 1; i <= lastRow; i++) {
        try {
            let cell = getCell(ws, i, colMap.syncStatus);
            if (cell) {
                cell.Value = "";
                if (cell.Interior) {
                    cell.Interior.ColorIndex = XL.NONE;
                }
            }
        } catch (e) {}
    }

    showDialog("完成", "已清除所有颜色标记");
}

// ========== 测试单个条目 ==========
/**
 * 测试单个条目更新
 */
function testSingleUpdate() {
    let ws = getDataSheet();
    if (!ws) {
        showDialog("错误", "未找到数据工作表！");
        return;
    }

    let token = getBgmtoken();
    if (!token) {
        showDialog("提示", "请先设置 Token！");
        return;
    }

    // 获取当前选中的行
    let app = getApp();
    if (!app || !app.ActiveCell) {
        showDialog("提示", "请先选中一个单元格");
        return;
    }

    let row = app.ActiveCell.Row;
    let headerRow = findHeaderRow(ws);
    let colMap = getColumnMap(ws, headerRow);

    if (!colMap.subjectId && !colMap.url) {
        showDialog("提示", "未找到【条目ID】或【Bangumi URL】列");
        return;
    }

    let sidVal = getCellValue(ws, row, colMap.subjectId);
    let sid = sidVal;

    if (!sid && colMap.url) {
        let urlVal = getCellValue(ws, row, colMap.url);
        sid = extractSubjectId(urlVal);
    }

    if (!sid) {
        showDialog("提示", "当前行没有条目ID或URL");
        return;
    }

    // 构建请求体
    let jsonBody = buildJsonPayload(ws, row, colMap);

    // 发送测试请求
    let result = bgmRequestSync("POST", "/subject/" + sid + "/update", jsonBody, token);

    if (result.code === 204 || result.code === 200 || result.code === 201) {
        showDialog("测试成功", "条目 " + sid + " 更新成功！\n\n请求体: " + parseJsonBodySummary(jsonBody));
    } else {
        showDialog("测试失败", "条目 " + sid + " 更新失败！\n\n状态码: " + result.code + "\n响应: " + result.message);
    }
}

// ========== 筛选状态检测 ==========
/**
 * 获取筛选状态
 * @param {number} endRow - 结束行
 * @param {function} getColumnCounts - 获取列计数的函数
 * @returns {object} 筛选状态信息
 */
function getFilterStatus(endRow, getColumnCounts) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        return { isFiltered: false, filterMode: "none" };
    }

    let ws = app.ActiveWorkbook.ActiveSheet;
    if (!ws) {
        return { isFiltered: false, filterMode: "none" };
    }

    try {
        // 检查是否有自动筛选
        if (ws.AutoFilterMode) {
            let filterRange = ws.AutoFilter.Range;
            if (filterRange) {
                // 检查是否有活动的筛选条件
                let filterColumns = ws.AutoFilter.Filters;
                if (filterColumns) {
                    for (let i = 1; i <= filterColumns.Count; i++) {
                        if (filterColumns(i).On) {
                            return {
                                isFiltered: true,
                                filterMode: "autofilter",
                                filterColumn: i
                            };
                        }
                    }
                }
            }
        }
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.WARN, "检查筛选状态失败: " + e.message);
    }

    return { isFiltered: false, filterMode: "none" };
}

// ========== 列值统计 ==========
/**
 * 获取列的唯一值计数
 * @param {object} ws - 工作表对象
 * @param {number} headerRow - 表头行号
 * @param {number} col - 列号
 * @returns {object} 值到计数的映射
 */
function getColumnValueCounts(ws, headerRow, col) {
    let counts = {};
    
    try {
        let lastRow = getLastRow(ws);
        
        for (let row = headerRow + 1; row <= lastRow; row++) {
            let value = getCellValue(ws, row, col);
            if (!value) value = "(空)";
            
            if (counts[value]) {
                counts[value]++;
            } else {
                counts[value] = 1;
            }
        }
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "获取列值统计失败: " + e.message);
    }
    
    return counts;
}

// ========== 可见行获取 ==========
/**
 * 根据序列号获取连续的有效行
 * @param {number} startRow - 开始行
 * @param {number} endRow - 结束行
 * @returns {object} 包含 validRows 和 skippedRows
 */
function getSequentialRowsBySeqCol(startRow, endRow) {
    let ws = getDataSheet();
    if (!ws) {
        return { validRows: [], skippedRows: [] };
    }

    let SEQ_COL = 4; // D列
    let validRows = [];
    let skippedRows = [];

    for (let row = startRow; row <= endRow; row++) {
        try {
            let cell = getCell(ws, row, SEQ_COL);
            if (cell && cell.Value !== null && cell.Value !== "") {
                validRows.push(row);
            } else {
                skippedRows.push(row);
            }
        } catch (e) {
            skippedRows.push(row);
        }
    }

    return { validRows: validRows, skippedRows: skippedRows };
}

// ========== Ribbon 模式函数 ==========
/**
 * 显示 Token 输入对话框（Ribbon 模式）
 * @param {string} currentToken - 当前 Token
 */
function showTokenDialog(currentToken) {
    let app = getApp();
    let message = "请输入 Bangumi Access Token：\n\n获取方式：Bangumi → 设置 → API → 创建应用\n\n已设置 Token: " + (currentToken ? "✅ 已设置（输入新值覆盖）" : "❌ 未设置");
    
    let token = wpsPrompt(message, "");
    if (token !== null && token.trim() !== "") {
        if (app) {
            storeBgToken(token.trim());
        }
        sendToTaskpane({ type: "tokenUpdated" });
        testTokenValidityForRibbon(token.trim());
    }
}

/**
 * Ribbon 模式测试 Token
 * @param {string} token - Token
 */
function testTokenValidityForRibbon(token) {
    if (!token) return;

    let xhr = new XMLHttpRequest();
    xhr.open("GET", BGM_CONFIG.API_BASE + "/user/{id}", true); // 需要先获取用户信息
    xhr.setRequestHeader("Authorization", "Bearer " + token);

    xhr.onload = function() {
        if (xhr.status === 200) {
            showDialog("Token 有效", "Token 验证通过！");
        } else {
            showDialog("Token 无效", "Token 验证失败，请检查是否正确。");
        }
    };

    xhr.onerror = function() {
        showDialog("网络错误", "无法连接到 Bangumi API，请检查网络。");
    };

    xhr.send();
}

/**
 * 打开 Bangumi Token 创建页面
 */
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

/**
 * 打开用户收藏页
 */
function openUserCollection() {
    let userId = _getBgmUserId();
    if (!userId) {
        showDialog("提示", "请先设置用户ID！");
        return;
    }
    window.open("https://bgm.tv/" + userId + "/collect", "_blank");
}

/**
 * 显示用户ID设置对话框
 */
function showUserIdDialog() {
    let currentId = _getBgmUserId() || "";
    let message = "请输入 Bangumi 用户ID：\n\n获取方式：访问你的 Bangumi 主页，URL 中的数字即为用户ID\n\n当前用户ID: " + (currentId || "(未设置)");
    
    let userId = wpsPrompt(message, currentId);
    if (userId !== null && userId.trim() !== "") {
        _setBgmUserId(userId.trim());
        showDialog("设置成功", "用户ID 已设置为: " + userId.trim());
    }
}
