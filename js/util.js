// ========== WPS 枚举定义 ==========
var WPS_Enum = {
    msoCTPDockPositionLeft: 0,
    msoCTPDockPositionRight: 2
}

// ========== Excel 操作工具函数 ==========

/**
 * 获取 Application 对象
 */
function getApp() {
    if (typeof window !== 'undefined' && window.Application) {
        return window.Application;
    }
    if (typeof Application !== 'undefined') {
        return Application;
    }
    return null;
}

/**
 * 列号转字母 (A, B, ..., Z, AA, AB, ...)
 */
function colNumToLetter(col) {
    let letter = "";
    while (col > 0) {
        let mod = (col - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        col = Math.floor((col - mod) / 26);
    }
    return letter;
}

/**
 * 安全获取单元格对象
 * @param {object} ws - 工作表对象
 * @param {number} row - 行号
 * @param {number} col - 列号
 * @returns {object} 单元格对象
 */
function getCell(ws, row, col) {
    try {
        if (ws && typeof ws.Range === 'function') {
            let colLetter = colNumToLetter(col);
            return ws.Range(colLetter + row);
        }
        if (ws && ws.Cells && typeof ws.Cells.Item === 'function') {
            return ws.Cells.Item(row, col);
        }
        if (ws && ws.Cells) {
            return ws.Cells(row, col);
        }
        return null;
    } catch (e) {
        console.error("getCell error:", e);
        return null;
    }
}

/**
 * 安全获取单元格值
 * @param {object} ws - 工作表对象
 * @param {number} row - 行号
 * @param {number} col - 列号
 * @returns {string} 单元格值
 */
function getCellValue(ws, row, col) {
    try {
        let cell = getCell(ws, row, col);
        if (cell && cell.Value) {
            return String(cell.Value());
        }
    } catch (e) {}
    return "";
}

/**
 * 设置单元格值
 * @param {object} ws - 工作表对象
 * @param {number} row - 行号
 * @param {number} col - 列号
 * @param {any} value - 要设置的值
 */
function setCellValue(ws, row, col, value) {
    try {
        let cell = getCell(ws, row, col);
        if (cell) {
            cell.Value = value;
            return true;
        }
    } catch (e) {
        console.error("setCellValue error:", e);
    }
    return false;
}

/**
 * 获取工作表对象
 * @param {number} sheetIndex - 工作表索引（从1开始）
 * @returns {object} 工作表对象
 */
function getSheetByIndex(sheetIndex) {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) return null;
    let sheets = app.ActiveWorkbook.Sheets;
    if (!sheets || sheets.Count === 0) return null;
    return sheets.Item(sheetIndex);
}

/**
 * 获取或创建同步记录工作表
 * @returns {object} 同步记录工作表对象
 */
function getOrCreateSyncRecordSheet() {
    let app = getApp();
    if (!app || !app.ActiveWorkbook) return null;
    
    let sheets = app.ActiveWorkbook.Sheets;
    let sheetName = "同步记录";
    
    // 查找是否已存在
    for (let i = 1; i <= sheets.Count; i++) {
        if (sheets.Item(i).Name === sheetName) {
            return sheets.Item(i);
        }
    }
    
    // 创建新工作表
    let newSheet = sheets.Add();
    newSheet.Name = sheetName;
    
    // 设置表头
    let headers = ["序号", "同步时间", "名称", "URL", "同步次数", "同步内容", "状态", "备注"];
    for (let i = 0; i < headers.length; i++) {
        setCellValue(newSheet, 1, i + 1, headers[i]);
    }
    
    // 设置表头样式
    let headerCell = getCell(newSheet, 1, 1);
    if (headerCell && headerCell.Font) {
        for (let i = 1; i <= headers.length; i++) {
            let hCell = getCell(newSheet, 1, i);
            if (hCell) {
                hCell.Font.Bold = true;
                hCell.Interior.Color = 0xD3D3D3;
            }
        }
    }
    
    return newSheet;
}

