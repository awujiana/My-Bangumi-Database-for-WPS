/**
 * @fileoverview GitLab 仓库增量同步模块
 * @module sync/gitlabSync
 * @description GitLab 同步源实现，URL 模板：
 *              https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              注意：GitLab Raw URL 使用 `/-/raw/` 段（含三段横线），
 *              与 GitHub 的 `/raw/` 不同。例如：
 *                GitHub: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 *                GitLab: https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              复用 githubConfig 的 owner/repo/branch/path 字段（与 GitHub 共享配置 UI），
 *              复用 githubSyncDiff.ts 的 parseJsonl / isGithubRemoteEntry 解析逻辑，
 *              不重复解析实现。
 *
 * 数据格式（远程 JSON 文件）与 GitHub 一致：
 * [
 *   { "sid": "12345", "url": "https://bgm.tv/subject/12345", "name": "...",
 *     "type": 2, "score": 8, "tags": ["标签1","标签2"], "comment": "...",
 *     "episode": 12, "updatedAt": "2026-07-05T10:00:00Z" },
 *   ...
 * ]
 */
import { LOG_LEVELS } from '../core/constants.js';
import { Result, BgmError } from '../core/result.js';
import { bgmLog } from '../tools/util.js';
import { getGithubConfig, isGithubConfigComplete } from './githubConfig.js';
import { parseJsonl } from './githubSyncDiff.js';
// 复用 githubSyncDiff.ts 的纯解析函数与类型（零依赖纯模块，可在 Node 测试环境直接运行）
/** HTTP 请求超时（毫秒），与 githubSync 保持一致 */
const REQUEST_TIMEOUT_MS = 30000;
/** 默认分支名（与 githubConfig 默认值一致） */
const DEFAULT_BRANCH = 'main';
/**
 * 构造 GitLab Raw 文件下载 URL
 *
 * 格式：https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 * 关键差异：GitLab 使用 `/-/raw/` 段（含三段横线），不同于 GitHub 的 `/raw/`。
 *
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export function buildGitlabRawUrl() {
    const cfg = getGithubConfig();
    if (!isGithubConfigComplete()) {
        throw new Error('GitLab 仓库配置不完整，请在面板中设置 owner/repo/path');
    }
    const branch = cfg.branch || DEFAULT_BRANCH;
    return `https://gitlab.com/${cfg.owner}/${cfg.repo}/-/raw/${branch}/${cfg.path}`;
}
/**
 * 从 GitLab Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式与 GitHub 同步源一致：每行一个独立的 JSON 对象。
 * 解析复用 githubSyncDiff.ts 的 parseJsonl，非法行不中断整体解析。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGitlabJson(signal) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = buildGitlabRawUrl();
        }
        catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
            return;
        }
        // 如果 signal 已 aborted，立即 reject
        if (signal?.aborted) {
            reject(new Error('请求被取消'));
            return;
        }
        bgmLog(LOG_LEVELS.INFO, `[gitlabSync] 开始下载: ${url}`);
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = REQUEST_TIMEOUT_MS;
        xhr.setRequestHeader('Accept', 'application/json');
        // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
        if (signal) {
            signal.addEventListener('abort', () => {
                xhr.abort();
            });
        }
        xhr.onload = () => {
            if (xhr.status === 200) {
                try {
                    const { entries, errors } = parseJsonl(xhr.responseText);
                    if (entries.length === 0 && errors.length > 0) {
                        reject(new Error(`JSONL 解析失败：${errors.length} 行全部非法。` +
                            `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`));
                        return;
                    }
                    if (errors.length > 0) {
                        bgmLog(LOG_LEVELS.WARN, `[gitlabSync] JSONL 解析完成：${entries.length} 条合法，${errors.length} 行非法（已跳过）。` +
                            `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`);
                    }
                    else {
                        bgmLog(LOG_LEVELS.INFO, `[gitlabSync] 下载成功：${entries.length} 条记录`);
                    }
                    resolve(entries);
                }
                catch (e) {
                    reject(new Error(`JSONL 解析失败: ${e instanceof Error ? e.message : String(e)}`));
                }
            }
            else if (xhr.status === 404) {
                reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`));
            }
            else if (xhr.status === 403) {
                reject(new Error(`访问被拒（403）：可能是私有仓库或触发 GitLab 限流`));
            }
            else {
                reject(new Error(`HTTP 错误 ${xhr.status}: ${xhr.statusText}`));
            }
        };
        xhr.onerror = () => {
            // 如果是 abort 导致的 onerror，归类为取消
            if (signal?.aborted) {
                reject(new Error('请求被取消'));
                return;
            }
            reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`));
        };
        xhr.ontimeout = () => {
            reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）：${url}`));
        };
        xhr.send();
    });
}
// ========== SyncSource 接口实现 ==========
/**
 * GitLab 同步源实现
 *
 * 包装 fetchGitlabJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 与 GithubSyncSource 行为一致：
 * 1. validateConfig() 在下载前校验配置完整性（复用 githubConfig）
 * 2. fetchRemoteEntries() 委托给 fetchGitlabJson，仅 URL 构造不同
 */
export class GitlabSyncSource {
    /** 数据源类型标识 */
    getSourceType() {
        return 'gitlab';
    }
    /** 数据源显示名称（用于日志与进度提示） */
    getDisplayName() {
        return 'GitLab';
    }
    /**
     * 获取远程条目（委托给 fetchGitlabJson）
     * @param signal 可选的 AbortSignal
     */
    async fetchRemoteEntries(signal) {
        return fetchGitlabJson(signal);
    }
    /**
     * 校验配置是否完整可用
     * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
     */
    validateConfig() {
        if (!isGithubConfigComplete()) {
            return Result.failVoid(new BgmError('GitLab 仓库配置不完整，请填写 owner/repo/branch/path', 'CONFIG_INCOMPLETE'));
        }
        return Result.okVoid();
    }
}
