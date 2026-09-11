/**
 * 面板消息监听与事件总线订阅
 * @module ui/handlers/panel-events
 * @description 从 handlers/index.ts 抽出：window message 监听（跨文档通知）+ 事件总线处理器
 *              （Token/用户/配置变更、同步进度与状态）+ 订阅注册。
 */

import {
  BGM,
  LOG_LEVELS,
  _setBgmUserId,
  _setBgmUsername,
  bgmLog,
  showToast,
  updateSyncProgressDialog,
} from '../../index.js'
import { BGM_EVENTS } from '../../tools/events.js'
import { trackedEventBusOn } from './resource-tracking.js'
import { ACTION_HANDLERS } from './action-handlers.js'
import { updateTokenStatus, updateUserIdStatus } from './token.js'
import { isPanelContext } from './panel-context.js'
import {
  tryUpdateEnableSyncRecordUI,
  tryUpdateIncrementalCheckbox,
  tryUpdateSkipConflictsUI,
} from './incremental-bindings.js'

// ========== 消息监听 ==========
let _messageHandler: ((event: MessageEvent) => void) | null = null

export function setupMessageListener(): void {
  if (typeof window === 'undefined') {
    return
  }

  // 防止重复注册：先移除旧监听器
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler)
  }
  _messageHandler = (event: MessageEvent) => {
    // origin 白名单校验（防止跨域消息注入）
    const allowedOrigins = ['null', '', window.location.origin]
    if (!allowedOrigins.includes(event.origin)) {
      bgmLog(LOG_LEVELS.WARN, `[message] 拒绝非预期 origin: ${event.origin}`)
      return
    }
    // 用类型断言保留 unknown 注解，避免解构 any（event.data 为 any，直接解构会触发 no-unsafe-assignment）
    const { data } = event as { data: unknown }
    if (typeof data !== 'object' || data === null) return
    const message = data as {
      type?: string
      userId?: string
      username?: string
    }

    bgmLog(LOG_LEVELS.INFO, `[handlers] 收到消息: ${JSON.stringify(message)}`)

    switch (message.type) {
      case 'BGM:tokenUpdated': {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Token 更新通知')
        updateTokenStatus()
        updateUserIdStatus()
        break
      }
      case 'BGM:userIdUpdated': {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 收到用户ID更新通知: ${String(message.userId)}`)
        if (message.userId) {
          BGM.cache.userId = message.userId
          _setBgmUserId(message.userId)
          bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.userId: ${BGM.cache.userId}`)
        }
        updateUserIdStatus()
        break
      }
      case 'BGM:userInfoUpdated': {
        bgmLog(
          LOG_LEVELS.INFO,
          `[handlers] 收到用户信息更新通知: 用户名=${String(message.username)}, 用户ID=${String(message.userId)}`,
        )
        if (message.username) {
          BGM.cache.username = message.username
          _setBgmUsername(message.username)
          bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.username: ${BGM.cache.username}`)
        }
        if (message.userId) {
          BGM.cache.userId = message.userId
          _setBgmUserId(message.userId)
          bgmLog(
            LOG_LEVELS.INFO,
            `[handlers] 已更新 BGM.cache.userId 和用户ID配置: ${BGM.cache.userId}`,
          )
        }
        updateUserIdStatus()
        break
      }
      case 'tokenUpdated':
      case 'userIdUpdated': {
        // 兼容旧格式
        if (message.type === 'tokenUpdated') {
          updateTokenStatus()
        } else {
          updateUserIdStatus()
        }
        break
      }
      default: {
        // 未知消息类型：忽略
        break
      }
    }
  }
  window.addEventListener('message', _messageHandler)

  bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已注册')
}

/**
 * 移除消息监听器，防止面板关闭后内存泄漏
 */
export function removeMessageListener(): void {
  if (!_messageHandler) {
    return
  }

  window.removeEventListener('message', _messageHandler)
  _messageHandler = null
  bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已移除')
}

// ========== 事件总线处理器（模块级，便于追踪与去重） ==========

const handleTokenUpdatedEvent = (): void => {
  bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 TOKEN_UPDATED 事件')
  updateTokenStatus()
  updateUserIdStatus()
}

const handleUserIdUpdatedEvent = (): void => {
  bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_ID_UPDATED 事件')
  updateUserIdStatus()
}

const handleUsernameUpdatedEvent = (): void => {
  bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_NAME_UPDATED 事件')
  updateUserIdStatus()
}

const handleConfigUpdatedEvent = (data: { key: string; value: string }): void => {
  if (!isPanelContext()) return

  bgmLog(
    LOG_LEVELS.INFO,
    `[handlers] 收到 CONFIG_UPDATED 事件: key=${data.key}, value=${data.value}`,
  )

  switch (data.key) {
    case 'bgm_incremental_sync': {
      bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新增量同步复选框 ==========`)
      tryUpdateIncrementalCheckbox(data.value === 'true')

      break
    }
    case 'bgm_skip_conflicts': {
      bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新跳过冲突 UI ==========`)
      tryUpdateSkipConflictsUI(data.value === 'true')

      break
    }
    case 'bgm_enable_sync_record': {
      bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新启用同步记录复选框 ==========`)
      tryUpdateEnableSyncRecordUI(data.value === 'true')

      break
    }
    default: {
      // 未知配置键：忽略（与旧逻辑一致，原注释即 No default）
      break
    }
  }
}