/**
 * 添加同步记录
 * @param {object} options - 同步记录选项
 * @param {string} options.name - 条目名称
 * @param {string} options.url - Bangumi URL
 * @param {string} options.sid - Subject ID
 * @param {string} options.content - 同步内容（JSON）
 * @param {string} options.status - 状态（成功/失败）
 * @param {string} options.message - 备注信息
 * @param {number} options.count - 同步次数（新增为1）
 */
function addSyncRecord(options) {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) {
            console.error("无法获取同步记录工作表");
            return false;
        }
        
        // 找到最后一行
        let lastRow = getLastRowInSheet(sheet);
        let newRow = lastRow + 1;
        
        // 生成序号
        let seqNum = newRow - 1;
        
        // 同步时间
        let now = new Date();
        let timeStr = now.getFullYear() + "-" + 
                      String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                      String(now.getDate()).padStart(2, '0') + " " + 
                      String(now.getHours()).padStart(2, '0') + ":" + 
                      String(now.getMinutes()).padStart(2, '0') + ":" + 
                      String(now.getSeconds()).padStart(2, '0');
        
        // 写入数据
        setCellValue(sheet, newRow, 1, seqNum);           // 序号
        setCellValue(sheet, newRow, 2, timeStr);          // 同步时间
        setCellValue(sheet, newRow, 3, options.name || "");      // 名称
        setCellValue(sheet, newRow, 4, options.url || "");       // URL
        setCellValue(sheet, newRow, 5, options.count || 1);     // 同步次数
        setCellValue(sheet, newRow, 6, options.content || "");  // 同步内容
        setCellValue(sheet, newRow, 7, options.status || "成功"); // 状态
        setCellValue(sheet, newRow, 8, options.message || "");   // 备注
        
        // 设置状态颜色
        let statusCell = getCell(sheet, newRow, 7);
        if (statusCell && statusCell.Interior) {
            if (options.status === "成功") {
                statusCell.Interior.Color = 0xCCFFCC; // 浅绿色
            } else if (options.status === "失败") {
                statusCell.Interior.Color = 0xFFCCCC; // 浅红色
            } else {
                statusCell.Interior.Color = 0xFFFFCC; // 浅黄色
            }
        }
        
        return true;
    } catch (e) {
        console.error("addSyncRecord error:", e);
        return false;
    }
}

/**
 * 更新同步记录
 * @param {string} url - 要更新的记录的URL
 * @param {object} updates - 要更新的字段
 */
