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
import { CONFIG_KEYS, getConfig, setConfig } from './config.js';
/** 最多保留的账号数 */
export const MAX_ACCOUNTS = 8;
/** 读原始列表并做形状校验 */
function readRaw(isSilent) {
    const raw = getConfig(CONFIG_KEYS.ACCOUNTS, '', isSilent);
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        const result = [];
        const seen = new Set();
        const objects = parsed.filter((item) => Boolean(item) && typeof item === 'object');
        for (const record of objects) {
            const userId = typeof record.userId === 'string' ? record.userId.trim() : '';
            const token = typeof record.token === 'string' ? record.token.trim() : '';
            const isUsable = userId !== '' && token !== '' && !seen.has(userId);
            if (isUsable) {
                seen.add(userId);
                result.push({
                    userId,
                    token,
                    username: typeof record.username === 'string' ? record.username : '',
                    addedAt: typeof record.addedAt === 'string' ? record.addedAt : '',
                });
            }
        }
        return result;
    }
    catch {
        return [];
    }
}
/** 写回列表（超上限时保留最新的 N 条） */
function didSaveAccounts(accounts) {
    const trimmed = accounts.slice(0, MAX_ACCOUNTS);
    return setConfig(CONFIG_KEYS.ACCOUNTS, JSON.stringify(trimmed));
}
/** 全部已记录的账号（按记录时间倒序：最近用的排在前面） */
export function listAccounts(isSilent = false) {
    return readRaw(isSilent).sort((left, right) => right.addedAt.localeCompare(left.addedAt));
}
/**
 * 记录 / 更新一个账号（同 userId 只更新 Token 与昵称）
 * @returns 是否写入成功
 */
export function didUpsertAccount(account) {
    const userId = account.userId.trim();
    const token = account.token.trim();
    if (userId === '' || token === '')
        return false;
    const others = readRaw(false).filter((item) => item.userId !== userId);
    const next = {
        userId,
        token,
        username: account.username.trim(),
        addedAt: new Date().toISOString(),
    };
    return didSaveAccounts([next, ...others]);
}
/** 删除一个账号档案（不影响当前生效的 Token） */
export function removeAccount(userId) {
    const next = readRaw(false).filter((item) => item.userId !== userId);
    return didSaveAccounts(next);
}
/** 当前生效账号的 userId（未设置时为空串） */
export function getActiveUserId(isSilent = false) {
    return getConfig(CONFIG_KEYS.USER_ID, '', isSilent);
}
/**
 * 切换到某个已记录账号：把档案里的 Token / userId 写回生效配置
 * @returns 切换后的档案；未记录该账号时返回 null（调用方提示，不静默成功）
 */
export function switchAccount(userId) {
    const target = readRaw(false).find((item) => item.userId === userId);
    if (target === undefined)
        return null;
    const isTokenSaved = setConfig(CONFIG_KEYS.TOKEN, target.token);
    const isUserSaved = setConfig(CONFIG_KEYS.USER_ID, target.userId);
    if (!isTokenSaved || !isUserSaved)
        return null;
    // 切过的账号提到最前（下次长按头像第一项就是它）
    const others = readRaw(false).filter((item) => item.userId !== userId);
    didSaveAccounts([{ ...target, addedAt: new Date().toISOString() }, ...others]);
    return target;
}
