import { type WpsWorksheet, type GithubSyncResult, type GithubRemoteEntry, type LocalRowEntry } from '../index.js';
/**
 * 单条字段级冲突描述
 *
 * 用于 GitHub 同步流程中，远程条目与本地 Excel 行在同一字段上取值不同时记录。
 */
export interface Conflict {
    /** Bangumi subject ID（主键） */
    sid: string;
    /** 冲突字段名（如 '打分', '名称', '是否看完'） */
    field: string;
    /** 本地值（字符串形式，便于直接渲染） */
    localValue: string;
    /** 远程值（字符串形式，便于直接渲染） */
    remoteValue: string;
    /** 本地行号（用于定位 Excel 行） */
    localRow: number;
}
/**
 * 用户对单条冲突的解决决策
 *
 * chosenValue 为 'local' 时表示保留本地值（从 diff.changedFields 中移除该字段）；
 * 为 'remote' 时表示采用远程值（保留该字段在 diff.changedFields 中）。
 */
export { type ConflictResolution } from '../sync/githubSyncDiff.js';
/**
 * 检测 GitHub 远程条目与本地 Excel 行之间的字段级冲突
 *
 * 比对规则：
 * - 仅当 SID 同时存在于远程与本地时才可能产生冲突
 * - 仅当远程字段非空（字符串化后非空字符串）且与本地不同时记录为冲突
 * - 「是否看完」为用户本地字段，远程数据不含此字段，不参与冲突比对
 *
 * 注意：本函数为纯函数，不读取 Excel，不发起网络请求，可在 Node 测试环境直接运行。
 *
 * @param remote 远程条目数组
 * @param local 本地条目映射（SID → 行）
 * @returns 冲突列表（按远程数组顺序与字段比对表顺序）
 */
export declare function detectGithubConflicts(remote: GithubRemoteEntry[], local: Map<string, LocalRowEntry>): Conflict[];
/**
 * 获取同步预览统计（不发送请求，仅扫描 Excel）
 * @param ws 工作表对象
 * @param colMap 列映射
 * @param lastRow 数据最后一行
 * @param headerRow 表头行
 * @param options 可选参数 { incremental: boolean }
 * @returns 统计信息 { total, valid, willSync, willSkip, alreadyUploaded, noUrl, emptyStatus }
 */
export declare function getSyncPreview(ws: WpsWorksheet, colMap: Map<string, number>, lastRow: number, headerRow: number, options?: {
    incremental?: boolean;
    fingerprintMap?: Map<string, string>;
}): {
    total: number;
    valid: number;
    willSync: number;
    willSkip: number;
    alreadyUploaded: number;
    noUrl: number;
    emptyStatus: number;
    incrementalSkipped: number;
};
/**
 * 异步检测 Excel 与 Bangumi 收藏之间的冲突
 * @returns 包含冲突条目列表及统计信息的对象
 */
export declare function detectConflicts(ws: WpsWorksheet, colMap: Map<string, number>, lastRow: number, headerRow: number, token: string): Promise<{
    conflicts: Array<{
        row: number;
        sid: string;
        name: string;
        existingType?: number;
        newType: number;
    }>;
    conflictCount: number;
    bgmCollectionReady: boolean;
}>;
/**
 * Ribbon 专用的完整同步流程：预览 → 冲突检测 → 确认 → 执行
 * @param conflictResolution 冲突处理策略，默认 'excel'（覆盖）
 */
export declare function syncWithConfirmation(): Promise<void>;
/** 设置 Token（Ribbon 版本） */
export declare function setTokenForRibbon(): Promise<boolean>;
/**
 * 测试 Token（Ribbon 版本）
 *
 * Ribbon 上下文中 index.html 对用户不可见，DOM 弹窗（showAlert/showSuccess）无法展示。
 * 因此本函数使用 wpsMsgBox（带浏览器 alert 兜底）替代 DOM 弹窗进行所有用户交互。
 */
export declare function testTokenForRibbon(): Promise<void>;
/**
 * 复制 Token 到剪贴板（Ribbon 版本）
 *
 * 使用 wpsMsgBox（带浏览器兜底）显示结果，确保在 Ribbon 和浏览器环境均可见。
 */
export declare function copyTokenForRibbon(): Promise<void>;
/** 设置用户 ID（Ribbon 版本） */
export declare function setUserIdForRibbon(): void;
/** 打开收藏页面（Ribbon 版本） */
export declare function openCollectionForRibbon(): void;
/**
 * 从 GitHub 仓库增量同步数据到本地 Excel（Ribbon 入口）
 *
 * 流程：
 * 1. 校验 GitHub 配置是否完整（owner/repo/path）
 * 2. 确保 taskpane 面板可见（不切换，只显示）
 * 3. 写入 PluginStorage 信号（bgm_request_github_sync = 时间戳）
 *    - taskpane 通过 userInfoPolling 轮询检测该信号
 *    - 检测到后通过 taskpane 内部 eventBus 触发 syncFromGithub handler
 *    - taskpane handler 负责显示确认对话框 + 模块化进度弹窗
 *
 * 跨上下文通信说明：
 * WPS 中 Ribbon 和 Taskpane 是独立 iframe，eventBus 无法跨上下文通信。
 * 必须通过 PluginStorage 作为中间介质，taskpane 轮询检测信号变化。
 *
 * @returns 同步结果统计（信号触发模式返回 null，实际结果由 taskpane handler 处理）
 */
export declare function syncFromGithubForRibbon(): Promise<GithubSyncResult | null>;
/**
 * 撤销最近一次 GitHub 同步操作（Ribbon 入口）
 *
 * 流程：
 * 1. 读取最近一次同步会话描述；若栈为空，提示无可撤销操作
 * 2. 弹确认对话框，提示用户即将撤销的会话描述
 * 3. 调用 undoLastSync 按单元格逆序恢复
 * 4. 显示恢复条目数
 */
export declare function undoLastSyncForRibbon(): Promise<void>;
//# sourceMappingURL=ribbonService.d.ts.map