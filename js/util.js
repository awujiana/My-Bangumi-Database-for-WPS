// ========== WPS 枚举定义 ==========
var WPS_Enum = {
    msoCTPDockPositionLeft: 0,
    msoCTPDockPositionRight: 2
}

// ========== WPS Excel 方向常量 ==========
const XL_UP = -4162;      // xlUp - 向上查找
const XL_DOWN = -4121;    // xlDown - 向下查找
const XL_TO_LEFT = -4159; // xlToLeft - 向左查找
const XL_TO_RIGHT = -4161;// xlToRight - 向右查找
const XL_NONE = -4142;    // xlNone - 无填充


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

// ========== 颜色常量（Excel 标记用）==========
const BGM_COLOR = {
    SUCCESS: 0xCCFFCC,     // 上传成功 - 绿
    FAIL: 0xFFCCCC,        // 上传失败 - 红
    SKIP: 0xFFFFCC,        // 跳过 - 黄
    BGM_SYNC: 0x7030A0,    // 从BGM同步标记 - 紫
    LIGHT_GREEN: 0x92D050, // 已同步一次标记 - 浅绿
    DARK_GREEN: 0x00B050,  // 已同步多次标记 - 深绿
    GRAY: 0xD3D3D3,        // 表头灰色
    WHITE: 0xFFFFFF        // 白色（清除标记）
};

// ========== Token 加密（新版：btoa("BGM:" + XOR(token))）==========
const TOKEN_XOR_KEY = 0x5A;
const TOKEN_PREFIX = "BGM:";

function encryptToken(token) {
    if (!token) return "";
    let xorResult = "";
    for (let i = 0; i < token.length; i++) {
        let code = token.charCodeAt(i) ^ TOKEN_XOR_KEY;
        xorResult += String.fromCharCode(code);
    }
    return btoa(TOKEN_PREFIX + xorResult);
}

function decryptToken(encoded) {
    if (!encoded) return null;
    try {
        let decoded = atob(encoded);
        if (!decoded.startsWith(TOKEN_PREFIX)) return null;
        let xorResult = decoded.substring(TOKEN_PREFIX.length);
        let result = "";
        for (let i = 0; i < xorResult.length; i++) {
            let code = xorResult.charCodeAt(i) ^ TOKEN_XOR_KEY;
            result += String.fromCharCode(code);
        }
        return result;
    } catch (e) {
        return null;
    }
}

function storeBgToken(token) {
    let app = getApp();
    if (!app) return false;
    app.PluginStorage.setItem("bgm_token", encryptToken(token));
    return true;
}

function clearBgToken() {
    let app = getApp();
    if (!app) return false;
    app.PluginStorage.setItem("bgm_token", "");
    return true;
}

function loadBgToken() {
    let app = getApp();
    if (!app) return null;
    let stored = app.PluginStorage.getItem("bgm_token");
    if (!stored) return null;
    let token = decryptToken(stored);
    if (token) return token;
    // 非加密格式 → 删除无效数据
    clearBgToken();
    return null;
}

// ========== 统一日志前缀 ==========
(function() {
    const _origLog = console.log;
    const _origWarn = console.warn;
    const _origError = console.error;
    console.log = function() {
        let args = Array.prototype.slice.call(arguments);
        if (args.length > 0 && typeof args[0] === 'string' && !args[0].startsWith('[BGM]')) {
            args[0] = '[BGM] ' + args[0];
        }
        _origLog.apply(console, args);
    };
    console.warn = function() {
        let args = Array.prototype.slice.call(arguments);
        if (args.length > 0 && typeof args[0] === 'string' && !args[0].startsWith('[BGM]')) {
            args[0] = '[BGM] ' + args[0];
        }
        _origWarn.apply(console, args);
    };
    console.error = function() {
        let args = Array.prototype.slice.call(arguments);
        if (args.length > 0 && typeof args[0] === 'string' && !args[0].startsWith('[BGM]')) {
            args[0] = '[BGM] ' + args[0];
        }
        _origError.apply(console, args);
    };
})();

// ========== 缓存 Bangumi 用户 ID（通过 /v0/me 获取），用于 API 路径 ==========
let _cachedBgmUserId = null;
function _setBgmUserId(id) { _cachedBgmUserId = id; }
function _getUserApiPath() { return _cachedBgmUserId ? String(_cachedBgmUserId) : "-"; }

