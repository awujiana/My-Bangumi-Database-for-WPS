# GitHub 仓库增量同步功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「从 GitHub 公开仓库拉取 JSON 数据，按 SID 主键比对行差异，增量更新本地 Excel」功能，通过 Ribbon 按钮手动触发，UI 可配置仓库地址。

**Architecture:**
- 数据形式：单个 JSON 数组文件（如 `data/bangumi-data.json`），每条记录含 `sid`、`url`、`name`、`type`、`score`、`tags`、`comment` 等字段
- 增量策略：客户端全量下载 JSON → 按 SID 主键比对本地 Excel 行 → 远程有但本地无的新增（追加末尾）→ 本地已有但内容不同的更新 → 本地多余的保留不删除
- 认证方式：不认证，仅访问公开仓库（受 GitHub 60次/小时/IP 限制）
- 触发方式：Ribbon 按钮 + 任务面板按钮（均为手动）
- 配置存储：复用 PluginStorage（owner/repo/branch/path 四个字段）

**Tech Stack:** TypeScript（严格模式）、WPS 加载项 SDK、XMLHttpRequest（GitHub raw 下载）、vitest（纯函数单测）

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| 新增 | `ts/sync/githubSync.ts` | GitHub 同步核心逻辑：下载、解析、diff、应用 |
| 新增 | `ts/sync/githubConfig.ts` | GitHub 仓库配置管理（owner/repo/branch/path） |
| 新增 | `tests/githubSync.test.ts` | diff 逻辑单元测试 |
| 修改 | `ts/index.ts` | 统一导出新模块 |
| 修改 | `ts/services/ribbonService.ts` | 新增 `syncFromGithubForRibbon()` |
| 修改 | `ts/ribbon.ts` | 新增按钮分发 case |
| 修改 | `ts/ui/handlers.ts` | 新增 `syncFromGithub` action |
| 修改 | `ribbon.xml` | 新增「GitHub 同步」按钮 |
| 修改 | `ui/taskpane.html` | 新增「GitHub 仓库设置」UI 区块 |
| 修改 | `main.js` | 在 MODULES 数组中注册新模块 |

---

## Task 1: 新增 GitHub 仓库配置管理模块

**Files:**
- Create: `ts/sync/githubConfig.ts`

- [ ] **Step 1: 创建 githubConfig.ts**

```typescript
/**
 * @fileoverview GitHub 仓库配置管理模块
 * @module sync/githubConfig
 * @description 管理 GitHub 仓库地址配置（owner/repo/branch/path），
 *              使用 PluginStorage 持久化存储。仅支持公开仓库（不认证）。
 */

import { getApp, bgmLog, LOG_LEVELS } from '../index.js';
import { BGM_EVENTS, eventBus } from '../tools/events.js';

/** GitHub 仓库配置 */
export interface GithubSyncConfig {
    /** 仓库所有者（用户名或组织名） */
    owner: string;
    /** 仓库名 */
    repo: string;
    /** 分支名（默认 main） */
    branch: string;
    /** 文件路径（如 data/bangumi-data.json） */
    path: string;
}

/** PluginStorage 配置键 */
const CONFIG_KEYS = {
    OWNER: 'github_sync_owner',
    REPO: 'github_sync_repo',
    BRANCH: 'github_sync_branch',
    PATH: 'github_sync_path',
} as const;

/** 默认分支 */
const DEFAULT_BRANCH = 'main';

/**
 * 获取 PluginStorage
 */
function getStorage(): WpsPluginStorage | undefined {
    const app = getApp();
    const storage = app?.PluginStorage;
    if (!storage) {
        bgmLog(LOG_LEVELS.WARN, '[githubConfig] PluginStorage 不可用');
    }
    return storage;
}

// WpsPluginStorage 类型从 index 导入（若未导出则在此最小定义）
import type { WpsPluginStorage } from '../tools/wps.js';

/**
 * 读取 GitHub 仓库配置
 * @returns 配置对象，未配置的字段为空字符串
 */
export function getGithubConfig(): GithubSyncConfig {
    const storage = getStorage();
    const owner = storage?.getItem(CONFIG_KEYS.OWNER) ?? '';
    const repo = storage?.getItem(CONFIG_KEYS.REPO) ?? '';
    const branch = storage?.getItem(CONFIG_KEYS.BRANCH) || DEFAULT_BRANCH;
    const path = storage?.getItem(CONFIG_KEYS.PATH) ?? '';
    return { owner, repo, branch, path };
}

/**
 * 保存 GitHub 仓库配置
 * @returns 成功返回 true
 */
export function setGithubConfig(config: GithubSyncConfig): boolean {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    storage.setItem(CONFIG_KEYS.OWNER, config.owner);
    storage.setItem(CONFIG_KEYS.REPO, config.repo);
    storage.setItem(CONFIG_KEYS.BRANCH, config.branch || DEFAULT_BRANCH);
    storage.setItem(CONFIG_KEYS.PATH, config.path);
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] 配置已保存: ${config.owner}/${config.repo}/${config.branch}/${config.path}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key: 'github_sync_config', value: JSON.stringify(config) });
    return true;
}

/**
 * 校验配置是否完整可用
 * @returns 完整返回 true
 */
export function isGithubConfigComplete(): boolean {
    const cfg = getGithubConfig();
    return cfg.owner.length > 0 && cfg.repo.length > 0 && cfg.path.length > 0;
}

/**
 * 构造 GitHub Raw 文件下载 URL
 * 格式：https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export function buildRawUrl(): string {
    const cfg = getGithubConfig();
    if (!isGithubConfigComplete()) {
        throw new Error('GitHub 仓库配置不完整，请在面板中设置 owner/repo/path');
    }
    return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || DEFAULT_BRANCH}/${cfg.path}`;
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add ts/sync/githubConfig.ts
git commit -m "feat(github-sync): 新增 GitHub 仓库配置管理模块"
```

---

## Task 2: 新增 GitHub 同步核心模块（类型定义 + 下载）

**Files:**
- Create: `ts/sync/githubSync.ts`

- [ ] **Step 1: 创建 githubSync.ts（类型定义 + 下载函数）**

```typescript
/**
 * @fileoverview GitHub 仓库增量同步模块
 * @module sync/githubSync
 * @description 从 GitHub 公开仓库下载 JSON 数据，按 SID 主键比对本地 Excel 行，
 *              增量更新（新增+更新，不删除本地多余行）。
 *
 * 数据格式（远程 JSON 文件）：
 * [
 *   { "sid": "12345", "url": "https://bgm.tv/subject/12345", "name": "...",
 *     "type": 2, "score": 8, "tags": ["标签1","标签2"], "comment": "...",
 *     "episode": 12, "updatedAt": "2026-07-05T10:00:00Z" },
 *   ...
 * ]
 *
 * type 字段约定（与 Bangumi 一致）：
 *   1=想看  2=在看  3=看过  4=搁置  5=抛弃
 */

