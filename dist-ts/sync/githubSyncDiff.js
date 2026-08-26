/**
 * @fileoverview GitHub 同步差异计算（纯函数模块）
 * @module sync/githubSyncDiff
 * @description 提供 GitHub 远程条目与本地 Excel 行的差异计算逻辑。
 *
 * 本模块为零依赖纯函数模块，不导入任何项目模块（避免触发 index.ts → handlers.ts
 * 的 document 副作用链），可在 Node 测试环境中直接运行。
 *
 * type 字段约定（与 Bangumi 一致）：
 *   1=想看  2=在看  3=看过  4=搁置  5=抛弃
 */
/**
 * 扩展字段映射表：JSONL 字段名 → Excel 标准字段名（colMap key）
 *
 * 用于 computeDiff 比对和 writeRemoteEntryToRow 写入扩展字段。
 *
 * 特殊处理（不在此表中）：
 * - '话数' 写入「集数」列（有独立处理逻辑）
 * - 'meta_tags' 写入「标签/分级」列（有独立处理逻辑）
 * - 'nsfw' 无明确 Excel 列映射，暂不处理
 */
export const EXTENDED_FIELD_MAP = [
    ['date', '开播日期'],
    ['播放结束', '完播日'],
    ['动画制作公司', '制作公司'],
    ['片长', '时长'],
    ['制片国家', '制片国家'],
    ['语言', '语言'],
    ['类型', '类型'],
    ['导演', '导演'],
    ['音乐', '音乐'],
    ['人物设定', '人物设定'],
    ['机械设定', '机械设定'],
    ['原作', '原作'],
    ['脚本', '脚本'],
    ['分镜', '分镜'],
    ['演出', '演出'],
    ['原案', '原案'],
    ['系列构成', '系列构成'],
    ['在线播放平台', '在线播放平台'],
    ['关联的动漫ID', '关联的动漫ID'],
];
/**
 * JSONL 字段 → Excel 列名别名映射
 *
 * 用于处理一个 JSONL 字段可能对应多个 Excel 列名的情况。
 * 目前仅用于「动画制作公司」：本地可能使用「制作公司」或「动画制作公司」作为列名，
 * 远程仓库统一使用「动画制作公司」字段。
 *
 * - 比对时：本地任一列名存在且与远程值不同均视为差异
 * - 写入时：同时写入所有存在的列（避免丢失本地另一列的数据）
 */
const JSONL_FIELD_EXCEL_ALIASES = {
    动画制作公司: ['制作公司', '动画制作公司'],
};
/**
 * 获取指定 JSONL 字段对应的所有 Excel 列名（含主映射和别名）
 *
 * @param jsonlField JSONL 字段名
 * @returns Excel 列名数组（至少包含 1 个元素）
 */
export function getExcelAliases(jsonlField) {
    const mapped = EXTENDED_FIELD_MAP.find(([jf]) => jf === jsonlField);
    const primary = mapped ? [mapped[1]] : [];
    const aliases = JSONL_FIELD_EXCEL_ALIASES[jsonlField] ?? [];
    // 合并去重：主映射在前，别名在后
    const seen = new Set();
    const result = [];
    for (const name of [...primary, ...aliases]) {
        if (!seen.has(name)) {
            seen.add(name);
            result.push(name);
        }
    }
    return result;
}
/**
 * 将远程扩展字段值转为字符串用于比对
 * @param value 远程字段值（string | number | undefined）
 * @returns 字符串表示；undefined/null/空字符串 → ''
 */
function toExtStringValue(value) {
    if (value === undefined || value === null)
        return '';
    if (typeof value === 'number')
        return String(value);
    return value;
}
/** 策略中文标签映射（供 UI 下拉框使用） */
export const SYNC_STRATEGY_LABELS = Object.freeze({
    'add-update': '新增+更新（不删除）',
    'add-only': '仅新增',
    'update-only': '仅更新',
    mirror: '镜像同步（含删除）',
    'force-overwrite': '强制覆盖',
});
/**
 * 将远程 tags 数组转为本地「标签/分级」文本（用 | 分隔）
 */
export function tagsToString(tags) {
    if (!Array.isArray(tags) || tags.length === 0)
        return '';
    return tags.join('|');
}
/**
 * 类型守卫：判断未知值是否为 GithubRemoteEntry
 */
export function isGithubRemoteEntry(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'sid' in value &&
        typeof value.sid === 'string');
}
/**
 * 解析 JSONL 文本为 GithubRemoteEntry 数组
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象，无外层数组括号，无逗号分隔。
 * 空行与首尾空白会被忽略；非法行的行号会被收集到 errors 中但不中断整体解析。
 *
 * @param text JSONL 原始文本
 * @returns 解析结果：{ entries: 合法条目; errors: 非法行信息（1-based 行号+原因） }
 */
