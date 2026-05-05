// ========== 同步记录模块 ==========
// 功能：管理同步记录工作表，记录同步历史
// 依赖：util.js (BGM_CONFIG, BGM_COLOR, XL, colNumToLetter)

// ========== 向后兼容的别名（已迁移到 util.js 的 BGM 命名空间）==========
/**
 * @deprecated 使用 BGM.postMessage() 替代
 */
function sendToTaskpaneSR(data) {
    return BGM.postMessage(data);
}

/**
 * @deprecated 使用 BGM.showDialog() 替代
 */
function showDialogSR(title, message) {
    BGM.showDialog(title, message);
}

// ========== 常量定义 ==========
const BGM_SUBJECT_TYPES = {
    1: "想看",
    2: "在看",
    3: "已看",
    4: "搁置",
    5: "抛弃"
};

// ========== 表头设置 ==========
/**
 * 设置同步记录工作表的表头
 * @param {object} sheet - 工作表对象
 */
function setSyncRecordHeaders(sheet) {
    let headers = ["序号", "同步时间", "名称", "URL", "SID", "条目类型", "次数", "内容", "状态", "备注"];

    bgmLog(BGM.LOG_LEVELS.INFO, "setSyncRecordHeaders 开始 - 工作表: " + (sheet ? sheet.Name : "null"));

    for (let i = 0; i < headers.length; i++) {
        let colLetter = colNumToLetter(i + 1);
        let cellAddr = colLetter + "1";
        bgmLog(BGM.LOG_LEVELS.INFO, "设置表头 - 列: " + cellAddr + " 值: " + headers[i]);

        try {
            let cell = sheet.Range(cellAddr);
            if (cell) {
                cell.Value2 = headers[i];
                if (cell.Font) {
                    cell.Font.Bold = true;
                }
                if (cell.Interior) {
                    cell.Interior.Color = BGM_COLOR.GRAY;
                }
                bgmLog(BGM.LOG_LEVELS.INFO, "设置成功: " + cellAddr + " 当前值: " + cell.Value2);
            }
        } catch (e) {
            bgmLog(BGM.LOG_LEVELS.ERROR, "设置表头失败 - 列: " + cellAddr + " 错误: " + e.message);
        }
    }

    // 设置第二行为颜色说明
    try {
        let noteCell = sheet.Range("I2");
        if (noteCell) {
            noteCell.Value2 = "状态颜色：绿=成功 | 红=失败 | 黄=跳过 | 紫=已收藏(1次) | 浅绿=已收藏(2次) | 深绿=已收藏(3次+)";
            if (noteCell.Font) {
                noteCell.Font.Size = 9;
                noteCell.Font.Color = 0x404040;
            }
            if (noteCell.Interior) noteCell.Interior.Color = XL.NONE;
        }

        // 冻结首行
        try {
            if (sheet && sheet.Application && sheet.Application.ActiveWindow) {
                sheet.Range("A2").Select();
                sheet.Application.ActiveWindow.FreezePanes = true;
            }
        } catch (e) {
            bgmLog(BGM.LOG_LEVELS.WARN, "冻结首行失败: " + e.message);
        }
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.WARN, "设置说明行失败: " + e.message);
    }

    bgmLog(BGM.LOG_LEVELS.INFO, "setSyncRecordHeaders 完成");
}

/**
 * 检查表头是否存在
 * @param {object} sheet - 工作表对象
 * @returns {boolean} 表头是否存在
 */
function checkHeaderExists(sheet) {
    try {
        let firstCell = sheet.Range("A1");
        return firstCell && firstCell.Value === "序号";
    } catch (e) {
        return false;
    }
}

// ========== 获取或创建同步记录工作表 ==========
/**
 * 获取或创建同步记录工作表
 * @returns {object|null} 工作表对象
 */
function getOrCreateSyncRecordSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "getOrCreateSyncRecordSheet - 无法获取 ActiveWorkbook");
        return null;
    }

    let wb = app.ActiveWorkbook;
    let sheetName = "同步记录";

    // 查找是否已存在
    try {
        for (let i = 1; i <= wb.Worksheets.Count; i++) {
            if (wb.Worksheets(i).Name === sheetName) {
                bgmLog(BGM.LOG_LEVELS.INFO, "找到现有同步记录工作表");
                let sheet = wb.Worksheets(sheetName);
                
                // 检查表头
                if (!checkHeaderExists(sheet)) {
                    setSyncRecordHeaders(sheet);
                }
                
                return sheet;
            }
        }
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "查找工作表失败: " + e.message);
    }

    // 创建新工作表
    bgmLog(BGM.LOG_LEVELS.INFO, "创建新的同步记录工作表");
    try {
        let newSheet = wb.Worksheets.Add();
        newSheet.Name = sheetName;
        setSyncRecordHeaders(newSheet);
        bgmLog(BGM.LOG_LEVELS.INFO, "新工作表已创建: " + sheetName);
        return newSheet;
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "创建工作表失败: " + e.message);
        return null;
    }
}

// ========== 缓存管理 ==========
let _syncRecordSidCache = new Map();
let _syncRecordListCache = [];
let _syncRecordCacheValid = false;

/**
 * 使缓存失效
 */
function _invalidateSyncRecordCache() {
    _syncRecordCacheValid = false;
}

/**
 * 构建同步记录缓存
 * @param {object} sheet - 工作表对象
 */
function _buildSyncRecordCache(sheet) {
    if (!sheet) return;

    _syncRecordSidCache.clear();
    _syncRecordListCache = [];

    try {
        let lastRowCell = sheet.Range("A" + sheet.Rows.Count).End(XL.UP);
        let lastRow = lastRowCell.Row;

        for (let row = 2; row <= lastRow; row++) {
            try {
                let sid = sheet.Cells(row, 5).Value; // E列 SID
                let index = sheet.Cells(row, 1).Value; // A列 序号

                if (sid) {
                    _syncRecordSidCache.set(String(sid), row);
                }

                _syncRecordListCache.push({
                    row: row,
                    index: index,
                    time: sheet.Cells(row, 2).Value,
                    name: sheet.Cells(row, 3).Value,
                    url: sheet.Cells(row, 4).Value,
                    sid: sid,
                    type: sheet.Cells(row, 6).Value,
                    count: sheet.Cells(row, 7).Value,
                    content: sheet.Cells(row, 8).Value,
                    status: sheet.Cells(row, 9).Value,
                    comment: sheet.Cells(row, 10).Value
                });
            } catch (e) {}
        }

        _syncRecordCacheValid = true;
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "构建缓存失败: " + e.message);
    }
}

/**
 * 根据 SID 获取行号
 * @param {string} sid - 条目 SID
 * @returns {number|null} 行号
 */
function _getRecordRowBySid(sid) {
    if (!_syncRecordCacheValid) {
        let sheet = getOrCreateSyncRecordSheet();
        if (sheet) _buildSyncRecordCache(sheet);
    }
    return _syncRecordSidCache.get(String(sid)) || null;
}

// ========== 添加同步记录 ==========
/**
 * 添加同步记录
 * @param {object} sheet - 工作表对象
 * @param {object} record - 记录数据
 * @returns {boolean} 是否成功
 */
function addSyncRecord(sheet, record) {
    if (!sheet || !record) return false;

    // 检查是否已存在（根据 SID）
    let existingRow = _getRecordRowBySid(record.sid);

    try {
        let targetRow;

        if (existingRow) {
            // 更新现有记录
            targetRow = existingRow;
            record.count = (parseInt(sheet.Cells(targetRow, 7).Value) || 0) + 1;
        } else {
            // 添加新记录
            let lastRowCell = sheet.Range("A" + sheet.Rows.Count).End(XL.UP);
            targetRow = lastRowCell.Row + 1;
        }

        // 写入数据
        sheet.Cells(targetRow, 1).Value = existingRow ? sheet.Cells(targetRow, 1).Value : (targetRow - 1);
        sheet.Cells(targetRow, 2).Value = formatCurrentTime();
        sheet.Cells(targetRow, 3).Value = record.name || "";
        sheet.Cells(targetRow, 4).Value = record.url || "";
        sheet.Cells(targetRow, 5).Value = record.sid || "";
        sheet.Cells(targetRow, 6).Value = record.type || "1";
        sheet.Cells(targetRow, 7).Value = record.count || 1;
        sheet.Cells(targetRow, 8).Value = record.content || "";
        sheet.Cells(targetRow, 9).Value = record.status || "";
        sheet.Cells(targetRow, 10).Value = record.comment || "";

        // 设置状态颜色
        let statusCell = sheet.Cells(targetRow, 9);
        if (statusCell.Interior) {
            if (record.status && record.status.includes("成功")) {
                statusCell.Interior.ColorIndex = 10; // 绿色
            } else if (record.status && record.status.includes("失败")) {
                statusCell.Interior.ColorIndex = 3; // 红色
            } else if (record.status && record.status.includes("跳过")) {
                statusCell.Interior.ColorIndex = 6; // 黄色
            }
        }

        // 使缓存失效
        _invalidateSyncRecordCache();

        return true;
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "添加同步记录失败: " + e.message);
        return false;
    }
}

