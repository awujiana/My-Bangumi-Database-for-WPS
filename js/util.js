// ========== WPS 枚举定义 ==========
var WPS_Enum = {
    msoCTPDockPositionLeft: 0,
    msoCTPDockPositionRight: 2
}

// ========== WPS Excel 方向常量 ==========
const XL = {
    UP: -4162,           // xlUp - 向上查找
    DOWN: -4121,         // xlDown - 向下查找
    TO_LEFT: -4159,      // xlToLeft - 向左查找
    TO_RIGHT: -4161,     // xlToRight - 向右查找
    NONE: -4142,         // xlNone - 无填充
    CELL_TYPE_VISIBLE: 12 // xlCellTypeVisible - 可见单元格
};

// ========== BGM API 配置（统一定义，避免重复）==========
const BGM_CONFIG = {
    API_BASE: "https://api.bgm.tv",
    REQUEST_DELAY: 800,
    MAX_RETRIES: 3,
    RETRY_DELAY_BASE: 2000
};

// ========== BGM 全局命名空间（封装全局变量）==========
const BGM = {
    // 缓存数据
    cache: {
        totalRows: 0,
        userId: null,
        sidCache: new Map(),
        listCache: []
    },
    // 工作表状态
    sheet: {
        lockedIndex: null,
        lockedName: null,
        isLocked: false
    },
    // 同步状态
    sync: {
        isRunning: false,
        lastSyncTime: null
    },
    // 日志级别（0=DEBUG, 1=INFO, 2=WARN, 3=ERROR）
    LOG_LEVEL: 1,
    
    // 日志级别常量
    LOG_LEVELS: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    }
};

/**
 * 日志函数（支持日志级别控制）
 * @param {number} level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param {string} message - 日志消息
 */
