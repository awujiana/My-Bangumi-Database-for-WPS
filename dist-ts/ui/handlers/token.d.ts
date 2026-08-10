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
 * 显示用户头像和信息
 * 根据 BGM.cache 中的数据更新头像显示区域
 */
export declare function showUserProfile(): void;
/**
 * 隐藏用户头像区域
 */
export declare function hideUserProfile(): void;
/**
 * 续约/刷新 Token
 * 通过测试现有 Token 的有效性，重新获取用户信息和头像
 * 如果 Token 已失效，提示用户重新输入
 */
export declare function renewToken(): void;
//# sourceMappingURL=token.d.ts.map