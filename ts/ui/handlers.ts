/**
 * UI 事件处理模块 - re-export 入口
 * @module ui/handlers
 * @description 兼容入口：原 handlers.ts 已按职责拆分到 handlers/ 子目录，
 *              此文件仅做 re-export，保持外部 import 路径 `'./ui/handlers.js'` 不变。
 *
 * 拆分结构：
 *   - handlers/_constants.ts：共享中文常量 _T
 *   - handlers/token.ts：Token / 用户 ID 对话框、状态更新、有效性测试
 *   - handlers/sync.ts：从面板同步、从 BGM API 同步收藏标记
 *   - handlers/sheet.ts：锁定数据表清洗
 *   - handlers/index.ts：资源追踪、按钮监听、ACTION_HANDLERS、消息监听、事件总线、配置 UI 回填
 */
export * from './handlers/index.js'