export function parseJsonl(text) {
    const entries = [];
    const errors = [];
    if (!text || typeof text !== 'string') {
        return { entries, errors };
    }
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const raw = lines[i];
        if (raw === undefined)
            continue;
        const trimmed = raw.trim();
        if (!trimmed)
            continue; // 空行跳过
        try {
            const obj = JSON.parse(trimmed);
            if (isGithubRemoteEntry(obj)) {
                entries.push(obj);
            }
            else {
                errors.push({ line: lineNum, reason: '对象缺少 sid 字段或 sid 不是字符串' });
            }
        }
        catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            errors.push({ line: lineNum, reason });
        }
    }
    return { entries, errors };
}
/**
 * 季度范围定义（按日本动漫季度划分）
 *
 * - 1月新番：上年12月 — 本年2月
 * - 4月新番：3月 — 5月
 * - 7月新番：6月 — 8月
 * - 10月新番：9月 — 11月
 */
const QUARTER_MONTH_RANGES = {
    1: [12, 1, 2], // 1月新番：上年12月、本年1月、本年2月
    4: [3, 4, 5], // 4月新番：3月、4月、5月
    7: [6, 7, 8], // 7月新番：6月、7月、8月
    10: [9, 10, 11], // 10月新番：9月、10月、11月
};
/**
 * 按时间筛选远程条目
 *
 * 根据 {@link SyncTimeFilter} 配置，基于远程条目的 `date` 字段（开播日期）
 * 进行年份/季度/月份筛选，或筛选预告/未来动漫（无开播日期）。
 * 日期格式支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等。
 *
 * 特殊模式：
 * - future: 筛选无开播日期的条目（预告/未来动漫）
 *
 * 季度规则：
 * - 1月新番（Q1）：上年12月 + 本年1月 + 本年2月
 * - 4月新番（Q2）：3月 + 4月 + 5月
 * - 7月新番（Q3）：6月 + 7月 + 8月
 * - 10月新番（Q4）：9月 + 10月 + 11月
 *
 * @param entries 远程条目数组
 * @param filter 时间筛选配置
 * @returns 筛选后的条目数组
 */
export function filterByTime(entries, filter) {
    if (!filter.enabled || filter.range === 'all')
        return entries;
    // 预告/未来动漫筛选：无开播日期的条目
    if (filter.range === 'future') {
        return entries.filter((entry) => !entry.date || entry.date.trim() === '');
    }
    return entries.filter((entry) => {
        if (!entry.date || entry.date.trim() === '')
            return false;
        // 解析日期：支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等格式
        const match = String(entry.date).match(/^(\d{4})[-/.](\d{1,2})/);
        if (!match)
            return false;
        const yearStr = match[1];
        const monthStr = match[2];
        if (!yearStr || !monthStr)
            return false;
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        if (isNaN(year) || isNaN(month))
            return false;
        switch (filter.range) {
            case 'year':
                // 按年份筛选：匹配给定年份的任意月份
                return year === filter.year;
            case 'quarter': {
                // 按季度筛选
                const qMonths = QUARTER_MONTH_RANGES[filter.quarter ?? 1];
                if (!qMonths)
                    return false;
                if (!qMonths.includes(month))
                    return false;
                // 处理季度跨年：1月新番的12月属于上年
                if (month === 12)
                    return year === filter.year - 1;
                return year === filter.year;
            }
            case 'month':
                // 按月份筛选
                return year === filter.year && month === (filter.month ?? 1);
            default:
                return false;
        }
    });
}
/**
 * 检查日期字符串是否匹配时间筛选条件
 *
 * 用于 mirror 策略下判断本地条目是否在筛选范围内，
 * 避免因远程数据被时间筛选过滤而导致本地条目被误删。
 *
 * 对于 'future' 模式，所有本地条目都被视为在筛选范围内（保留不删除），
 * 因为预告/未来筛选仅影响远程数据下载，不影响本地已有数据。
 *
 * @param dateStr 日期字符串（本地格式如"2015年12月15日"或远程格式"2015-12-15"）
 * @param filter 时间筛选配置
 * @returns true 表示在筛选范围内
 */
