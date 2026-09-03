/**
 * UI 事件处理模块 - 共享中文常量
 * @module ui/handlers/_constants
 * @description handlers 子模块共用的中文文案常量，避免重复定义。
 */

// ========== 中文常量 ==========
export const _T = {
  setBgmToken: '\u{8BBE}\u{7F6E} Bangumi Access Token',
  inputToken: '\u{8BF7}\u{8F93}\u{5165} Access Token',
  tokenSaved: 'Token \u{5DF2}\u{4FDD}\u{5B58}',
  setBgmUserId: '\u{8BBE}\u{7F6E} Bangumi \u{7528}\u{6237}ID',
  inputUserId: '\u{8BF7}\u{8F93}\u{5165}\u{7528}\u{6237}ID\u{FF08}\u{6570}\u{5B57}\u{FF09}',
  userIdSaved: '\u{7528}\u{6237}ID \u{5DF2}\u{4FDD}\u{5B58}',
  set: '\u{5DF2}\u{8BBE}\u{7F6E}',
  notSet: '\u{672A}\u{8BBE}\u{7F6E}',
  pleaseSetUserIdFirst: '\u{8BF7}\u{5148}\u{8BBE}\u{7F6E}\u{7528}\u{6237}ID',
  pleaseSetTokenFirst: '\u{8BF7}\u{5148}\u{8BBE}\u{7F6E} Token',
  tokenValid: 'Token \u{6709}\u{6548}',
  user: '\u{7528}\u{6237}: ',
  unknownUser: '\u{672A}\u{77E5}\u{7528}\u{6237}',
  parseFailed: '\u{89E3}\u{6790}\u{5931}\u{8D25}',
  cannotParseResponse: '\u{65E0}\u{6CD5}\u{89E3}\u{6790}\u{54CD}\u{5E94}\u{6570}\u{636E}',
  tokenInvalid: 'Token \u{65E0}\u{6548}',
  tokenExpired: 'Access Token \u{5DF2}\u{8FC7}\u{671F}\u{6216}\u{65E0}\u{6548}',
  networkError: '\u{7F51}\u{7EDC}\u{9519}\u{8BEF}',
  cannotConnectBgm: '\u{65E0}\u{6CD5}\u{8FDE}\u{63A5}\u{5230} Bangumi API',
  debugConnOk: '\u{8C03}\u{8BD5}\u{8FDE}\u{63A5}\u{6B63}\u{5E38}',
  debugConnFail: '\u{8C03}\u{8BD5}\u{8FDE}\u{63A5}\u{5931}\u{8D25}',
  confirmClearMarks:
    '\u{786E}\u{5B9A}\u{8981}\u{6E05}\u{9664}\u{6240}\u{6709}\u{6807}\u{8BB0}\u{5417}\u{FF1F}',
  loadingWait:
    '\u{6B63}\u{5728}\u{52A0}\u{8F7D}\u{811A}\u{672C}\u{FF0C}\u{8BF7}\u{7A0D}\u{540E}\u{91CD}\u{8BD5}...',
  pleaseSetBgmToken: '\u{8BF7}\u{5148}\u{8BBE}\u{7F6E} Bangumi Token\u{FF01}',
  cannotActivateSyncSheet:
    '\u{65E0}\u{6CD5}\u{6FC0}\u{6D3B}\u{540C}\u{6B65}\u{8BB0}\u{5F55}\u{8868}: ',
  syncToBgmError: 'SyncToBangumiAsync \u{51FA}\u{9519}: ',
  execError: '\u{6267}\u{884C}\u{51FA}\u{9519}',
  syncBgmMarksStart:
    '\u{5F00}\u{59CB}\u{4ECE}BGM\u{540C}\u{6B65}\u{6536}\u{85CF}\u{6807}\u{8BB0}\u{FF0C}\u{5DE5}\u{4F5C}\u{8868}\u{7D22}\u{5F15}: ',
  noCollectionData:
    '\u{672A}\u{83B7}\u{53D6}\u{5230}\u{6536}\u{85CF}\u{6570}\u{636E}\u{FF0C}\u{8BF7}\u{68C0}\u{67E5} Token \u{548C}\u{7528}\u{6237}ID\u{FF01}',
  syncComplete: '\u{540C}\u{6B65}\u{5B8C}\u{6210}',
  fetchCollectionFailed: '\u{83B7}\u{53D6}\u{6536}\u{85CF}\u{5931}\u{8D25}',
  syncFailed: '\u{540C}\u{6B65}\u{5931}\u{8D25}',
  sheetNotFound: '\u{672A}\u{627E}\u{5230}\u{5DE5}\u{4F5C}\u{8868}: ',
  marksToSheet: '\u{5DF2}\u{6807}\u{8BB0} ',
  marksToSheetSuffix: ' \u{6761}\u{6536}\u{85CF}\u{5230} ',
  // 头像相关
  avatarLoading: '\u{52A0}\u{8F7D}\u{5934}\u{50CF}\u{4E2D}...',
  avatarLoadFailed: '\u{5934}\u{50CF}\u{52A0}\u{8F7D}\u{5931}\u{8D25}',
  avatarDefault: '\u{65E0}\u{5934}\u{50CF}',
  tokenRenewed: 'Token \u{5DF2}\u{7EED}\u{7EA6}',
  tokenRenewFailed: 'Token \u{7EED}\u{7EA6}\u{5931}\u{8D25}',
  // 连接测试相关
  testConnection: '\u{6D4B}\u{8BD5}\u{8FDE}\u{63A5}',
  testingConnection: '\u{6B63}\u{5728}\u{6D4B}\u{8BD5}\u{8FDE}\u{63A5}...',
  connectionSuccess: '\u{8FDE}\u{63A5}\u{6210}\u{529F}',
  connectionFailed: '\u{8FDE}\u{63A5}\u{5931}\u{8D25}',
  connectionTesting: '\u{6D4B}\u{8BD5}\u{4E2D}...',
  testResult: '\u{6D4B}\u{8BD5}\u{7ED3}\u{679C}',
  responseTime: '\u{54CD}\u{5E94}\u{65F6}\u{95F4}',
  statusCode: '\u{72B6}\u{6001}\u{7801}',
  testedUrl: '\u{6D4B}\u{8BD5}\u{5730}\u{5740}',
  sourceTypeLabel: '\u{6570}\u{636E}\u{6E90}\u{7C7B}\u{578B}',
  retryTest: '\u{91CD}\u{65B0}\u{6D4B}\u{8BD5}',
  closeDialog: '\u{5173}\u{95ED}',
  // Token 有效期相关
  tokenExpiresLabel: 'Token 有效期',
  tokenExpiresNormal: '状态良好',
  tokenExpiresWarning: '即将到期',
  tokenExpiresDanger: '即将过期',
  tokenExpiresExpired: '已过期',
  tokenExpiresUnknown: '未知',
  tokenDaysUnit: '天',
  tokenHoursUnit: '小时',
  tokenStatusQuerying: '检查中...',
  tokenStatusQueryFailed: '状态查询失败',
  tokenExpiringSoon: 'Token 将在 {} 后过期，建议提前重新获取',
  tokenExpiringCritical: 'Token 即将过期（{}），请尽快重新获取！',
  tokenExpiredWarning: 'Token 已过期，请重新获取',
} as const