function bgmLog(level, message) {
    if (level >= BGM.LOG_LEVEL) {
        const prefix = ['[DEBUG]', '[INFO]', '[WARN]', '[ERROR]'][level] || '[INFO]';
        console.log(prefix + ' ' + message);
    }
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

// ========== Token 加密（增强版：时间戳 + 多重 XOR + Base64）==========
/**
 * Token 加密方案说明：
 * 1. 使用多重 XOR 混淆，增加破解难度
 * 2. 添加时间戳，防止 Token 被永久存储后滥用
 * 3. 添加校验和，检测数据损坏
 * 4. Base64 编码存储
 */

const TOKEN_CONFIG = {
    // 多重 XOR 密钥（不同位置的字符使用不同密钥）
    KEYS: [0x5A, 0xA5, 0x7F, 0xF2],
    // Token 前缀（用于验证解密结果）
    PREFIX: "BGM1:",
    // Token 有效期（毫秒），0 表示永久
    EXPIRY_MS: 0, // 建议生产环境设置，如 30 * 24 * 60 * 60 * 1000 (30天)
    // 校验字符数
    CHECKSUM_LEN: 4
};

/**
 * 计算简单校验和
 * @param {string} str - 输入字符串
 * @returns {number} 校验和
 */
function calcChecksum(str) {
    let sum = 0;
    for (let i = 0; i < str.length; i++) {
        sum = ((sum << 5) - sum + str.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return Math.abs(sum) % 10000;
}

/**
 * 多重 XOR 加密
 * @param {string} text - 原文
 * @param {number[]} keys - 密钥数组
 * @returns {string} 加密后文本
 */
function multiXor(text, keys) {
    let result = "";
    for (let i = 0; i < text.length; i++) {
        let key = keys[i % keys.length];
        result += String.fromCharCode(text.charCodeAt(i) ^ key);
    }
    return result;
}

/**
 * 加密 Token
 * @param {string} token - 原始 Token
 * @returns {string} 加密后的 Token
 */
function encryptToken(token) {
    if (!token) return "";
    
    try {
        // 添加前缀
        let data = TOKEN_CONFIG.PREFIX + token;
        
        // 添加时间戳（如果配置了有效期）
        if (TOKEN_CONFIG.EXPIRY_MS > 0) {
            const expiry = Date.now() + TOKEN_CONFIG.EXPIRY_MS;
            data += ":" + expiry.toString(36);
        }
        
        // 添加校验和
        const checksum = calcChecksum(token);
        data += ":" + checksum.toString().padStart(TOKEN_CONFIG.CHECKSUM_LEN, '0');
        
        // 多重 XOR 加密
        let encrypted = multiXor(data, TOKEN_CONFIG.KEYS);
        
        // Base64 编码
        return btoa(encrypted);
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "Token encryption failed: " + e.message);
        return "";
    }
}

/**
 * 解密 Token
 * @param {string} encoded - 加密后的 Token
 * @returns {string|null} 原始 Token 或 null
 */
function decryptToken(encoded) {
    if (!encoded) return null;
    
    try {
        // Base64 解码
        let decoded = atob(encoded);
        
        // XOR 解密
        let decrypted = multiXor(decoded, TOKEN_CONFIG.KEYS);
        
        // 验证前缀
        if (!decrypted.startsWith(TOKEN_CONFIG.PREFIX)) {
            bgmLog(BGM.LOG_LEVELS.WARN, "Invalid token prefix");
            return null;
        }
        
        // 移除前缀
        let data = decrypted.substring(TOKEN_CONFIG.PREFIX.length);
        
        // 提取各部分
        let parts = data.split(':');
        
        // 解析 Token、过期时间、校验和
        let token, expiry, storedChecksum;
        
        if (TOKEN_CONFIG.EXPIRY_MS > 0 && parts.length >= 3) {
            token = parts[0];
            expiry = parseInt(parts[1], 36);
            storedChecksum = parts[2];
        } else {
            token = parts[0];
            storedChecksum = parts[1];
            expiry = null;
        }
        
        // 验证校验和
        const calcSum = calcChecksum(token);
        if (storedChecksum !== calcSum.toString().padStart(TOKEN_CONFIG.CHECKSUM_LEN, '0')) {
            bgmLog(BGM.LOG_LEVELS.WARN, "Token checksum mismatch");
            return null;
        }
        
        // 验证过期时间
        if (expiry && Date.now() > expiry) {
            bgmLog(BGM.LOG_LEVELS.WARN, "Token expired");
            return null;
        }
        
        return token;
    } catch (e) {
        bgmLog(BGM.LOG_LEVELS.ERROR, "Token decryption failed: " + e.message);
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
function _setBgmUserId(id) { BGM.cache.userId = id; }
function _getUserApiPath() { return BGM.cache.userId ? String(BGM.cache.userId) : "-"; }

// ========== BGM 统一消息通信模块 ==========
/**
 * 统一的 postMessage 函数
 * @param {object} data - 要发送的数据
 * @param {string} [targetOrigin] - 目标源，默认 "*"
 * @returns {boolean} 是否发送成功
 */
BGM.postMessage = function(data, targetOrigin) {
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(data, targetOrigin || "*");
            return true;
        }
    } catch (e) {
        console.log("[BGM] postMessage not available:", e.message);
    }
    return false;
};

/**
 * 统一的对话框显示函数
 * @param {string} title - 对话框标题
 * @param {string} message - 对话框内容
 */
BGM.showDialog = function(title, message) {
    if (BGM.postMessage({ type: "showDialog", title: title, message: message })) {
        return;
    }
    alert(message);
};

/**
 * 显示确认对话框
 * @param {string} title - 对话框标题
 * @param {string} message - 对话框内容
 * @param {function} onConfirm - 确认回调
 * @param {function} [onCancel] - 取消回调
 */
BGM.showConfirm = function(title, message, onConfirm, onCancel) {
    if (BGM.postMessage({ type: "showConfirm", title: title, message: message, onConfirm: true })) {
        // 通过 taskpane 处理
        window._bgmConfirmCallback = { confirm: onConfirm, cancel: onCancel };
        return;
    }
    // 兜底使用原生 confirm
    if (confirm(message)) {
        if (onConfirm) onConfirm();
    } else {
        if (onCancel) onCancel();
    }
};

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
                let text = typeof message === 'string' ? message : String(message);
                if (text.length > 80 || text.indexOf('\n') >= 0) {
                    let firstLine = text.split('\n')[0];
                    titleEl.textContent = firstLine.length > 30 ? "提示" : firstLine;
                    msgEl.textContent = text;
                } else {
                    titleEl.textContent = "提示";
                    msgEl.textContent = text;
                }
                modal.style.display = "flex";
                let bgHandler = function(e) { if (e.target === modal) { modal.style.display = "none"; modal.removeEventListener("click", bgHandler); } };
                modal.addEventListener("click", bgHandler);
                return;
            }
        } catch(e) {}
        _origAlert(message);
    };
})();

