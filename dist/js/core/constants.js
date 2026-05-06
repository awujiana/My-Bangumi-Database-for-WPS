/**
 * BGM 项目常量定义
 * @module constants
 * @description 统一定义所有常量，避免分散定义导致的不一致
 *              所有其他模块应从此模块导入常量，而非自行定义
 */

// ========== WPS Office 枚举 ==========
export const WPS_ENUM = {
    msoCTPDockPositionLeft: 0,
    msoCTPDockPositionRight: 2
};

// ========== Excel 方向常量 ==========
export const XL = {
    UP: -4162,           // xlUp - 向上查找
    DOWN: -4121,         // xlDown - 向下查找
    TO_LEFT: -4159,      // xlToLeft - 向左查找
    TO_RIGHT: -4161,     // xlToRight - 向右查找
    NONE: -4142,         // xlNone - 无填充
    CELL_TYPE_VISIBLE: 12 // xlCellTypeVisible - 可见单元格
};

// ========== BGM API 配置 ==========
export const BGM_CONFIG = {
    API_BASE: "https://api.bgm.tv",
    REQUEST_DELAY: 800,
    MAX_RETRIES: 3,
    RETRY_DELAY_BASE: 2000
};

// ========== Excel 颜色常量 ==========
export const BGM_COLOR = {
    SUCCESS: 0xCCFFCC,     // 上传成功 - 绿
    FAIL: 0xFFCCCC,        // 上传失败 - 红
    SKIP: 0xFFFFCC,        // 跳过 - 黄
    BGM_SYNC: 0x7030A0,    // 从BGM同步标记 - 紫
    LIGHT_GREEN: 0x92D050, // 已同步一次标记 - 浅绿
    DARK_GREEN: 0x00B050,  // 已同步多次标记 - 深绿
    GRAY: 0xD3D3D3,        // 表头灰色
    WHITE: 0xFFFFFF        // 白色（清除标记）
};

// ========== Token 加密配置 ==========
export const TOKEN_CONFIG = {
    // AES 密钥（32字节 = 256位）
    KEY_BYTES: [
        0x42, 0x47, 0x4D, 0x5F, 0x54, 0x4F, 0x4B, 0x45,
        0x4E, 0x5F, 0x53, 0x45, 0x43, 0x55, 0x52, 0x45,
        0x5F, 0x4B, 0x45, 0x59, 0x5F, 0x32, 0x30, 0x32,
        0x34, 0x5F, 0x41, 0x45, 0x53, 0x5F, 0x32, 0x35
    ],
    VERSION: "BGM2:",
    // 备用 XOR 密钥（当 Web Crypto 不可用时使用）
    FALLBACK_KEYS: [0x5A, 0xA5, 0x7F, 0xF2, 0x3C, 0xC3, 0x1E, 0xE1]
};

// ========== 日志级别 ==========
export const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

// ========== 错误级别 ==========
export const ERROR_LEVELS = {
    SILENT: 0,    // 静默处理
    WARN: 1,      // 警告
    ERROR: 2,     // 错误
    THROW: 3      // 抛出异常
};
