/**
 * BGM 命名空间和配置类型定义
 */

/**
 * 日志级别
 */
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 99
} as const;

export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

/**
 * BGM 配置
 */
export interface BGMConfig {
  API_BASE: string;
  REQUEST_DELAY: number;
  MAX_RETRIES: number;
  RETRY_DELAY_BASE: number;
  TOKEN_KEY: string;
}

/**
 * 缓存数据
 */
export interface BGMCache {
  totalRows: number;
  userId: string | null;
  username: string | null;
  sidCache: Map<string, string>;
  listCache: BGMCollection[];
}

/**
 * 工作表状态
 */
export interface BGMSheet {
  lockedIndex: number | null;
  lockedName: string | null;
  isLocked: boolean;
}

/**
 * 同步状态
 */
export interface BGMSync {
  isRunning: boolean;
  lastSyncTime: string | null;
}

/**
 * BGM 命名空间
 */
export interface BGMNamespace {
  // 缓存
  cache: BGMCache;
  
  // 工作表状态
  sheet: BGMSheet;
  
  // 同步状态
  sync: BGMSync;
  
  // 配置
  config: BGMConfig;
  
  // 日志级别
  LOG_LEVELS: typeof LOG_LEVELS;
  
  // 错误级别
  ERROR_LEVELS: {
    MINOR: number;
    MODERATE: number;
    SERIOUS: number;
    FATAL: number;
  };
  
  // 方法
  postMessage: (data: unknown) => boolean;
  showDialog: (title: string, message: string) => void;
  Dialog: {
    alert: (title: string, message: string) => void;
    confirm: (message: string, onConfirm?: () => void, onCancel?: () => void) => void;
    error: (title: string, message: string) => void;
    input: (title: string, prompt: string, defaultValue: string, 
            onOk?: (value: string) => void, onCancel?: () => void) => void;
    show: (type: 'alert' | 'confirm' | 'error' | 'input', 
           title: string, message: string, options?: { onConfirm?: () => void; onCancel?: () => void }) => void;
  };
  Message: {
    send: (data: unknown, targetOrigin?: string) => boolean;
  };
  User: {
    getId: () => string | null;
    setId: (id: string) => void;
  };
  Token: {
    get: () => string | null;
    set: (token: string) => void;
    clear: () => void;
  };
}

// 重新导出
export type { BGMCollection } from './bangumi';
export { BGM_SUBJECT_TYPES } from './bangumi';
