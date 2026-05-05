/**
 * 类型定义入口文件
 * 导出所有类型定义
 */

// 全局类型
/// <reference path="./global.d.ts" />

// 模块类型
export * from './bangumi';
export * from './config';
export * from './util';

// 重新导出方便使用
export type {
  BGMNamespace,
  BGMConfig,
  BGMCollection,
  SyncRecord,
  ColumnMap,
  BGMRequestResult,
  FilterStatus,
  SyncResult,
  LogLevel
} from './bangumi';

export type {
  UtilFunctions,
  WPSEnum,
  XLConstants,
  BGMColor,
  MessageData,
  TokenCrypto
} from './util';