// ========== 获取所有同步记录 ==========
/**
 * 获取所有同步记录
 * @returns {Array} 记录数组
 */
function getAllSyncRecords() {
    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return [];

    // 如果缓存有效，直接返回
    if (_syncRecordCacheValid) {
        return _syncRecordListCache;
    }

    // 重新构建缓存
    _buildSyncRecordCache(sheet);
    return _syncRecordListCache;
}

// ========== 清除同步记录 ==========
/**
 * 清除所有同步记录
 * @param {boolean} confirmPrompt - 是否显示确认提示
 */
function clearSyncRecords(confirmPrompt) {
    if (confirmPrompt !== false) {
        if (!confirm("确定要清除所有同步记录吗？此操作不可撤销。")) {
            return;
        }
    }

    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return;

    try {
        // 删除数据行（保留表头）
        let lastRowCell = sheet.Range("A" + sheet.Rows.Count).End(XL.UP);
        let lastRow = lastRowCell.Row;

        if (lastRow > 1) {
            sheet.Range("A2:A" + lastRow).EntireRow.Delete();
        }

        // 重置序号
        sheet.Range("A1").Value = "序号";

        // 使缓存失效
        _invalidateSyncRecordCache();

        bgmLog(BGM.LOG_LEVELS.INFO, "同步记录已清除");
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "清除同步记录失败: " + e.message);
    }
}

/**
 * 激活同步记录工作表
 */
function activateSyncRecordSheet() {
    let sheet = getOrCreateSyncRecordSheet();
    if (sheet) {
        try {
            sheet.Activate();
        } catch (e) {
            bgmLog(BGM.LOG_LEVELS.ERROR, "激活同步记录表失败: " + e.message);
        }
    }
}

/**
 * 打开同步记录工作表
 */
function openSyncRecordSheet() {
    let sheet = getOrCreateSyncRecordSheet();
    if (sheet) {
        try {
            sheet.Activate();
            sheet.Application.ActiveWindow.FreezePanes = false;
            sheet.Range("A2").Select();
            sheet.Application.ActiveWindow.FreezePanes = true;
        } catch (e) {
            bgmLog(BGM.LOG_LEVELS.ERROR, "打开同步记录表失败: " + e.message);
        }
    }
}

// ========== 获取并记录收藏 ==========
/**
 * 获取并记录 Bangumi 收藏
 * @param {string} token - Token
 * @param {string} userId - 用户ID
 * @param {Array} collections - 收藏数据
 */
function fetchAndRecordBgCollections(token, userId, collections) {
    if (!collections || collections.length === 0) {
        bgmLog(BGM.LOG_LEVELS.WARN, "没有收藏数据需要记录");
        return;
    }

    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return;

    bgmLog(BGM.LOG_LEVELS.INFO, "开始记录 " + collections.length + " 条收藏");

    let recordCount = 0;
    collections.forEach(item => {
        let record = {
            name: item.name || "",
            url: "https://bgm.tv/subject/" + item.sid,
            sid: String(item.sid),
            type: String(item.type || 3),
            count: 1,
            content: item.comment || (item.rate ? "评分: " + item.rate : ""),
            status: "已收藏"
        };

        if (addSyncRecord(sheet, record)) {
            recordCount++;
        }
    });

    bgmLog(BGM.LOG_LEVELS.INFO, "记录完成，共添加 " + recordCount + " 条");
}

/**
 * 获取指定类型的收藏
 * @param {string} token - Token
 * @param {string} userId - 用户ID
 * @param {string} type - 收藏类型 (1=想看, 2=在看, 3=已看)
 * @param {function} callback - 回调函数
 */
