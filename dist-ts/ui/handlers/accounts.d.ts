/**
 * @fileoverview 多账号切换 UI（设置页列表 + 长按头像浮层）
 * @module ui/handlers/accounts
 * @description 账号档案的读写全在 `tools/accounts`，本文件只做两件呈现：
 *              1. 设置页「👤 账号」里的档案列表（切换 / 删除 / 把当前 Token 记进来）；
 *              2. 长按头像（顶栏头像或侧栏头像）弹出账号浮层，点一下即切换。
 *
 * 为什么用长按而不是点击：头像是「身份指示」，单击不该有破坏性行为；
 * 长按 550ms 是移动端与桌面都习惯的「更多操作」手势，误触率低。
 */
/** 渲染设置页的账号列表 */
export declare function renderAccountList(): void;
/** 关闭账号浮层（重复调用安全） */
export declare function closeAccountMenu(): void;
/**
 * 初始化账号管理：设置页列表 + 长按头像浮层。
 * 设置页与主面板都会调用；各自缺元素时静默跳过对应部分。
 */
export declare function initializeAccountManager(): void;
//# sourceMappingURL=accounts.d.ts.map