// ========== 自定义 Alert 对话框（替换原生 alert）==========
// 全局覆写 alert，在 taskpane 环境中使用自定义模态框
(function() {
    const _origAlert = window.alert;
    window.alert = function(message) {
        try {
            let modal = document.getElementById("alertDialog");
            if (!modal) {
                // 动态创建 Alert 模态框
                modal = document.createElement("div");
                modal.id = "alertDialog";
                modal.className = "modal";
                modal.style.display = "none";
                modal.innerHTML = `
                    <div class="modal-content confirm-modal-content" style="max-width:420px;text-align:center;padding:30px 25px;">
                        <h3 id="alertTitle" style="margin:0 0 15px 0;color:#fff;font-size:18px;"></h3>
                        <p id="alertMessage" style="margin-bottom:20px;line-height:1.6;color:#ccc;white-space:pre-wrap;word-break:break-all;"></p>
                        <div class="dialog-buttons" style="justify-content:center;">
                            <button class="btn confirm-btn confirm-yes" onclick="document.getElementById('alertDialog').style.display='none'">确定</button>
                        </div>
                    </div>`;
                document.body.appendChild(modal);
            }
            let titleEl = document.getElementById("alertTitle");
            let msgEl = document.getElementById("alertMessage");
            if (titleEl && msgEl) {
                // 如果是 "alert("text", 64)" 的 WPS 格式，忽略第二个参数
                let text = typeof message === 'string' ? message : String(message);
                // 根据消息长度和内容决定标题
                if (text.length > 80 || text.indexOf('\n') >= 0) {
                    let firstLine = text.split('\n')[0];
                    titleEl.textContent = firstLine.length > 30 ? "提示" : firstLine;
                    msgEl.textContent = text;
                } else {
                    titleEl.textContent = "提示";
                    msgEl.textContent = text;
                }
                modal.style.display = "flex";
                // 点击背景关闭
                let bgHandler = function(e) { if (e.target === modal) { modal.style.display = "none"; modal.removeEventListener("click", bgHandler); } };
                modal.addEventListener("click", bgHandler);
                return;
            }
        } catch(e) {}
        _origAlert(message);
    };
})();

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
 * 显示同步面板（由 ribbon.js 的 btnShowPanel 调用）
 */
function showBangumiPanel() {
    let app = getApp();
    if (!app) {
        alert("无法获取 WPS Application 对象！");
        return;
    }
    let tsId = app.PluginStorage.getItem("taskpane_id");
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

/**
 * 字符串去除首尾空格
 */
function trim(str) {
    if (!str) return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}

/**
 * 显示输入提示框（兼容 ribbon 和 taskpane 上下文）
 * 优先使用 WPS Application.InputBox（ribbon 上下文）
 * 回退使用浏览器 prompt（部分 WPS 版本支持）
 * @param {string} message - 提示信息
 * @param {string} defaultValue - 默认值
 * @returns {string|null} - 输入值或 null（取消）
 */
function wpsPrompt(message, defaultValue) {
    let app = getApp();
    // 尝试 WPS 原生 InputBox（ribbon 上下文）
    if (app && typeof app.InputBox === 'function') {
        try {
            let result = app.InputBox(message, "Bangumi 设置", defaultValue || "", 2);
            // InputBox 返回 false 表示取消
            if (result === false || result === null || result === undefined) {
                return null;
            }
            return String(result);
        } catch (e) {
            console.warn("WPS InputBox 不可用:", e.message);
        }
    }
    // 回退浏览器 prompt
    try {
        return prompt(message, defaultValue);
    } catch (e) {
        console.error("prompt 也不可用:", e.message);
        return null;
    }
}

/**
 * 显示 WPS 消息对话框（兼容上下文）
 * @param {string} message - 提示信息
 * @param {number} buttons - 按钮类型（0=OK, 1=OKCancel, 4=YesNo）
 * @param {number} icon - 图标类型（16=Stop, 32=Question, 48=Exclamation, 64=Information）
 * @returns {number} - 1=OK, 2=Cancel, 6=Yes, 7=No
 */
function wpsMsgBox(message, buttons, icon) {
    let app = getApp();
    if (app && typeof app.MessageBox === 'function') {
        try {
            return app.MessageBox(message, (buttons || 0) + (icon || 64));
        } catch (e) {
            console.warn("WPS MessageBox 不可用:", e.message);
        }
    }
    // 回退浏览器 confirm/alert
    if (buttons === 4) { // YesNo
        return confirm(message) ? 6 : 7;
    }
    alert(message);
    return 1;
}
function sleep(ms) {
    try {
        let app = getApp();
        // WPS 原生 Wait 方法（非忙等待，释放 CPU）
        if (app && typeof app.Wait !== 'undefined') {
            let waitTime = new Date(Date.now() + ms);
            app.Wait(waitTime);
            return;
        }
    } catch (e) {}
    // 回退忙等待
    let end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            let app = getApp();
            if (app && app.DoEvents) app.DoEvents();
        } catch(e) {}
    }
}