function fetchCollectionsByType(token, userId, type, callback) {
    let xhr = new XMLHttpRequest();
    let url = BGM_CONFIG.API_BASE + "/user/" + userId + "/collection?type=" + type + "&limit=30";

    xhr.open("GET", url, true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                let data = JSON.parse(xhr.responseText);
                if (callback) callback(data.data || []);
            } catch (e) {
                bgmLog(BGM.LOG_LEVELS.ERROR, "解析收藏数据失败: " + e.message);
                if (callback) callback([]);
            }
        } else {
            bgmLog(BGM.LOG_LEVELS.ERROR, "获取收藏失败，状态码: " + xhr.status);
            if (callback) callback([]);
        }
    };

    xhr.onerror = function() {
        bgmLog(BGM.LOG_LEVELS.ERROR, "网络请求失败");
        if (callback) callback([]);
    };

    xhr.send();
}

/**
 * 格式化当前时间
 * @returns {string} 格式化的时间字符串
 */
function formatCurrentTime() {
    let now = new Date();
    let year = now.getFullYear();
    let month = String(now.getMonth() + 1).padStart(2, "0");
    let day = String(now.getDate()).padStart(2, "0");
    let hour = String(now.getHours()).padStart(2, "0");
    let minute = String(now.getMinutes()).padStart(2, "0");
    let second = String(now.getSeconds()).padStart(2, "0");
    return year + "-" + month + "-" + day + " " + hour + ":" + minute + ":" + second;
}

// ========== 标记已上传条目 ==========
/**
 * 标记已上传条目到工作表
 * @param {number} sheetIndex - 工作表索引
 * @param {Array} collections - 收藏数据
 */
function markUploadedItemsInSheet(sheetIndex, collections) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "无法获取 ActiveWorkbook");
        return;
    }

    let ws = app.ActiveWorkbook.Worksheets(sheetIndex);
    if (!ws) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "无法获取工作表");
        return;
    }

    // 构建 SID 集合
    let sidSet = new Set();
    collections.forEach(item => {
        sidSet.add(String(item.sid));
    });

    bgmLog(BGM.LOG_LEVELS.INFO, "开始标记 " + sidSet.size + " 个条目");

    // 查找 D 列（条目 ID 列）
    let headerRow = 1;
    let sidCol = 0;
    let nameCol = 0;

    try {
        let lastCol = ws.Range("A" + headerRow).End(XL.TO_RIGHT).Column;
        let lastRow = ws.Range("A" + ws.Rows.Count).End(XL.UP).Row;

        // 查找相关列
        for (let col = 1; col <= lastCol; col++) {
            let header = String(ws.Cells(headerRow, col).Value || "").toLowerCase();
            if (header.includes("条目id") || header === "sid" || header === "id") {
                sidCol = col;
            }
            if (header.includes("名称") || header === "name") {
                nameCol = col;
            }
        }

        if (sidCol === 0) {
            bgmLog(BGM.LOG_LEVELS.WARN, "未找到条目 ID 列");
            return;
        }

        // 标记匹配的行
        let markedCount = 0;
        for (let row = headerRow + 1; row <= lastRow; row++) {
            try {
                let sid = String(ws.Cells(row, sidCol).Value || "").trim();
                if (sidSet.has(sid)) {
                    // 找到匹配的条目，标记 D 列为 "已收藏"
                    let cell = ws.Cells(row, 4); // D 列
                    if (cell) {
                        cell.Value = "已收藏";
                        cell.Interior.ColorIndex = 40; // 紫色
                        markedCount++;
                    }
                }
            } catch (e) {}
        }

        bgmLog(BGM.LOG_LEVELS.INFO, "标记完成，共标记 " + markedCount + " 个条目");
        showDialog("标记完成", "已在 D 列标记 " + markedCount + " 个已收藏条目");
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "标记条目失败: " + e.message);
    }
}

/**
 * 清除工作表标记
 * @param {number} sheetIndex - 工作表索引
 */
function clearSheetMarksInSheet(sheetIndex) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) return;

    let ws = app.ActiveWorkbook.Worksheets(sheetIndex);
    if (!ws) return;

    try {
        let lastRow = ws.Range("A" + ws.Rows.Count).End(XL.UP).Row;
        
        // 清除 D 列的标记
        for (let row = 2; row <= lastRow; row++) {
            try {
                let cell = ws.Cells(row, 4);
                if (cell) {
                    cell.Value = "";
                    if (cell.Interior) {
                        cell.Interior.ColorIndex = XL.NONE;
                    }
                }
            } catch (e) {}
        }

        showDialog("完成", "已清除所有标记");
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "清除标记失败: " + e.message);
    }
}
