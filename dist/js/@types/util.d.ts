/**
 * 工具函数类型定义
 */

/**
 * WPS Excel 枚举值
 */
export interface WPSEnum {
  UP: number;
  DOWN: number;
  LEFT: number;
  RIGHT: number;
}

/**
 * Excel 常量
 */
export interface XLConstants {
  UP: number;
  DOWN: number;
  LEFT: number;
  RIGHT: number;
  NONE: number;
}

/**
 * BGM 颜色常量
 */
export interface BGMColor {
  GRAY: number;
  WHITE: number;
  BLACK: number;
  RED: number;
  GREEN: number;
  BLUE: number;
  YELLOW: number;
  ORANGE: number;
  PURPLE: number;
}

/**
 * 消息数据
 */
export interface MessageData {
  type: string;
  [key: string]: unknown;
}

/**
 * Token 加密接口
 */
export interface TokenCrypto {
  encrypt: (token: string) => Promise<string>;
  decrypt: (encrypted: string) => Promise<string>;
}

/**
 * 工具函数接口
 */
export interface UtilFunctions {
  // Excel 操作
  getApp: () => unknown;
  getCell: (ws: unknown, row: number, col: number) => unknown;
  getCellValue: (ws: unknown, row: number, col: number) => string | null;
  setCellValue: (ws: unknown, row: number, col: number, value: unknown) => void;
  
  // Token 管理
  loadBgToken: () => string | null;
  storeBgToken: (token: string) => void;
  clearBgToken: () => void;
  
  // 用户 ID
  _getBgmUserId: () => string | null;
  _setBgmUserId: (id: string) => void;
  
  // 工具
  sleep: (ms: number) => void;
  bgmLog: (level: number, message: string) => void;
  colNumToLetter: (col: number) => string;
  
  // HTML 转义
  escapeHtml: (text: string) => string;
}