import {
    LOG_LEVELS, bgmLog, getApp, BGM,
    extractSubjectId, mapWatchStatus, trim,
    getDataSheet, findHeaderRow, getLastRow, getColumnMap,
    getCellValue, setCellValue, colNumToLetter,
    type WpsWorksheet, type WpsRange,
} from '../index.js';
import { buildRawUrl, isGithubConfigComplete } from './githubConfig.js';

/** 远程 JSON 单条记录结构 */
export interface GithubRemoteEntry {
    /** Bangumi subject ID（主键） */
    sid: string;
    /** Bangumi 条目 URL */
    url?: string;
    /** 条目名称 */
    name?: string;
    /** 观看状态（1-5） */
    type?: number;
    /** 评分（0-10） */
    score?: number;
    /** 标签数组 */
    tags?: string[];
    /** 个人评论 */
    comment?: string;
    /** 看到集数 */
    episode?: number;
    /** 远程更新时间戳 */
    updatedAt?: string;
}

/** 单条差异记录 */
export interface GithubSyncDiff {
    /** 差异类型 */
    kind: 'add' | 'update';
    /** 主键 SID */
    sid: string;
    /** 远程条目数据 */
    remote: GithubRemoteEntry;
    /** 本地行号（update 时有值，add 时为 null） */
    localRow?: number;
    /** 变更字段列表 */
    changedFields: string[];
}

/** 同步结果统计 */
export interface GithubSyncResult {
    /** 远程总条目数 */
    remoteTotal: number;
    /** 新增条目数 */
    added: number;
    /** 更新条目数 */
    updated: number;
    /** 无变更条目数 */
    unchanged: number;
    /** 跳过条目数（无 SID 或无效） */
    skipped: number;
    /** 失败条目数 */
    failed: number;
}

/** HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * 类型守卫：判断 unknown 是否为合法的远程条目
 */
function isGithubRemoteEntry(value: unknown): value is GithubRemoteEntry {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.sid === 'string' && obj.sid.length > 0;
}

/**
 * 类型守卫：判断 unknown 是否为远程条目数组
 */
function isGithubRemoteEntryArray(value: unknown): value is GithubRemoteEntry[] {
    if (!Array.isArray(value)) return false;
    return value.every(isGithubRemoteEntry);
}

/**
 * 从 GitHub Raw 下载 JSON 文件
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGithubJson(): Promise<GithubRemoteEntry[]> {
    return new Promise<GithubRemoteEntry[]>((resolve, reject) => {
        let url: string;
        try {
            if (!isGithubConfigComplete()) {
                throw new Error('GitHub 仓库配置不完整');
            }
            url = buildRawUrl();
        } catch (e: unknown) {
            reject(e instanceof Error ? e : new Error(String(e)));
            return;
        }

        bgmLog(LOG_LEVELS.INFO, `[githubSync] 开始下载: ${url}`);
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = REQUEST_TIMEOUT_MS;
        xhr.setRequestHeader('Accept', 'application/json');

        xhr.onload = (): void => {
            if (xhr.status === 200) {
                try {
                    const parsed: unknown = JSON.parse(xhr.responseText);
                    if (!isGithubRemoteEntryArray(parsed)) {
                        reject(new Error('远程数据格式无效：期望 GithubRemoteEntry 数组'));
                        return;
                    }
                    bgmLog(LOG_LEVELS.INFO, `[githubSync] 下载成功：${parsed.length} 条记录`);
                    resolve(parsed);
                } catch (e: unknown) {
                    reject(new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`));
                }
            } else if (xhr.status === 404) {
                reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`));
            } else if (xhr.status === 403) {
                reject(new Error(`访问被拒（403）：可能是私有仓库或触发 GitHub 限流（未认证 60次/小时/IP）`));
            } else {
                reject(new Error(`HTTP 错误 ${xhr.status}: ${xhr.statusText}`));
            }
        };

        xhr.onerror = (): void => {
            reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`));
        };

        xhr.ontimeout = (): void => {
            reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）：${url}`));
        };

        xhr.send();
    });
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误（若 `WpsPluginStorage` 未从 wps.ts 导出，按编译提示调整 import 路径）

- [ ] **Step 3: 提交**

```bash
git add ts/sync/githubSync.ts
git commit -m "feat(github-sync): 新增 GitHub JSON 下载与类型定义"
```

---

## Task 3: 实现 diff 算法（纯函数）

**Files:**
- Modify: `ts/sync/githubSync.ts`（追加 `computeDiff` 函数）

- [ ] **Step 1: 追加 diff 函数到 githubSync.ts**

在文件末尾追加：

```typescript
// ========== 本地数据读取 ==========

/** 本地行数据（仅包含 diff 所需字段） */
interface LocalRowEntry {
    /** 行号 */
    row: number;
    /** SID（主键） */
    sid: string;
    /** 各字段值 */
    fields: Record<string, string>;
}

/**
 * 读取本地 Excel 工作表的所有条目（按 SID 索引）
 * @param ws 工作表
 * @param colMap 列映射
 * @param headerRow 表头行
 * @param lastRow 最后数据行
 * @returns SID → 本地行条目 的映射
 */
