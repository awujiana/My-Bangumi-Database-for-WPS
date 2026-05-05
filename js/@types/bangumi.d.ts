/**
 * Bangumi API 相关类型定义
 */

/**
 * Bangumi 收藏条目类型
 */
export interface BGMCollection {
  sid: string;
  name: string;
  type: string | number;
  rate?: string | number;
  tags?: string[];
  comment?: string;
  lastModified?: number;
  url?: string;
  status?: string;
}

/**
 * 收藏类型映射
 */
export const BGM_SUBJECT_TYPES: Record<number, string> = {
  1: "想看",
  2: "在看",
  3: "已看",
  4: "搁置",
  5: "抛弃"
};

/**
 * 同步记录类型
 */
export interface SyncRecord {
  row?: number;
  index?: number | string;
  time?: string;
  name?: string;
  url?: string;
  sid?: string;
  type?: string | number;
  count?: number;
  content?: string;
  status?: string;
  comment?: string;
}

/**
 * API 请求结果
 */
export interface BGMRequestResult {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * 列映射
 */
export interface ColumnMap {
  name: number | null;
  subjectId: number | null;
  url: number | null;
  type: number | null;
  rate: number | null;
  tags: number | null;
  comment: number | null;
  finishedDate: number | null;
  epStatus: number | null;
  syncStatus: number | null;
}

/**
 * HTTP 请求选项
 */
export interface HttpRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  token?: string;
}

/**
 * HTTP 响应
 */
export interface HttpResponse {
  code: number;
  data?: unknown;
}

/**
 * 筛选状态
 */
export interface FilterStatus {
  isFiltered: boolean;
  filterMode: 'none' | 'autofilter' | 'advanced';
  filterColumn?: number;
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: number;
  fail: number;
  skip: number;
}

/**
 * 抓取配置
 */
export interface ScrapingConfig {
  MAX_PAGES: number;
  API_MAX_PAGES: number;
  REQUEST_DELAY: number;
  PAGE_SIZE: number;
  MAX_RETRIES: number;
  RETRY_DELAY: number;
}

/**
 * Excel 列常量
 */
export interface Columns {
  SEQUENCE: number;
  DEFAULT_START: number;
}

/**
 * 同步状态颜色
 */
export interface SyncStatusColor {
  SUCCESS: number;
  FAILURE: number;
  WARNING: number;
  INFO: number;
  SKIP: number;
}

/**
 * 同步记录列常量
 */
export interface SyncRecordColumns {
  INDEX: number;
  TIME: number;
  NAME: number;
  URL: number;
  SID: number;
  TYPE: number;
  COUNT: number;
  CONTENT: number;
  STATUS: number;
  COMMENT: number;
}