const handleSyncProgressEvent = (data: {
  current: number
  total: number
  message: string
}): void => {
  updateSyncProgressDialog(data.current, data.total, data.message)
}

const handleSyncStateChangedEvent = (payload: { state: string; row?: number }): void => {
  bgmLog(
    LOG_LEVELS.INFO,
    `[handlers] 同步状态变更: ${payload.state}${payload.row ? `, 行: ${String(payload.row)}` : ''}`,
  )
  const syncButtons = document.querySelectorAll(
    'button[data-action="sync"], button[data-action="syncCollectionFromBgm"], button[data-action="previewSyncContent"], button[data-action="enlargePreview"]',
  )
  syncButtons.forEach((button) => {
    const element = button as HTMLButtonElement
    element.disabled = payload.state === 'running' || payload.state === 'paused'
  })
}

const handleSyncCompletedEvent = (
  results: { success?: number; fail?: number; skip?: number } | undefined,
): void => {
  bgmLog(LOG_LEVELS.INFO, `[handlers] 同步完成事件触发`)
  const stats = results ?? {}
  showToast(
    `同步完成: 成功 ${String(stats.success ?? 0)}, 失败 ${String(stats.fail ?? 0)}, 跳过 ${String(stats.skip ?? 0)}`,
    'success',
  )
}

const handleSyncErrorEvent = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  bgmLog(LOG_LEVELS.ERROR, `[handlers] 同步错误事件: ${message}`)
  showToast(`同步失败: ${message}`, 'error')
}

// ========== 事件监听（用于接收事件总线通知）==========
export function setupEventListeners(): void {
  trackedEventBusOn(BGM_EVENTS.TOKEN_UPDATED, handleTokenUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.USER_ID_UPDATED, handleUserIdUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.USER_NAME_UPDATED, handleUsernameUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.CONFIG_UPDATED, handleConfigUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_PROGRESS, handleSyncProgressEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_STATE_CHANGED, handleSyncStateChangedEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_COMPLETED, handleSyncCompletedEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_ERROR, handleSyncErrorEvent)
  // Ribbon 按钮触发数据同步：复用 panel handler，显示模块化进度弹窗
  trackedEventBusOn(BGM_EVENTS.REQUEST_GITHUB_SYNC, () => {
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Ribbon 数据同步请求，触发 syncFromGithub handler')
    const handler = ACTION_HANDLERS.syncFromGithub
    if (handler) {
      handler({ args: [], startTime: Date.now() })
    } else {
      bgmLog(LOG_LEVELS.ERROR, '[handlers] syncFromGithub handler 未注册')
    }
  })
  // Ribbon 按钮触发撤销同步：通过 eventBus 调用 panel 的 undoLastSync handler
  // 在 panel 环境中执行，可访问 undoStack 中的实际会话数据
  trackedEventBusOn(BGM_EVENTS.REQUEST_UNDO_LAST_SYNC, () => {
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Ribbon 撤销同步请求，触发 undoLastSync handler')
    const handler = ACTION_HANDLERS.undoLastSync
    if (handler) {
      handler({ args: [], startTime: Date.now() })
    } else {
      bgmLog(LOG_LEVELS.ERROR, '[handlers] undoLastSync handler 未注册')
    }
  })
}

// 尝试更新增量同步复选框（带重试机制）
