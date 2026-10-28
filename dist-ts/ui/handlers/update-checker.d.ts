/**
 * @fileoverview 设置页「检查更新」：查 GitHub Release → 弹窗 → 下载 → 校验 → 安装
 * @module ui/handlers/update-checker
 *
 * 交互（momo）：
 * 1. 点「检查更新」→ 查最新 Release；
 * 2. 有新版 → 弹模态窗，显示新版本号、更新简述，以及**安装方式说明**；
 * 3. 点「下载并安装」→ 进度条 + 日志；
 * 4. 下载完先校验 SHA-256，通过才启动安装；不通过直接拒绝（连脚本都不生成）；
 * 5. 失败 → 弹可复制的日志与失败原因。
 *
 * 安装策略（v2.2.3 起「一键」）：
 * - 本地安装环境（能定位加载项目录）：下载完成后确认一次 → 交给外部 PowerShell
 *   辅助脚本 → 关闭 WPS → 覆盖解压（失败回滚）→ 自动重新打开。用户不需要解压、
 *   不需要手动重启。
 * - 开发环境（`http://localhost` 跑 Vite）或宿主不给 ShellExecute：回落老流程，
 *   把 zip 交给浏览器落盘并给出手动步骤。
 * 细节见 `tools/update-install.ts` 的模块注释。
 */
/**
 * 绑定设置页「检查更新」相关事件（元素不存在时静默跳过，面板页无副作用）
 */
export declare function setupUpdateChecker(): void;
//# sourceMappingURL=update-checker.d.ts.map