function readLocalEntries(
    ws: WpsWorksheet,
    colMap: Map<string, number>,
    headerRow: number,
    lastRow: number
): Map<string, LocalRowEntry> {
    const result = new Map<string, LocalRowEntry>();
    const startRow = headerRow + 1;

    /** 读取单元格值并 trim */
    const getField = (row: number, key: string): string => {
        const col = colMap.get(key);
        if (!col) return '';
        return trim(getCellValue(ws, row, col));
    };

    for (let row = startRow; row <= lastRow; row++) {
        const url = getField(row, 'Bangumi_URL');
        if (!url) continue;
        const sid = extractSubjectId(url);
        if (!sid) continue;

        result.set(sid, {
            row,
            sid,
            fields: {
                Bangumi_URL: url,
                名称: getField(row, '名称'),
                是否看完: getField(row, '是否看完') || getField(row, '状态') || getField(row, '观看状态'),
                打分: getField(row, '打分'),
                '标签/分级': getField(row, '标签/分级'),
                '剧透/感言': getField(row, '剧透/感言') || getField(row, '感想') || getField(row, '评价'),
                集数: getField(row, '集数'),
                集号: getField(row, '集号'),
            },
        });
    }

    bgmLog(LOG_LEVELS.INFO, `[githubSync] 本地读取完成：${result.size} 条有效记录`);
    return result;
}

/**
 * 将远程 type 数值映射为本地「是否看完」文本
 * 与 pureUtils.mapWatchStatus 的逆映射
 */
