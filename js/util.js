// ========== WPS 枚举定义 ==========
var WPS_Enum = {
    msoCTPDockPositionLeft: 0,
    msoCTPDockPositionRight: 2
}


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
        if (!cell) {
            console.error("setCellValue - 无法获取单元格:", row, col);
            return false;
        }
        cell.Value = value;
        return true;
    } catch (e) {
        console.error("setCellValue error (行:", row, "列:", col, "):", e);
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
