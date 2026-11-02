/**
 * UI 事件处理模块 - 共享文案（按当前界面语言取）
 * @module ui/handlers/_constants
 * @description handlers 子模块共用的界面文案。
 *
 * 每一项都是 **getter**：值在读取那一刻才从语言包取，所以切换语言后不需要
 * 重建任何表，也不需要把 `_T` 改成函数、把几十处调用点全加括号。
 * 兜底原文（第二参）保留为简体，与语言包里的 zh-CN 一致；语言包缺失时界面不会变空。
 *
 * 只放「真的会被显示」的条目。此前这里塞了 37 个从未被引用的条目
 * （连接测试弹窗、头像加载、Token 续约等已迁移到别的模块），已删除。
 */
// tOr 直连 locale-store：i18n/index 桶会经 locale-install → tools/save-file → ts/index
// （模块顶层写 window），node 单测一 import 就 ReferenceError。
import { tOr } from '../../i18n/locale-store.js';
export const _T = {
    // ===== Token / 用户 ID =====
    get setBgmToken() {
        return tOr('handlers.token.dialogTitleToken', '设置 Bangumi Access Token');
    },
    get inputToken() {
        return tOr('handlers.token.inputPlaceholderToken', '请输入 Access Token');
    },
    get tokenSaved() {
        return tOr('handlers.token.saved', 'Token 已保存');
    },
    get setBgmUserId() {
        return tOr('handlers.token.dialogTitleUserId', '设置 Bangumi 用户ID');
    },
    get inputUserId() {
        return tOr('handlers.token.inputPlaceholderUserId', '请输入用户ID（数字）');
    },
    get userIdSaved() {
        return tOr('handlers.token.userIdSaved', '用户ID 已保存');
    },
    get set() {
        return tOr('handlers.token.stateSet', '已设置');
    },
    get notSet() {
        return tOr('handlers.token.stateNotSet', '未设置');
    },
    get pleaseSetUserIdFirst() {
        return tOr('handlers.token.needUserId', '请先设置用户ID');
    },
    get pleaseSetTokenFirst() {
        return tOr('handlers.token.needToken', '请先设置 Token');
    },
    get unknownUser() {
        return tOr('handlers.token.unknownUser', '未知用户');
    },
    get avatarDefault() {
        return tOr('handlers.token.avatarDefault', '无头像');
    },
    // ===== Token 校验结果 =====
    get parseFailed() {
        return tOr('handlers.token.parseFailed', '解析失败');
    },
    get cannotParseResponse() {
        return tOr('handlers.token.cannotParseResponse', '无法解析响应数据');
    },
    get tokenInvalid() {
        return tOr('handlers.token.invalidTitle', 'Token 无效');
    },
    get tokenExpired() {
        return tOr('handlers.token.expiredDetail', 'Access Token 已过期或无效');
    },
    get networkError() {
        return tOr('handlers.token.networkErrorTitle', '网络错误');
    },
    get cannotConnectBgm() {
        return tOr('handlers.token.cannotConnect', '无法连接到 Bangumi API');
    },
    get debugConnOk() {
        return tOr('handlers.token.debugOk', '调试连接正常');
    },
    get debugConnFail() {
        return tOr('handlers.token.debugFail', '调试连接失败');
    },
    // ===== Token 有效期 =====
    get tokenExpiresLabel() {
        return tOr('handlers.token.expiresLabel', 'Token 有效期');
    },
    get tokenExpiredWarning() {
        return tOr('handlers.token.expiredWarning', 'Token 已过期，请重新获取');
    },
    // ===== 同步 =====
    get confirmClearMarks() {
        return tOr('handlers.sync.confirmRefresh', '确定要清除所有标记吗？');
    },
    get loadingWait() {
        return tOr('handlers.sync.loadingWait', '正在加载脚本，请稍后重试...');
    },
    get pleaseSetBgmToken() {
        return tOr('handlers.sync.needToken', '请先设置 Bangumi Token！');
    },
    get syncFailed() {
        return tOr('handlers.sync.failedTitle', '同步失败');
    },
};