/**
 * 显示自定义提示对话框（与确认对话框风格一致）
 * @param {string} title - 标题
 * @param {string} message - 提示内容
 */
function showAlertDialog(title, message) {
    let modal = document.getElementById("alertDialog");
    let titleEl = document.getElementById("alertTitle");
    let msgEl = document.getElementById("alertMessage");
    
    if (modal && titleEl && msgEl) {
        titleEl.textContent = title || "提示";
        msgEl.textContent = message || "";
        modal.style.display = "flex";
        
        // 点击背景关闭
        let bgHandler = function(e) {
            if (e.target === modal) {
                closeAlertDialog();
                modal.removeEventListener("click", bgHandler);
            }
        };
        modal.addEventListener("click", bgHandler);
    } else {
        // 兜底
        alert(message);
    }
}

/**
 * 关闭提示对话框
 */
function closeAlertDialog() {
    let modal = document.getElementById("alertDialog");
    if (modal) {
        modal.style.display = "none";
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

// ========== 统一错误处理模块 ==========
/**
 * 错误级别枚举
 */
BGM.ErrorLevel = {
    SILENT: 0,    // 静默处理
    WARN: 1,      // 警告
    ERROR: 2,     // 错误
    THROW: 3      // 抛出异常
};

/**
 * 错误类
 * @param {string} message - 错误消息
 * @param {string} code - 错误代码
 * @param {object} details - 详细信息
 */
BGM.BgmError = function(message, code, details) {
    this.message = message;
    this.code = code || 'UNKNOWN';
    this.details = details || {};
    this.timestamp = new Date().toISOString();
};

BGM.BgmError.prototype.toString = function() {
    return `[${this.code}] ${this.message}`;
};

/**
 * 统一错误处理函数
 * @param {Error|BgmError|string} error - 错误对象或消息
 * @param {object} options - 处理选项
 * @param {number} options.level - 错误级别
 * @param {boolean} options.showDialog - 是否显示对话框
 * @param {string} options.context - 错误上下文
 * @returns {BgmError} 处理后的错误对象
 */
BGM.handleError = function(error, options) {
    const opts = Object.assign({
        level: BGM.ErrorLevel.ERROR,
        showDialog: false,
        context: ''
    }, options || {});

    // 构建错误对象
    let bgmError;
    if (error instanceof BGM.BgmError) {
        bgmError = error;
    } else if (error instanceof Error) {
        bgmError = new BGM.BgmError(error.message, 'JS_ERROR', {
            name: error.name,
            stack: error.stack
        });
    } else {
        bgmError = new BGM.BgmError(String(error), 'UNKNOWN');
    }

    // 添加上下文
    if (opts.context) {
        bgmError.context = opts.context;
    }

    // 根据级别处理
    switch (opts.level) {
        case BGM.ErrorLevel.SILENT:
            // 仅记录
            break;
        case BGM.ErrorLevel.WARN:
            bgmLog(BGM.LOG_LEVELS.WARN, bgmError.toString());
            break;
        case BGM.ErrorLevel.ERROR:
            bgmLog(BGM.LOG_LEVELS.ERROR, bgmError.toString());
            if (opts.showDialog) {
                BGM.showDialog('错误', bgmError.message);
            }
            break;
        case BGM.ErrorLevel.THROW:
            bgmLog(BGM.LOG_LEVELS.ERROR, bgmError.toString());
            throw bgmError;
    }

    return bgmError;
};

/**
 * 安全执行函数，捕获异常并统一处理
 * @param {function} fn - 要执行的函数
 * @param {string} context - 执行上下文
 * @param {object} options - 处理选项
 * @returns {*} 函数返回值或 undefined
 */
BGM.safeExecute = function(fn, context, options) {
    try {
        return fn();
    } catch (error) {
        return BGM.handleError(error, Object.assign({ context: context }, options));
    }
};
