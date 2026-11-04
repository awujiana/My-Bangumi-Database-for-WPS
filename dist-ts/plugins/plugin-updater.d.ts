/** 单次更新的结果状态 */
export type PluginUpdateStatus = 'updated' | 'up-to-date' | 'failed' | 'needs-permission' | 'needs-trust' | 'skipped';
/** 单个插件的检查结果（市场页直接渲染） */
export interface PluginUpdateOutcome {
    id: string;
    name: string;
    from: string;
    to?: string;
    status: PluginUpdateStatus;
    reason?: string;
}
/** 更新循环的选项 */
export interface PluginUpdateLoopOptions {
    /** 首次检查延迟（毫秒），默认 30 秒 —— 让页面先渲染完 */
    initialDelay?: number;
    /** 检查间隔（毫秒），默认 6 小时 */
    interval?: number;
}
/**
 * 检查并执行一轮更新。
 *
 * @param rootUrl 加载项目录 URL
 * @param hostVersion 宿主版本（判 `minHostVersion`）
 * @param onlyId 只检查某一个插件（详情页用）
 */
export declare function checkPluginUpdates(rootUrl: URL, hostVersion: string, onlyId?: string): Promise<PluginUpdateOutcome[]>;
/**
 * 启动定时检查。
 *
 * @returns 停止函数（页面卸载时调用，避免定时器泄漏）
 */
export declare function startPluginUpdateLoop(rootUrl: URL, hostVersion: string, onOutcome: (outcomes: PluginUpdateOutcome[]) => void, options?: PluginUpdateLoopOptions): () => void;
//# sourceMappingURL=plugin-updater.d.ts.map