function updateSyncRecord(url, updates) {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return false;
        
        let lastRow = getLastRowInSheet(sheet);
        
        // 查找对应的记录
        for (let row = 2; row <= lastRow; row++) {
            let recordUrl = getCellValue(sheet, row, 4); // URL列
            if (recordUrl === url) {
                // 更新同步次数
                if (updates.count !== undefined) {
                    let currentCount = parseInt(getCellValue(sheet, row, 5)) || 0;
                    setCellValue(sheet, row, 5, currentCount + updates.count);
                }
                // 更新时间
                if (updates.time) {
                    setCellValue(sheet, row, 2, updates.time);
                }
                // 更新状态
                if (updates.status) {
                    setCellValue(sheet, row, 7, updates.status);
                    let statusCell = getCell(sheet, row, 7);
                    if (statusCell && statusCell.Interior) {
                        if (updates.status === "成功") {
                            statusCell.Interior.Color = 0xCCFFCC;
                        } else if (updates.status === "失败") {
                            statusCell.Interior.Color = 0xFFCCCC;
                        }
                    }
                }
                // 更新备注
                if (updates.message) {
                    let currentMsg = getCellValue(sheet, row, 8) || "";
                    let newMsg = currentMsg ? currentMsg + "; " + updates.message : updates.message;
                    setCellValue(sheet, row, 8, newMsg);
                }
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error("updateSyncRecord error:", e);
        return false;
    }
}

/**
 * 获取同步记录工作表的最后一行
 * @param {object} sheet - 工作表对象
 * @returns {number} 最后一行行号
 */
function getLastRowInSheet(sheet) {
    try {
        let lastCell = getCell(sheet, sheet.Rows.Count, 1);
        if (lastCell) {
            let lastRow = lastCell.End(-4162).Row; // xlUp = -4162
            return lastRow > 0 ? lastRow : 1;
        }
    } catch (e) {}
    return 1;
}

/**
 * 获取同步记录列表
 * @returns {Array} 同步记录数组
 */
function getAllSyncRecords() {
    let records = [];
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return records;
        
        let lastRow = getLastRowInSheet(sheet);
        if (lastRow < 2) return records;
        
        for (let row = 2; row <= lastRow; row++) {
            let url = getCellValue(sheet, row, 4);
            if (!url) continue;
            
            records.push({
                seq: getCellValue(sheet, row, 1),
                time: getCellValue(sheet, row, 2),
                name: getCellValue(sheet, row, 3),
                url: url,
                count: getCellValue(sheet, row, 5),
                content: getCellValue(sheet, row, 6),
                status: getCellValue(sheet, row, 7),
                message: getCellValue(sheet, row, 8),
                row: row
            });
        }
    } catch (e) {
        console.error("getAllSyncRecords error:", e);
    }
    return records;
}

/**
 * 清除同步记录
 * @param {boolean} confirmIt - 是否需要确认
 */
function clearSyncRecords(confirmIt) {
    if (confirmIt !== false) {
        if (!confirm("确定要清除所有同步记录吗？")) {
            return false;
        }
    }
    
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return false;
        
        let lastRow = getLastRowInSheet(sheet);
        if (lastRow < 2) {
            alert("没有同步记录可清除");
            return true;
        }
        
        // 删除数据行（保留表头）
        let range = sheet.Range("A2:H" + lastRow);
        range.Delete();
        
        alert("已清除 " + (lastRow - 1) + " 条同步记录");
        return true;
    } catch (e) {
        console.error("clearSyncRecords error:", e);
        alert("清除同步记录失败: " + e.message);
        return false;
    }
}

/**
 * 查看同步记录（打开工作表）
 */
function openSyncRecordSheet() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) {
            alert("无法打开同步记录工作表");
            return;
        }
        sheet.Activate();
    } catch (e) {
        alert("打开同步记录工作表失败: " + e.message);
    }
}

/**
 * 格式化同步内容（JSON美化）
 * @param {string} jsonStr - JSON字符串
 * @returns {string} 美化后的JSON
 */
function formatSyncContent(jsonStr) {
    try {
        if (!jsonStr) return "";
        let obj = JSON.parse(jsonStr);
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return jsonStr;
    }
}

// ========== 辅助函数 ==========

/**
 * 通过 WPS 提供的接口执行脚本
 * @param {string} param 需要执行的脚本
 */
function shellExecuteByOAAssist(param) {
    let app = getApp();
    if (app && app.OAAssist) {
        app.OAAssist.ShellExecute(param);
    }
}

/**
 * 获取 URL 路径
 */
function GetUrlPath() {
    let app = getApp();
    let manifestPath = app ? app.PluginStorage.getItem("manifest_base_path") : null;
    if (manifestPath) {
        return manifestPath;
    }
    if (typeof window !== 'undefined' && window.location && window.location.href) {
        let currentUrl = window.location.href;
        let lastSlash = currentUrl.lastIndexOf("/");
        return currentUrl.substring(0, lastSlash);
    }
    return "";
}

/**
 * 字符串去除首尾空格
 */
function trim(str) {
    if (!str) return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}

/**
 * Sleep 函数
 */
function sleep(ms) {
    let end = Date.now() + ms;
    while (Date.now() < end) {}
}