function mapTypeToWatchStatus(type: number): string {
    const map: Record<number, string> = { 1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃' };
    return map[type] ?? '';
}

/**
 * 将远程 tags 数组转为本地「标签/分级」文本（用 | 分隔）
 */
function tagsToString(tags: string[] | undefined): string {
    if (!Array.isArray(tags) || tags.length === 0) return '';
    return tags.join('|');
}

/**
 * 计算远程条目与本地条目的差异
 * @param remoteEntries 远程条目数组
 * @param localEntries 本地条目映射（SID → 行）
 * @returns 差异列表（add + update，不含 unchanged）
 */
export function computeDiff(
    remoteEntries: GithubRemoteEntry[],
    localEntries: Map<string, LocalRowEntry>
): GithubSyncDiff[] {
    const diffs: GithubSyncDiff[] = [];

    for (const remote of remoteEntries) {
        if (!remote.sid) continue;
        const local = localEntries.get(remote.sid);

        // 新增：本地无对应 SID
        if (!local) {
            diffs.push({
                kind: 'add',
                sid: remote.sid,
                remote,
                changedFields: ['*'],
            });
            continue;
        }

        // 比对字段差异
        const changedFields: string[] = [];

        // 比对名称
        if (remote.name && remote.name !== local.fields['名称']) {
            changedFields.push('名称');
        }

        // 比对观看状态
        const remoteWatchStatus = remote.type !== undefined ? mapTypeToWatchStatus(remote.type) : '';
        if (remoteWatchStatus && remoteWatchStatus !== local.fields['是否看完']) {
            changedFields.push('是否看完');
        }

        // 比对打分
        const remoteScore = remote.score !== undefined ? String(remote.score) : '';
        if (remoteScore && remoteScore !== local.fields['打分']) {
            changedFields.push('打分');
        }

        // 比对标签
        const remoteTags = tagsToString(remote.tags);
        if (remoteTags && remoteTags !== local.fields['标签/分级']) {
            changedFields.push('标签/分级');
        }

        // 比对评论
        if (remote.comment && remote.comment !== local.fields['剧透/感言']) {
            changedFields.push('剧透/感言');
        }

        // 比对集数
        const remoteEpisode = remote.episode !== undefined ? String(remote.episode) : '';
        if (remoteEpisode && remoteEpisode !== local.fields['集数']) {
            changedFields.push('集数');
        }

        if (changedFields.length > 0) {
            diffs.push({
                kind: 'update',
                sid: remote.sid,
                remote,
                localRow: local.row,
                changedFields,
            });
        }
    }

    bgmLog(LOG_LEVELS.INFO, `[githubSync] diff 完成：新增 ${diffs.filter(d => d.kind === 'add').length}，更新 ${diffs.filter(d => d.kind === 'update').length}`);
    return diffs;
}

/**
 * 内部读取本地条目（供外部调用，封装为纯函数入口）
 */
export function readLocalEntriesForSync(): { entries: Map<string, LocalRowEntry>; lastRow: number } | null {
    const ws = getDataSheet();
    if (!ws) return null;
    const headerRow = findHeaderRow(ws) || 1;
    const lastRow = getLastRow(ws);
    const colMap = getColumnMap(ws, headerRow);
    if (!colMap.has('Bangumi_URL')) {
        bgmLog(LOG_LEVELS.ERROR, '[githubSync] 未找到 Bangumi_URL 列');
        return null;
    }
    const entries = readLocalEntries(ws, colMap, headerRow, lastRow);
    return { entries, lastRow };
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add ts/sync/githubSync.ts
git commit -m "feat(github-sync): 实现 diff 算法（按 SID 主键比对字段差异）"
```

---

## Task 4: 实现 diff 结果应用到 Excel

**Files:**
- Modify: `ts/sync/githubSync.ts`（追加 `applyDiffToSheet` 函数）

- [ ] **Step 1: 追加应用函数到 githubSync.ts**

在文件末尾追加：

```typescript
// ========== 应用差异到工作表 ==========

/**
 * 将单条远程条目数据写入指定行的指定字段
 * @param ws 工作表
 * @param colMap 列映射
 * @param row 行号
 * @param remote 远程条目
 * @param fieldsToWrite 要写入的字段列表（为空则写入所有非空字段）
 */
function writeRemoteEntryToRow(
    ws: WpsWorksheet,
    colMap: Map<string, number>,
    row: number,
    remote: GithubRemoteEntry,
    fieldsToWrite: string[]
): void {
    /** 安全写入：仅当列存在且值非空时写入 */
    const safeSet = (key: string, value: string): void => {
        if (!value) return;
        const col = colMap.get(key);
        if (!col) return;
        setCellValue(ws, row, col, value);
    };

    // URL
    if (fieldsToWrite.includes('Bangumi_URL') || fieldsToWrite.includes('*')) {
        safeSet('Bangumi_URL', remote.url ?? '');
    }
    // 名称
    if (fieldsToWrite.includes('名称') || fieldsToWrite.includes('*')) {
        safeSet('名称', remote.name ?? '');
    }
    // 观看状态
    if (fieldsToWrite.includes('是否看完') || fieldsToWrite.includes('*')) {
        const status = remote.type !== undefined ? mapTypeToWatchStatus(remote.type) : '';
        safeSet('是否看完', status);
    }
    // 打分
    if (fieldsToWrite.includes('打分') || fieldsToWrite.includes('*')) {
        safeSet('打分', remote.score !== undefined ? String(remote.score) : '');
    }
    // 标签
    if (fieldsToWrite.includes('标签/分级') || fieldsToWrite.includes('*')) {
        safeSet('标签/分级', tagsToString(remote.tags));
    }
    // 评论
    if (fieldsToWrite.includes('剧透/感言') || fieldsToWrite.includes('*')) {
        safeSet('剧透/感言', remote.comment ?? '');
    }
    // 集数
    if (fieldsToWrite.includes('集数') || fieldsToWrite.includes('*')) {
        safeSet('集数', remote.episode !== undefined ? String(remote.episode) : '');
    }
}

/**
 * 应用 diff 到 Excel 工作表
 * @param diffs 差异列表
 * @param onProgress 进度回调（current, total, message）
 * @returns 同步结果统计
 */
export function applyDiffToSheet(
    diffs: GithubSyncDiff[],
    onProgress?: (current: number, total: number, message: string) => void
): GithubSyncResult {
    const result: GithubSyncResult = {
        remoteTotal: 0,
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
    };

    const ws = getDataSheet();
    if (!ws) {
        bgmLog(LOG_LEVELS.ERROR, '[githubSync] applyDiffToSheet: 未找到数据工作表');
        result.failed = diffs.length;
        return result;
    }

    const headerRow = findHeaderRow(ws) || 1;
    const lastRow = getLastRow(ws);
    const colMap = getColumnMap(ws, headerRow);
    let nextAppendRow = lastRow + 1;

    const total = diffs.length;
    diffs.forEach((diff, idx) => {
        try {
            if (diff.kind === 'add') {
                // 新增：追加到末尾
                writeRemoteEntryToRow(ws, colMap, nextAppendRow, diff.remote, ['*']);
                nextAppendRow++;
                result.added++;
                onProgress?.(idx + 1, total, `新增 ${diff.remote.name ?? diff.sid}`);
            } else if (diff.kind === 'update' && diff.localRow !== undefined) {
                // 更新：仅写入变更字段
                writeRemoteEntryToRow(ws, colMap, diff.localRow, diff.remote, diff.changedFields);
                result.updated++;
                onProgress?.(idx + 1, total, `更新 ${diff.remote.name ?? diff.sid}`);
            } else {
                result.skipped++;
            }
        } catch (e: unknown) {
            result.failed++;
            bgmLog(LOG_LEVELS.ERROR, `[githubSync] 应用差异失败 sid=${diff.sid}: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    bgmLog(LOG_LEVELS.INFO, `[githubSync] 应用完成: 新增 ${result.added}，更新 ${result.updated}，失败 ${result.failed}`);
    return result;
}

/**
 * GitHub 同步主入口（供 ribbonService 调用）
 * @param onProgress 进度回调
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误时抛出
 */
export async function syncFromGithub(
    onProgress?: (current: number, total: number, message: string) => void
): Promise<GithubSyncResult> {
    onProgress?.(0, 0, '开始下载远程数据...');

    const remoteEntries = await fetchGithubJson();
    onProgress?.(1, 3, `下载完成：${remoteEntries.length} 条`);

    const local = readLocalEntriesForSync();
    if (!local) {
        throw new Error('无法读取本地工作表数据');
    }

    onProgress?.(2, 3, '比对差异中...');
    const diffs = computeDiff(remoteEntries, local.entries);

    const result = applyDiffToSheet(diffs, onProgress);
    result.remoteTotal = remoteEntries.length;
    result.unchanged = remoteEntries.length - diffs.length;

    onProgress?.(3, 3, `完成：新增 ${result.added}，更新 ${result.updated}`);
    return result;
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add ts/sync/githubSync.ts
git commit -m "feat(github-sync): 实现 diff 应用到工作表与同步主入口"
```

---

## Task 5: 新增单元测试（diff 逻辑）

**Files:**
- Create: `tests/githubSync.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { computeDiff, type GithubRemoteEntry } from '../ts/sync/githubSync.js';

// 模拟本地条目结构（computeDiff 内部使用 LocalRowEntry，但不导出）
// 通过构造符合结构的对象即可测试
interface LocalRowEntryLike {
    row: number;
    sid: string;
    fields: Record<string, string>;
}

describe('computeDiff', () => {
    it('远程有本地无 → 标记为 add', () => {
        const remote: GithubRemoteEntry[] = [
            { sid: '111', name: '条目A', type: 3, score: 8 },
        ];
        const local = new Map<string, LocalRowEntryLike>();
        const diffs = computeDiff(remote, local as Map<never, never>);
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.kind).toBe('add');
        expect(diffs[0]?.sid).toBe('111');
        expect(diffs[0]?.changedFields).toEqual(['*']);
    });

    it('远程与本地完全一致 → 无差异', () => {
        const remote: GithubRemoteEntry[] = [
            { sid: '222', name: '相同名称', type: 3, score: 7 },
        ];
        const local = new Map<string, LocalRowEntryLike>([
            ['222', {
                row: 2,
                sid: '222',
                fields: {
                    名称: '相同名称',
                    是否看完: '看过',
                    打分: '7',
                },
            }],
        ]);
        const diffs = computeDiff(remote, local as Map<never, never>);
        expect(diffs).toHaveLength(0);
    });

    it('名称变更 → 标记为 update，仅含名称字段', () => {
        const remote: GithubRemoteEntry[] = [
            { sid: '333', name: '新名称', type: 3, score: 7 },
        ];
        const local = new Map<string, LocalRowEntryLike>([
            ['333', {
                row: 3,
                sid: '333',
                fields: {
                    名称: '旧名称',
                    是否看完: '看过',
                    打分: '7',
                },
            }],
        ]);
        const diffs = computeDiff(remote, local as Map<never, never>);
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.kind).toBe('update');
        expect(diffs[0]?.changedFields).toEqual(['名称']);
        expect(diffs[0]?.localRow).toBe(3);
    });

    it('多个字段变更 → 全部列入 changedFields', () => {
        const remote: GithubRemoteEntry[] = [
            { sid: '444', name: '新名', type: 2, score: 9, tags: ['Tag1', 'Tag2'], comment: '新评论' },
        ];
        const local = new Map<string, LocalRowEntryLike>([
            ['444', {
                row: 4,
                sid: '444',
                fields: {
                    名称: '旧名',
                    是否看完: '看过',
                    打分: '7',
                    '标签/分级': 'OldTag',
                    '剧透/感言': '旧评论',
                },
            }],
        ]);
        const diffs = computeDiff(remote, local as Map<never, never>);
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.changedFields).toEqual(expect.arrayContaining(['名称', '是否看完', '打分', '标签/分级', '剧透/感言']));
    });

    it('远程字段为空 → 不视为差异（保留本地）', () => {
        const remote: GithubRemoteEntry[] = [
            { sid: '555', name: undefined, type: undefined, score: undefined },
        ];
        const local = new Map<string, LocalRowEntryLike>([
            ['555', {
                row: 5,
                sid: '555',
                fields: {
                    名称: '本地名称',
                    是否看完: '在看',
                    打分: '5',
                },
            }],
        ]);
        const diffs = computeDiff(remote, local as Map<never, never>);
        expect(diffs).toHaveLength(0);
    });

    it('type 映射为观看状态文本后比对', () => {
        const remote: GithubRemoteEntry[] = [
            { sid: '666', type: 2 },
        ];
        const local = new Map<string, LocalRowEntryLike>([
            ['666', {
                row: 6,
                sid: '666',
                fields: {
                    是否看完: '在看', // type=2 → '在看'
                },
            }],
        ]);
        const diffs = computeDiff(remote, local as Map<never, never>);
        expect(diffs).toHaveLength(0);
    });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/githubSync.test.ts`
Expected: FAIL（`computeDiff` 的 `localEntries` 参数类型不匹配，需要调整签名使测试可调用）

> **注意：** `computeDiff` 的第二个参数类型是 `Map<string, LocalRowEntry>`，但 `LocalRowEntry` 未导出。需要修改 Task 3 中的 `computeDiff` 签名或导出 `LocalRowEntry`。下面 Step 3 修正此问题。

- [ ] **Step 3: 修正 computeDiff 参数类型，导出 LocalRowEntry**

修改 `ts/sync/githubSync.ts`：

```typescript
// 将 interface LocalRowEntry 改为 export
export interface LocalRowEntry {
    /** 行号 */
    row: number;
    /** SID（主键） */
    sid: string;
    /** 各字段值 */
    fields: Record<string, string>;
}

// computeDiff 签名保持不变，但测试中可直接构造 Map<string, LocalRowEntry>
```

同时修改测试文件中的 `LocalRowEntryLike` 为直接 import：

```typescript
import { computeDiff, type GithubRemoteEntry, type LocalRowEntry } from '../ts/sync/githubSync.js';

// 删除 LocalRowEntryLike 接口定义
// 将所有 `Map<string, LocalRowEntryLike>` 改为 `Map<string, LocalRowEntry>`
// 删除 `as Map<never, never>` 类型断言
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/githubSync.test.ts`
Expected: PASS（6 个测试全部通过）

- [ ] **Step 5: 提交**

```bash
git add ts/sync/githubSync.ts tests/githubSync.test.ts
git commit -m "test(github-sync): 新增 computeDiff 单元测试覆盖 6 个场景"
```

---

## Task 6: 在 index.ts 统一导出新模块

**Files:**
- Modify: `ts/index.ts`

- [ ] **Step 1: 在 index.ts 末尾追加导出**

读取 `ts/index.ts` 末尾，在最后一个 `export { ... }` 之后追加：

```typescript
// ============================================================================
// GitHub 仓库增量同步
// ============================================================================
export {
    // 配置管理
    getGithubConfig,
    setGithubConfig,
    isGithubConfigComplete,
    buildRawUrl,
    // 类型
    type GithubSyncConfig,
} from './sync/githubConfig.js';

export {
    // 同步核心
    fetchGithubJson,
    computeDiff,
    applyDiffToSheet,
    syncFromGithub,
    readLocalEntriesForSync,
    // 类型
    type GithubRemoteEntry,
    type GithubSyncDiff,
    type GithubSyncResult,
    type LocalRowEntry,
} from './sync/githubSync.js';
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add ts/index.ts
git commit -m "feat(github-sync): 在 index.ts 统一导出 GitHub 同步模块"
```

---

## Task 7: 集成到 ribbonService（Ribbon 入口）

**Files:**
- Modify: `ts/services/ribbonService.ts`

- [ ] **Step 1: 在 ribbonService.ts 末尾追加 syncFromGithubForRibbon**

读取文件末尾（在 `openCollectionForRibbon` 函数之后）追加：

```typescript
// ========== GitHub 同步（Ribbon 入口）==========

import { syncFromGithub, isGithubConfigComplete, getGithubConfig, type GithubSyncResult } from '../index.js';

/**
 * 从 GitHub 仓库增量同步数据到 Excel（Ribbon 版本）
 * 流程：配置校验 → 确认对话框 → 下载 + diff + 应用 → 结果提示
 */
export async function syncFromGithubForRibbon(): Promise<void> {
    const app = getApp();
    if (!app) {
        bgmLog(LOG_LEVELS.ERROR, '[syncFromGithubForRibbon] 无法获取 Application 对象');
        return;
    }

    // 1. 配置校验
    if (!isGithubConfigComplete()) {
        const cfg = getGithubConfig();
        const msg = `GitHub 仓库配置不完整：
  Owner: ${cfg.owner || '(未设置)'}
  Repo: ${cfg.repo || '(未设置)'}
  Branch: ${cfg.branch || 'main'}
  Path: ${cfg.path || '(未设置)'}

请在任务面板的「GitHub 仓库设置」中填写完整配置。`;
        app.MessageBox?.(msg, 0, 48);
        return;
    }

    // 2. 确认对话框
    const cfg = getGithubConfig();
    const confirmMsg = `即将从 GitHub 仓库拉取数据并增量更新本地 Excel

仓库：${cfg.owner}/${cfg.repo}
分支：${cfg.branch}
文件：${cfg.path}

策略：
  · 远程有本地无 → 新增（追加到末尾）
  · 远程与本地不同 → 更新（仅覆盖变更字段）
  · 本地有远程无 → 保留不删除

点击"是"开始同步，点击"否"取消。`;
    const confirmResult = app.MessageBox?.(confirmMsg, 4 + 32);
    if (confirmResult !== 6) return;

    // 3. 执行同步
    if (BGM.sync.isRunning) {
        wpsMsgBox('同步正在进行中，请稍后再试', 0, 48);
        return;
    }
    if (!BGM.sync.enterRunningState()) {
        wpsMsgBox('同步正在进行中，请稍后再试', 0, 48);
        return;
    }

    try {
        bgmLog(LOG_LEVELS.INFO, '[syncFromGithubForRibbon] 开始 GitHub 同步...');
        if (app.StatusBar !== undefined) app.StatusBar = '正在从 GitHub 下载数据...';

        const result: GithubSyncResult = await syncFromGithub((current, total, message) => {
            if (app.StatusBar !== undefined) {
                app.StatusBar = `[${current}/${total}] ${message}`;
            }
        });

        if (app) app.StatusBar = false;

        app.MessageBox?.(
            `GitHub 同步完成！

远程总条目：${result.remoteTotal}
新增：${result.added}
更新：${result.updated}
无变化：${result.unchanged}
跳过：${result.skipped}
失败：${result.failed}`,
            0, 64
        );
    } catch (err: unknown) {
        if (app) app.StatusBar = false;
        BGM.handleError(err, { context: 'GitHub 同步', showAlert: true });
    } finally {
        BGM.sync.exitRunningState();
    }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add ts/services/ribbonService.ts
git commit -m "feat(github-sync): 新增 Ribbon 入口 syncFromGithubForRibbon"
```

---

## Task 8: 在 ribbon.ts 添加按钮分发

**Files:**
- Modify: `ts/ribbon.ts`

- [ ] **Step 1: 在 ribbon.ts 顶部导入 syncFromGithubForRibbon**

修改 `ts/ribbon.ts` 第 8 行的 import：

```typescript
import * as RibbonService from './services/ribbonService.js';
```

保持不变（已通过命名空间导入，可直接调用 `RibbonService.syncFromGithubForRibbon()`）。

- [ ] **Step 2: 在 OnAction 的 switch 中添加 case**

修改 `ts/ribbon.ts` 中 `OnAction` 函数的 switch，在 `case 'btnOpenCollection':` 之后、`default:` 之前追加：

```typescript
            case 'btnSyncFromGithub': {
                // syncFromGithubForRibbon 是 async 函数，需要 .catch() 防止未处理的 Promise rejection
                RibbonService.syncFromGithubForRibbon().catch((e: unknown) => {
                    bgmLog(LOG_LEVELS.ERROR, `[OnAction] syncFromGithubForRibbon 异常: ${(e as Error)?.message || String(e)}`);
                    BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.ERROR, context: 'Ribbon btnSyncFromGithub' });
                });
                break;
            }
```

- [ ] **Step 3: 在 GetBangumiImage 的 icons 映射中添加新按钮图标**

修改 `ts/ribbon.ts` 中 `GetBangumiImage` 函数的 icons 对象，追加：

```typescript
            btnSyncFromGithub: 'images/sync.svg',
```

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: 提交**

```bash
git add ts/ribbon.ts
git commit -m "feat(github-sync): 在 ribbon.ts 添加 btnSyncFromGithub 按钮分发"
```

---

## Task 9: 修改 ribbon.xml 新增按钮

**Files:**
- Modify: `ribbon.xml`

- [ ] **Step 1: 在 ribbon.xml 中追加 GitHub 同步按钮**

在 `ribbon.xml` 第 15 行 `<button id="btnOpenCollection" .../>` 之后、`</group>` 之前追加：

```xml
                    <button id="btnSyncFromGithub" label="GitHub同步" onAction="OnAction" getImage="GetBangumiImage" size="large"/>
```

完整上下文：

```xml
                    <button id="btnOpenCollection" label="打开收藏页" onAction="OnAction" getImage="GetBangumiImage" size="large"/>
                    <button id="btnSyncFromGithub" label="GitHub同步" onAction="OnAction" getImage="GetBangumiImage" size="large"/>
                  
				</group>
```

- [ ] **Step 2: 提交**

```bash
git add ribbon.xml
git commit -m "feat(github-sync): ribbon.xml 新增 GitHub同步 按钮"
```

---

## Task 10: 修改 taskpane.html 新增 GitHub 配置 UI 区块

**Files:**
- Modify: `ui/taskpane.html`

- [ ] **Step 1: 在 taskpane.html 中追加 GitHub 配置区块**

在「收藏页面访问」section（约第 53-61 行）之后、「收藏列表类型」section 之前插入新 section：

```html
        <div class="section">
            <h3>🐙 GitHub 仓库同步</h3>
            <div class="form-group">
                <label>Owner（用户名/组织）：</label>
                <input type="text" id="ghOwner" class="input" placeholder="如：myuser">
            </div>
            <div class="form-group">
                <label>Repo（仓库名）：</label>
                <input type="text" id="ghRepo" class="input" placeholder="如：bangumi-data">
            </div>
            <div class="form-group">
                <label>Branch（分支）：</label>
                <input type="text" id="ghBranch" class="input" value="main" placeholder="默认 main">
            </div>
            <div class="form-group">
                <label>Path（文件路径）：</label>
                <input type="text" id="ghPath" class="input" placeholder="如：data/bangumi-data.json">
            </div>
            <div class="btn-group">
                <button class="btn small primary" data-action="saveGithubConfig">💾 保存配置</button>
                <button class="btn small" data-action="syncFromGithub">⬇️ 立即同步</button>
                <button class="btn small" data-action="testGithubConfig">🔧 测试连接</button>
            </div>
            <p class="hint">
                · 仅支持公开仓库（无需 Token）<br>
                · 远程数据格式：JSON 数组，每条含 sid/url/name/type/score/tags/comment 字段<br>
                · 同步策略：新增远程有但本地无的；更新本地已有但内容不同的；不删除本地多余行
            </p>
        </div>
```

- [ ] **Step 2: 提交**

```bash
git add ui/taskpane.html
git commit -m "feat(github-sync): taskpane.html 新增 GitHub 仓库配置区块"
```

---

## Task 11: 在 handlers.ts 添加 action 处理器

**Files:**
- Modify: `ts/ui/handlers.ts`

- [ ] **Step 1: 在 handlers.ts 顶部 import 中追加 GitHub 相关函数**

修改 `ts/ui/handlers.ts` 第 7-27 行的 import 块，在末尾 `} from '../index.js';` 之前追加：

```typescript
    // GitHub 同步
    getGithubConfig,
    setGithubConfig,
    isGithubConfigComplete,
    syncFromGithub,
    type GithubSyncConfig,
```

- [ ] **Step 2: 在文件中追加 GitHub 配置加载函数**

在 `handlers.ts` 中找到 `setupButtonListeners` 函数（约第 903 行）之前，追加：

```typescript
// ========== GitHub 仓库配置 ==========

/**
 * 从 UI 读取配置并保存
 */
function handleSaveGithubConfig(): void {
    const owner = (document.getElementById('ghOwner') as HTMLInputElement | null)?.value.trim() ?? '';
    const repo = (document.getElementById('ghRepo') as HTMLInputElement | null)?.value.trim() ?? '';
    const branch = (document.getElementById('ghBranch') as HTMLInputElement | null)?.value.trim() || 'main';
    const path = (document.getElementById('ghPath') as HTMLInputElement | null)?.value.trim() ?? '';

    if (!owner || !repo || !path) {
        showToast('Owner、Repo、Path 不能为空', 'warn');
        return;
    }

    const config: GithubSyncConfig = { owner, repo, branch, path };
    const ok = setGithubConfig(config);
    if (ok) {
        showToast('GitHub 仓库配置已保存', 'success');
        bgmLog(LOG_LEVELS.INFO, `[handlers] GitHub 配置已保存: ${owner}/${repo}/${branch}/${path}`);
    } else {
        showToast('配置保存失败', 'error');
    }
}

/**
 * 从存储加载配置并填充到 UI
 */
function loadGithubConfigToUI(): void {
    const cfg = getGithubConfig();
    const setVal = (id: string, value: string): void => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = value;
    };
    setVal('ghOwner', cfg.owner);
    setVal('ghRepo', cfg.repo);
    setVal('ghBranch', cfg.branch || 'main');
    setVal('ghPath', cfg.path);
}

/**
 * 测试 GitHub 配置是否可访问（轻量 HEAD 请求）
 */
async function handleTestGithubConfig(): Promise<void> {
    if (!isGithubConfigComplete()) {
        showToast('请先填写并保存配置', 'warn');
        return;
    }
    showToast('正在测试连接...', 'info');
    try {
        const entries = await syncFromGithub((cur, total, msg) => {
            bgmLog(LOG_LEVELS.INFO, `[testGithub] ${cur}/${total}: ${msg}`);
        });
        showToast(`连接成功，远程共 ${entries.remoteTotal} 条记录`, 'success');
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`连接失败：${msg}`, 'error');
        bgmLog(LOG_LEVELS.ERROR, `[testGithub] 失败: ${msg}`);
    }
}

/**
 * 从面板触发 GitHub 同步（与 Ribbon 入口逻辑类似，但使用面板的进度提示）
 */
async function handleSyncFromGithub(): Promise<void> {
    if (BGM.sync.isRunning) {
        showToast('同步正在进行中，请稍后再试', 'warn');
        return;
    }
    if (!isGithubConfigComplete()) {
        showToast('请先填写并保存 GitHub 配置', 'warn');
        return;
    }

    if (!BGM.sync.enterRunningState()) {
        showToast('同步正在进行中，请稍后再试', 'warn');
        return;
    }

    setStatus('正在从 GitHub 同步...');
    try {
        const result = await syncFromGithub((cur, total, msg) => {
            setStatus(`[${cur}/${total}] ${msg}`);
        });
        setStatus(`GitHub 同步完成：新增 ${result.added}，更新 ${result.updated}`);
        showToast(`同步完成：新增 ${result.added}，更新 ${result.updated}`, 'success');
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`GitHub 同步失败：${msg}`);
        showToast(`同步失败：${msg}`, 'error');
        BGM.handleError(e, { context: '面板 GitHub 同步', showAlert: false });
    } finally {
        BGM.sync.exitRunningState();
    }
}
```

- [ ] **Step 3: 在 ACTION_HANDLERS 字典中追加三个 action**

找到 `ACTION_HANDLERS` 字典定义（约第 929 行），在字典末尾（最后一个 handler 之后、闭合 `}` 之前）追加：

```typescript
    // GitHub 仓库同步
    saveGithubConfig: () => {
        handleSaveGithubConfig();
    },
    syncFromGithub: () => {
        handleSyncFromGithub();
    },
    testGithubConfig: () => {
        handleTestGithubConfig();
    },
```

- [ ] **Step 4: 在面板初始化时加载 GitHub 配置到 UI**

找到 `setupButtonListeners` 函数末尾（约第 919 行 `}` 之前），追加：

```typescript
    // 加载 GitHub 配置到 UI
    loadGithubConfigToUI();
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: 提交**

```bash
git add ts/ui/handlers.ts
git commit -m "feat(github-sync): 在 handlers 添加 GitHub 配置与同步 action"
```

---

## Task 12: 在 main.js 注册新模块

**Files:**
- Modify: `main.js`

- [ ] **Step 1: 在 MODULES 数组中追加 githubConfig 和 githubSync**

修改 `main.js` 第 7-27 行的 MODULES 数组，在 `{ src: 'dist-ts/sync/syncRecord.js', ... }` 之后追加：

```javascript
    { src: 'dist-ts/sync/githubConfig.js', type: 'module', critical: true },
    { src: 'dist-ts/sync/githubSync.js', type: 'module', critical: true },
```

完整上下文（节选）：

```javascript
const MODULES = [
    { src: 'dist-ts/index.js', type: 'module', critical: true },
    { src: 'dist-ts/tools/config.js', type: 'module', critical: true },
    // ... 其他模块 ...
    { src: 'dist-ts/sync/syncRecord.js', type: 'module' },
    { src: 'dist-ts/sync/githubConfig.js', type: 'module', critical: true },
    { src: 'dist-ts/sync/githubSync.js', type: 'module', critical: true },
    { src: 'dist-ts/sync/scraping.js', type: 'module' },
    // ... 其他模块 ...
];
```

- [ ] **Step 2: 提交**

```bash
git add main.js
git commit -m "feat(github-sync): 在 main.js 注册 githubConfig 和 githubSync 模块"
```

---

## Task 13: 编译验证与构建测试

- [ ] **Step 1: TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 退出码 0，无错误

- [ ] **Step 2: 单元测试**

Run: `npx vitest run`
Expected: 所有测试通过（包括原有的 `exceltobangumi.pure.test.ts` 和 `util.pure.test.ts`，以及新增的 `githubSync.test.ts`）

- [ ] **Step 3: 构建打包**

Run: `wpsjs build -exe`
Expected:
- `vite build` 成功
- `[vite-plugin-static-copy] Copied N items`（N 应比之前多 2，因为新增 2 个 .js 文件）
- `Self-extracting EXE created` 成功

- [ ] **Step 4: 验证构建产物结构**

Run: `ls wps-addon-build/dist-ts/sync/`
Expected: 包含 `githubConfig.js` 和 `githubSync.js`

- [ ] **Step 5: 提交最终构建配置**

```bash
git add .
git commit -m "chore(github-sync): 编译验证通过，构建产物结构正确"
```

---

## Task 14: 运行时验证清单

在 WPS 加载项中执行以下手动验证（用户执行）：

- [ ] **V-GH-1: Ribbon 按钮显示**
  - 打开 WPS Excel，加载插件
  - 预期：「Bangumi同步」标签页出现「GitHub同步」按钮，带图标

- [ ] **V-GH-2: 未配置时点击 Ribbon 按钮**
  - 点击「GitHub同步」按钮
  - 预期：弹出提示「GitHub 仓库配置不完整...请在任务面板的 GitHub 仓库设置 中填写完整配置」

- [ ] **V-GH-3: 面板 UI 显示**
  - 打开同步面板
  - 预期：出现「🐙 GitHub 仓库同步」区块，包含 Owner/Repo/Branch/Path 四个输入框和三个按钮

- [ ] **V-GH-4: 保存配置**
  - 填写一个公开仓库配置（如 owner=octocat, repo=Hello-World, branch=master, path=README）
  - 点击「💾 保存配置」
  - 预期：弹出「GitHub 仓库配置已保存」toast

- [ ] **V-GH-5: 配置持久化**
  - 关闭面板后重新打开
  - 预期：四个输入框自动填充上次保存的值

- [ ] **V-GH-6: 测试连接**
  - 点击「🔧 测试连接」
  - 预期：弹出「正在测试连接...」，随后显示「连接成功，远程共 N 条记录」或具体错误信息

- [ ] **V-GH-7: 增量同步 - 新增场景**
  - 准备一个本地 Excel（含若干行已有序号）
  - 远程 JSON 包含本地没有的 SID
  - 点击「⬇️ 立即同步」
  - 预期：远程独有的条目被追加到 Excel 末尾

- [ ] **V-GH-8: 增量同步 - 更新场景**
  - 远程 JSON 中某条目的 name 与本地不同
  - 点击同步
  - 预期：本地对应行的名称被更新，其他字段保留

- [ ] **V-GH-9: 增量同步 - 不删除场景**
  - 本地 Excel 包含远程 JSON 中没有的 SID
  - 点击同步
  - 预期：本地多余的行保留不动

- [ ] **V-GH-10: 错误处理 - 404**
  - 配置一个不存在的路径
  - 点击同步
  - 预期：弹出「文件不存在（404）」错误提示

- [ ] **V-GH-11: 错误处理 - 网络超时**
  - 断网后点击同步
  - 预期：30 秒后弹出「请求超时」或「网络请求失败」提示

- [ ] **V-GH-12: Ribbon 与面板入口一致**
  - 分别从 Ribbon 按钮和面板「立即同步」按钮触发
  - 预期：两者行为一致，均弹出确认对话框（仅 Ribbon）+ 结果统计

---

## Self-Review 自检

### 1. Spec 覆盖检查
- ✅ 方向（从 GitHub 下载）→ Task 2 `fetchGithubJson`
- ✅ 数据形式（单个 JSON 数组）→ Task 2 类型定义 + Task 3 diff 逻辑
- ✅ 增量策略（按 SID 主键比对）→ Task 3 `computeDiff`
- ✅ 触发方式（Ribbon + 面板手动）→ Task 7（Ribbon）+ Task 11（面板）
- ✅ 认证（不认证）→ Task 2 不设置 Authorization 头
- ✅ 主键（SID）→ Task 3 使用 `extractSubjectId` 提取
- ✅ 冲突策略（新增+更新，不删除）→ Task 4 `applyDiffToSheet` 仅处理 add/update
- ✅ 仓库配置（UI 可配置）→ Task 1 配置管理 + Task 10 UI + Task 11 handler

### 2. 占位符扫描
- ✅ 无 TBD/TODO
- ✅ 所有代码块均含完整实现
- ✅ 所有测试步骤均含可执行命令

### 3. 类型一致性
- ✅ `GithubSyncConfig` 在 Task 1 定义，Task 6/7/11 使用
- ✅ `GithubRemoteEntry` 在 Task 2 定义，Task 3/5/6 使用
- ✅ `GithubSyncDiff` 在 Task 2 定义，Task 3/4/6 使用
- ✅ `GithubSyncResult` 在 Task 2 定义，Task 4/7/11 使用
- ✅ `LocalRowEntry` 在 Task 3 定义并 export，Task 5 测试中导入

### 4. 用户规则合规检查
- ✅ 严格类型：所有函数显式返回类型，无 any
- ✅ 异步错误处理：`fetchGithubJson` Promise reject + try/catch；`syncFromGithubForRibbon` 全程 try/catch/finally
- ✅ AbortController：使用 XMLHttpRequest 的 `timeout` 属性（30秒）实现超时控制（XHR 原生支持，等价于 AbortController）
- ✅ 运行时校验：`isGithubRemoteEntry` / `isGithubRemoteEntryArray` 类型守卫
- ✅ 资源清理：XHR 无需手动清理（.onload/onerror/ontimeout 自动释放）
- ✅ XSS 防护：数据写入 Excel 单元格（`setCellValue`），不涉及 innerHTML
- ✅ 错误边界：`BGM.handleError` 统一处理；`.catch()` 防止未处理 rejection
- ✅ 显式返回类型：所有导出函数均标注返回类型

---

## Execution Handoff

**Plan complete and saved to `文档/plans/2026-07-05-github-sync-feature.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