function matchTimeFilter(dateStr, filter) {
    // 预告/未来模式：所有本地条目都保留
    if (filter.range === 'future')
        return true;
    // 支持本地"YYYY年MM月DD日"格式和远程"YYYY-MM-DD"格式
    const match = String(dateStr).match(/(\d{4})[-/.年](\d{1,2})/);
    if (!match)
        return false;
    const yearStr = match[1];
    const monthStr = match[2];
    if (!yearStr || !monthStr)
        return false;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month))
        return false;
    switch (filter.range) {
        case 'year':
            return year === filter.year;
        case 'quarter': {
            const qMonths = QUARTER_MONTH_RANGES[filter.quarter ?? 1];
            if (!qMonths)
                return false;
            if (!qMonths.includes(month))
                return false;
            if (month === 12)
                return year === filter.year - 1;
            return year === filter.year;
        }
        case 'month':
            return year === filter.year && month === (filter.month ?? 1);
        default:
            return true;
    }
}
/**
 * 计算远程条目与本地条目的差异（按指定策略）
 *
 * 比对规则（基础）：
 * - 远程有、本地无 → add（changedFields = ['*']）
 * - 远程与本地 SID 相同 → 逐字段比对，任一字段不同则 update
 * - 远程字段为 undefined/空 → 不视为差异（保留本地值）
 * - 远程 meta_tags 数组用 | 拼接后比对
 * - 远程「话数」转为字符串后比对
 *
 * 策略修饰：
 * - add-update: 基础规则（add + update，无 delete）
 * - add-only: 仅返回 add，已存在的 SID 全部跳过
 * - update-only: 仅返回 update，本地不存在的 SID 全部跳过
 * - mirror: 基础规则 + 本地存在但远程不存在的 SID 标记为 delete
 * - force-overwrite: 已存在的 SID 强制标记为 update（changedFields = ['*']），
 *                    远程空值也会覆盖本地（applyDiffToSheet 中处理）
 *
 * @param remoteEntries 远程条目数组
 * @param localEntries 本地条目映射（SID → 行）
 * @param strategy 同步策略，默认 'add-update'
 * @returns 差异列表（按策略包含 add/update/delete，不含 unchanged）
 */
export function computeDiff(remoteEntries, localEntries, strategy = 'add-update', timeFilter) {
    const diffs = [];
    const remoteSids = new Set();
    for (const remote of remoteEntries) {
        if (!remote.sid)
            continue;
        remoteSids.add(remote.sid);
        const local = localEntries.get(remote.sid);
        // 新增：本地无对应 SID
        if (!local) {
            // update-only 策略：跳过新增
            if (strategy === 'update-only')
                continue;
            diffs.push({
                kind: 'add',
                sid: remote.sid,
                remote,
                changedFields: ['*'],
            });
            continue;
        }
        // add-only 策略：已存在的 SID 全部跳过
        if (strategy === 'add-only')
            continue;
        // force-overwrite 策略：无视字段比对，全部标记为 update
        if (strategy === 'force-overwrite') {
            diffs.push({
                kind: 'update',
                sid: remote.sid,
                remote,
                localRow: local.row,
                changedFields: ['*'],
            });
            continue;
        }
        // 比对字段差异（add-update / mirror 策略走此分支）
        const changedFields = [];
        // 比对 Bangumi_URL（从 sid 构造的派生字段，确保 URL 列总是被正确更新）
        // 仅当本地存在 Bangumi_URL 字段时才比对（列映射中包含该列）
        const expectedUrl = `https://bgm.tv/subject/${remote.sid}`;
        if ('Bangumi_URL' in local.fields) {
            const localUrl = local.fields['Bangumi_URL'];
            if (localUrl !== expectedUrl) {
                changedFields.push('Bangumi_URL');
            }
        }
        // 比对名称
        if (remote.name && remote.name !== local.fields['名称']) {
            changedFields.push('名称');
        }
        // 比对标签（使用 meta_tags）
        const remoteTags = tagsToString(remote.meta_tags);
        if (remoteTags && remoteTags !== local.fields['标签/分级']) {
            changedFields.push('标签/分级');
        }
        // 比对集数（使用 infobox 的「话数」）
        const remoteEpisodeValue = remote['话数'] ?? '';
        if (remoteEpisodeValue && remoteEpisodeValue !== local.fields['集数']) {
            changedFields.push('集数');
        }
        // 比对扩展字段（EXTENDED_FIELD_MAP 中定义的 19 个字段）
        // 对于有多个 Excel 列名的字段（如「动画制作公司」→「制作公司」/「动画制作公司」），
        // 任一列存在且与远程值不同都视为差异。
        const comparedFields = new Set();
        for (const [jsonlField] of EXTENDED_FIELD_MAP) {
            const remoteValue = remote[jsonlField];
            if (remoteValue === undefined || remoteValue === null)
                continue;
            const remoteStr = toExtStringValue(remoteValue);
            const excelAliases = getExcelAliases(jsonlField);
            for (const excelField of excelAliases) {
                if (comparedFields.has(excelField))
                    continue;
                if (remoteStr && remoteStr !== (local.fields[excelField] ?? '')) {
                    changedFields.push(excelField);
                    comparedFields.add(excelField);
                }
            }
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
    // mirror 策略：本地存在但远程不存在的 SID 标记为 delete
    if (strategy === 'mirror') {
        for (const [sid, local] of localEntries) {
            if (!remoteSids.has(sid)) {
                // 时间筛选启用时：本地条目的开播日期不在筛选范围内的，跳过 delete
                // 避免因时间筛选过滤了远程数据，导致本地其他时间段的数据被误删
                if (timeFilter?.enabled && timeFilter.range !== 'all') {
                    const localDate = local.fields['开播日期'];
                    if (!localDate || !matchTimeFilter(localDate, timeFilter))
                        continue;
                }
                diffs.push({
                    kind: 'delete',
                    sid,
                    localRow: local.row,
                    changedFields: ['*'],
                });
            }
        }
    }
    return diffs;
}
