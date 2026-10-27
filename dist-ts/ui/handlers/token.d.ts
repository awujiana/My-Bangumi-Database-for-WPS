/**
 * UI 事件处理模块 - Token 相关函数
 * @module ui/handlers/token
 * @description Token 设置、用户 ID 设置、Token 有效性测试、用户信息展示等。
 */
export declare function showTokenDialog(currentToken?: string): void;
export declare function showUserIdDialog(): void;
export declare function updateTokenStatus(): void;
export declare function updateUserIdStatus(): void;
export declare function openUserCollection(): void;
export declare function testTokenValidity(): void;
export declare function testDebugConnection(): void;
/**
 * 查询 Token 状态（有效期、过期时间）
 *
 * 通过 POST /oauth/token_status 接口获取 Access Token 的过期时间戳。
 * Bangumi API 返回 expires 字段（Unix 时间戳，秒），据此可计算剩余天数。
 *
 * @param token - Bangumi Access Token
 * @returns Promise  resolving to { expires: number, userId: string }
 */
export declare function queryTokenStatus(token: string): Promise<{
    expires: number;
    userId: string;
}>;
/**
 * 在 UI 上显示 Token 过期信息
 *
 * 更新 tokenExpiresDisplay 元素，显示剩余天数和状态。
 * 同时更新 tokenStatus 颜色以反映过期紧迫程度。
 *
 * @param expires - Unix 时间戳（秒）
 */
export declare function showTokenExpiryInfo(expires: number): void;
/**
 * 检查 Token 过期并发送提醒（P1）
 *
 * - expired: 红色 Toast，强烈建议重新获取
 * - danger (<3天): 红色 Toast，提醒尽快获取
 * - warning (<7天): 黄色 Toast，建议关注
 *
 * @param expires - Unix 时间戳（秒）
 */
export declare function checkTokenExpiryWarning(expires: number): void;
/**
 * 显示用户头像和信息
 * 根据 BGM.cache 中的数据更新头像显示区域
 */
export declare function showUserProfile(): void;
/**
 * 隐藏用户头像区域
 */
export declare function hideUserProfile(): void;
//# sourceMappingURL=token.d.ts.map