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
export declare const _T: {
    readonly setBgmToken: string;
    readonly inputToken: string;
    readonly tokenSaved: string;
    readonly setBgmUserId: string;
    readonly inputUserId: string;
    readonly userIdSaved: string;
    readonly set: string;
    readonly notSet: string;
    readonly pleaseSetUserIdFirst: string;
    readonly pleaseSetTokenFirst: string;
    readonly unknownUser: string;
    readonly avatarDefault: string;
    readonly parseFailed: string;
    readonly cannotParseResponse: string;
    readonly tokenInvalid: string;
    readonly tokenExpired: string;
    readonly networkError: string;
    readonly cannotConnectBgm: string;
    readonly debugConnOk: string;
    readonly debugConnFail: string;
    readonly tokenExpiresLabel: string;
    readonly tokenExpiredWarning: string;
    readonly confirmClearMarks: string;
    readonly loadingWait: string;
    readonly pleaseSetBgmToken: string;
    readonly syncFailed: string;
};
//# sourceMappingURL=_constants.d.ts.map