/**
 * GitHub 配置表单（读写 / 防抖自动保存 / 数据源字段切换 / 数据分片多选）
 * @module ui/handlers/github-settings
 * @description 从 handlers/index.ts 抽出：配置输入框 ↔ PluginStorage 的双向同步、
 *              按同步源类型（GitHub / local / gist）切换可见字段，以及分片多选。
 */
import type { SyncStrategy, SyncSourceType } from '../../index.js';
/**
 * 可手动选择的数据分片（顺序即界面展示顺序）
 *
 * 与数据仓库 `data/anime.manifest.json` 的 6 片一一对应。这里刻意用静态清单，
 * 而不是打开面板时去拉一次清单：拉清单会给「打开设置」引入网络失败面，而手动选片
 * 只是覆盖自动选片的兜底手段 —— 清单以后新增的分片在自动模式下仍会被正常选中。
 *
 * `detail` 是该片的完整字段清单与取舍说明，给「📋 分片清单」浮窗用：
 * 复选框上那一两个词（「资料」「关联条目」）装不下这些细节，而用户需要
 * 知道勾下去到底拖哪些字段下来（momo：选项太笼统，要完整写在分片清单里）。
 */
export declare const SHARD_OPTIONS: readonly {
    name: string;
    label: string;
    detail: string;
}[];
/**
 * 按 {@link SHARD_OPTIONS} 渲染分片复选框（幂等：重复调用先清空）
 */
export declare function renderShardOptions(): void;
/**
 * 读取当前勾选的分片
 *
 * 必选片是 `disabled`，不计入用户选择；用户一个可选片都没勾时返回空数组，
 * 语义是「回到按表头自动选片」。
 *
 * @returns 分片名数组；空数组表示自动模式
 */
export declare function collectSelectedShards(): string[];
/**
 * 从 PluginStorage 回填分片勾选状态
 */
export declare function refreshShardSelection(): void;
/**
 * 打开「分片清单」浮窗（独立模态框）
 *
 * 为什么独立浮窗而不是塞进 hint：每片要写清完整字段清单（含「关联条目ID vs
 * 关联的动漫ID」的区别、各片体积占比），hint 放不下（momo：选项太笼统）。
 *
 * 遮罩用 `absolute` + JS 写 `top = scrollY` 锚定**当前可见区**：WPS 任务窗格里
 * `fixed` 会因 iframe 视口=内容高而飘到可见区外（detachable-panel 同款修法）。
 */
export declare function openShardListModal(): void;
/** 关闭「分片清单」浮窗 */
export declare function closeShardListModal(): void;
/**
 * 注册分片清单浮窗的入口与关闭路径
 *
 * 按钮 / 关闭叉 / 点遮罩 / Esc 四条路都关。Esc 监听常驻但不抢事件：
 * 浮窗没开（display:none）就直接放行，让页面其它 Esc 处理器（关弹窗那批）照常工作。
 */
export declare function bindShardListModal(): void;
/**
 * 按同步源类型切换 UI 字段显示/隐藏
 *
 * - GitHub/GitLab/Gitee: 显示 owner/repo/branch/path（#remoteSourceFields）
 * - local: 显示本地文件路径输入框 + 选择按钮（#localFileFields）
 * - gist: 显示 gistId 输入框（#gistFields）
 *
 * 分片多选（#shardSelectFields）对 GitHub / GitLab / Gitee / local 都有效，
 * 只有 Gist 不支持（Gist API 只能读明文，读不了 gzip 分片），故一并隐藏。
 *
 * @param sourceType 同步源类型
 */
export declare function toggleSourceFields(sourceType: SyncSourceType): void;
/**
 * 从配置表单读到的原始值（**未做必填校验**，空串原样保留）
 */
export interface GithubConfigForm {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    sourceType: SyncSourceType;
    strategy: SyncStrategy;
    gistId?: string | undefined;
}
/**
 * 缺失的必填项；齐全时为 `null`。
 *
 * 返回**具体缺哪一项**而不是 boolean：手动保存要给「本地文件路径 / Gist ID /
 * owner+repo+path」三种不同提示，而防抖自动保存只关心「要不要跳过」。
 */
export type GithubConfigMissingField = 'path' | 'gistId' | 'ownerRepoPath' | null;
/**
 * 从 DOM 实时读取配置表单（不持有元素引用，避免闭包拿到过时节点）
 *
 * `saveGithubConfigFromDom`（防抖自动保存）与 `action-handlers` 的
 * `saveGithubConfig`（手动保存）此前各写一份逐字相同的读取逻辑，收敛于此。
 */
export declare function readGithubConfigForm(): GithubConfigForm;
/** 按同步源类型找出缺失的必填项；齐全时返回 `null` */
export declare function findMissingConfigField(form: GithubConfigForm): GithubConfigMissingField;
/**
 * saveGithubConfigFromDom（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
export declare function saveGithubConfigFromDom(): void;
/**
 * GitHub 配置输入框防抖自动保存（300ms）。
 * 每次从 DOM 实时读取值，避免闭包持有过时的元素引用。
 */
export declare const debouncedSaveGithubConfig: () => void;
/**
 * 从 PluginStorage 重新读取 GitHub 配置并填充到面板输入框
 * 用于配置导入后刷新 UI 显示
 */
export declare function refreshGithubConfigInputs(): void;
/**
 * loadGithubConfigIntoForm（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
export declare function loadGithubConfigIntoForm(): void;
//# sourceMappingURL=github-settings.d.ts.map