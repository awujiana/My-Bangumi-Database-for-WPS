/**
 * @fileoverview 多账号管理（Bangumi Token 档案）
 * @module tools/accounts
 * @description 把用户登录过的账号（Token + 用户 ID + 昵称）存成一份可切换的档案列表，
 *              当前生效的账号仍是原来的 `bgm_token` / `bgm_user_id` 两个配置键 ——
 *              切换 = 把档案里的值写回这两个键，因此**所有既有逻辑无需改动**，
 *              也不会出现「档案与生效值不一致」的第二真相。
 *
 * 设计要点：
 *   1. 列表上限 8 个：再多就不是「切换常用账号」而是账号仓库，设置页也放不下；
 *   2. 按 `userId` 去重（同一个账号换 Token 只更新，不新增一条）；
 *   3. 自愈：坏 JSON / 缺字段 / 重复项在读的时候就被丢掉，不需要迁移逻辑；
 *   4. 不主动校验 Token：档案只是「记住」，有效性仍由「测试 Token」按钮判定。
 */
/** 一条账号档案 */
export interface AccountRecord {
    /** Bangumi 用户 ID（数字字符串，去重键） */
    userId: string;
    /** 昵称（展示用，可能为空 —— 只填过 Token 没测过） */
    username: string;
    /** API Token（与 `bgm_token` 同格式，明文存 PluginStorage） */
    token: string;
    /** 记录时间（ISO 字符串，列表按它排序） */
    addedAt: string;
}
/** 最多保留的账号数 */
export declare const MAX_ACCOUNTS = 8;
/** 全部已记录的账号（按记录时间倒序：最近用的排在前面） */
export declare function listAccounts(isSilent?: boolean): AccountRecord[];
/**
 * 记录 / 更新一个账号（同 userId 只更新 Token 与昵称）
 * @returns 是否写入成功
 */
export declare function didUpsertAccount(account: Omit<AccountRecord, 'addedAt'>): boolean;
/** 删除一个账号档案（不影响当前生效的 Token） */
export declare function removeAccount(userId: string): boolean;
/** 当前生效账号的 userId（未设置时为空串） */
export declare function getActiveUserId(isSilent?: boolean): string;
/**
 * 切换到某个已记录账号：把档案里的 Token / userId 写回生效配置
 * @returns 切换后的档案；未记录该账号时返回 null（调用方提示，不静默成功）
 */
export declare function switchAccount(userId: string): AccountRecord | null;
//# sourceMappingURL=accounts.d.ts.map