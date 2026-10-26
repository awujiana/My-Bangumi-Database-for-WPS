/**
 * @fileoverview 分片数据源的清单解析、按需选片与按行拼接（纯函数模块）
 * @module sync/shardManifest
 * @description 数据仓库的数据文件已从「单片 `data/bangumi.jsonlines.gz`」改为
 *              「按字段类别切 6 片 + 一份清单 `data/anime.manifest.json`」：
 *
 *              - `anime.base.jsonlines.gz`       7 列   subjectId/name/name_original/updatedAt/date/meta_tags/nsfw
 *              - `anime.meta.jsonlines.gz`      20 列   infobox 解析出的 19 个中文列
 *              - `anime.relations.jsonlines.gz`  3 列   关联条目ID（全部）/ 关联的动漫ID（只含 type=2）
 *              - `anime.stats.jsonlines.gz`      8 列   platform/series/score/rank/score_details/favorite/tags
 *              - `anime.summary.jsonlines.gz`    2 列   简介
 *              - `anime.infobox.jsonlines.gz`    2 列   infobox 原文
 *
 *              切片动机（实测）：infobox 占 47.6%、summary 占 29.4%，两个长文本字段
 *              就占了全部体积的 77%；而 Excel 实际用到的 28 列压缩后只有 3.42 MiB
 *              （相对旧单片 −83.6%）。只要简介的场景没必要把 infobox 一起拖下来。
 *
 * 本模块**零项目依赖**（除纯函数模块 githubSyncDiff 的类型与映射表），可在 Node
 * 测试环境中直接运行，不触发 index.ts → handlers.ts 的 document 副作用链。
 *
 * ## 拼接约定
 *
 * 每片都带 `sid`（唯一连接键），且**行序与 dump 完全一致**，所以按**行号**即可拼接，
 * 不需要建索引、也不要求 subjectId 可比较大小。除 `sid` 外各片字段两两不重叠，因此
 * 「后写覆盖前写」在这里只是防御性检查，正常数据不会触发。
 */
import { EXTENDED_FIELD_MAP, getExcelAliases } from './github-sync-diff.js';
/**
 * 拼接时必须存在的字段
 *
 * - `sid`：唯一连接键，没有它无法与其它片对齐；
 * - `updatedAt`：同步时间筛选与「最近更新」展示都依赖它；
 * - `name`：写入 Excel 名称列的依据。
 *
 * 三者都在 `base` 片里，因此 `base` 是**必选**、不可取消。
 */
export const REQUIRED_FIELDS = ['sid', 'updatedAt', 'name'];
/**
 * 判定「必选分片」的锚点字段
 *
 * 注意**不能**用 `sid` 做判据：每片都带 `sid`（它是连接键），拿它判会让所有片
 * 都变成必选、选片彻底失效。`updatedAt` / `name` 只出现在承载基础信息的片里
 * （当前是 `base`），才是正确锚点。
 */
const REQUIRED_SHARD_ANCHORS = ['updatedAt', 'name'];
/** 支持的最小格式版本 */
const SUPPORTED_FORMAT_VERSION = 1;
/**
 * 解析一行/一段 JSON；失败返回 undefined
 *
 * `JSON.parse` 对合法输入最坏返回 `null`，所以 `undefined` 可以安全地当失败哨兵。
 */
function tryParseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/**
 * 类型守卫：判断未知值是否为纯字符串数组
 */
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
/**
 * 判断某个未知值是否是合法的分片描述
 */
function isShardDescriptor(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    if (typeof candidate.name !== 'string' || candidate.name === '')
        return false;
    if (typeof candidate.file !== 'string' || candidate.file === '')
        return false;
    if (!Array.isArray(candidate.fields) || candidate.fields.length === 0)
        return false;
    return candidate.fields.every((field) => typeof field === 'string');
}
/**
 * 解析清单文本
 *
 * 结构非法、版本不认识、或没有任何分片时返回 null（由调用方决定如何降级）。
 * 不抛异常：调用方通常处在「先试清单、失败则回退旧单片」的分支里。
 *
 * @param text 清单 JSON 文本
 * @returns 解析结果；不可用时为 null
 */
export function parseShardManifest(text) {
    if (!text || typeof text !== 'string')
        return null;
    const raw = tryParseJson(text);
    if (typeof raw !== 'object' || raw === null)
        return null;
    const candidate = raw;
    const { formatVersion: version, shards, recordCount } = candidate;
    if (typeof version !== 'number' || version > SUPPORTED_FORMAT_VERSION)
        return null;
    if (!Array.isArray(shards) || shards.length === 0)
        return null;
    if (!shards.every(isShardDescriptor))
        return null;
    if (typeof recordCount !== 'number' || recordCount < 0)
        return null;
    return {
        formatVersion: version,
        subjectType: typeof candidate.subjectType === 'number' ? candidate.subjectType : 0,
        typeLabel: typeof candidate.typeLabel === 'string' ? candidate.typeLabel : '',
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
        recordCount,
        shards: shards.map((shard) => {
            const descriptor = {
                name: shard.name,
                file: shard.file,
                fields: [...shard.fields],
            };
            if (typeof shard.bytes === 'number')
                descriptor.bytes = shard.bytes;
            if (typeof shard.sha256 === 'string')
                descriptor.sha256 = shard.sha256;
            return descriptor;
        }),
    };
}
/**
 * 判断一个配置路径指向的是清单而不是数据文件
 *
 * 认 `.json` 结尾（`anime.manifest.json`）。下载层只用它做**前置校验**：
 * 指向旧单片（`.jsonlines.gz`）时直接给出明确报错，而不是拿二进制去 `JSON.parse`
 * 再抛一个莫名其妙的解析错误。
 *
 * @param path 仓库内相对路径
 * @returns 是清单返回 true
 */
export function isManifestPath(path) {
    return path.trim().toLowerCase().endsWith('.json');
}
/**
 * 把清单同目录下的文件名解析成完整仓库内路径
 *
 * 清单里的 `file` 只写文件名（如 `anime.base.jsonlines.gz`），所以取清单路径的
 * 目录部分拼接。这样数据仓库把 data/ 改名或挪位置都不需要改插件。
 *
 * @param manifestPath 清单在仓库内的路径（如 data/anime.manifest.json）
 * @param fileName 清单里声明的文件名
 * @returns 仓库内相对路径
 */
export function resolveSiblingPath(manifestPath, fileName) {
    const normalized = manifestPath.replaceAll('\\', '/');
    const slash = normalized.lastIndexOf('/');
    const directory = slash === -1 ? '' : normalized.slice(0, slash + 1);
    return `${directory}${fileName.replaceAll('\\', '/')}`;
}
/**
 * 取某分片必须下载的字段集合（供按表头选片使用）
 *
 * @param manifest 清单
 * @returns 字段名 → 分片名 的映射（同名字段只保留首次出现的分片）
 */
export function buildFieldIndex(manifest) {
    const index = new Map();
    for (const shard of manifest.shards) {
        for (const field of shard.fields) {
            if (!index.has(field))
                index.set(field, shard.name);
        }
    }
    return index;
}
/**
 * 按「需要的字段」挑出要下载的分片
 *
 * 规则：
 * 1. **必选片**（含 subjectId/updatedAt/name 的片，通常是 base）永远选中 —— 否则拼不出记录；
 * 2. 其余片按「该片的字段与 neededFields 有交集」选中；
 * 3. `manual` 非空时以它为准（用户在界面上多选/取消的结果），但仍会补上必选片；
 * 4. `neededFields` 传 `undefined` 表示**无法判断**（例如读不到工作表表头）→ 全选，
 *    这是保守兜底；传空集合才表示「确实一个都不需要」，此时只下必选片。
 *
 * @param manifest 清单
 * @param neededFields 本次同步真正会用到的字段（来自用户表格的表头）；undefined = 全选
 * @param manual 用户手动指定的分片名；为空数组或 undefined 表示按表头自动选
 * @returns 选中的分片（按清单顺序）
 */
export function selectShards(manifest, neededFields, manual) {
    const needed = neededFields === undefined ? null : new Set(neededFields);
    const manualSet = manual && manual.length > 0 ? new Set(manual) : null;
    const isRequired = (shard) => shard.fields.some((field) => REQUIRED_SHARD_ANCHORS.includes(field));
    // 出现在两片以上的字段是**连接键**（当前只有 subjectId）。它不能参与「需要这个字段」的
    // 匹配 —— 否则每片都含 subjectId，任何非空 neededFields 都会把全部片选中，选片直接失效。
    const occurrences = new Map();
    for (const shard of manifest.shards) {
        for (const field of shard.fields) {
            occurrences.set(field, (occurrences.get(field) ?? 0) + 1);
        }
    }
    const isConnectorField = (field) => (occurrences.get(field) ?? 0) > 1;
    const picked = manifest.shards.filter((shard) => {
        if (isRequired(shard))
            return true;
        if (manualSet)
            return manualSet.has(shard.name);
        // 无法判断需要哪些字段时全选（保守），避免「表头读不到 → 数据缺列」
        if (!needed)
            return true;
        return shard.fields.some((field) => !isConnectorField(field) && needed.has(field));
    });
    // 清单里一片都没有必选字段时，至少保住第一片，避免拼出空记录
    if (picked.length === 0) {
        const first = manifest.shards.at(0);
        return first ? [first] : [];
    }
    return picked;
}
/**
 * 根据用户表格的实际列名推导出「需要用到的 JSONL 字段」
 *
 * 依据 {@link EXTENDED_FIELD_MAP}（JSONL 字段 → Excel 列名）与列名别名反向匹配：
 * 表里有这一列才需要这个字段。另外始终加上 {@link REQUIRED_FIELDS}，
 * 以及 `话数`/`meta_tags`（它们写入「集数」「标签/分级」列，有独立的处理逻辑，
 * 不在映射表里）。
 *
 * @param columns 表格表头（列名数组）
 * @returns 需要的 JSONL 字段名集合
 */
export function neededFieldsForColumns(columns) {
    const present = new Set(columns.map((column) => column.trim()));
    const needed = new Set(REQUIRED_FIELDS);
    for (const [jsonlField] of EXTENDED_FIELD_MAP) {
        const candidates = getExcelAliases(jsonlField);
        const names = candidates.length > 0 ? candidates : [jsonlField];
        if (names.some((name) => present.has(name))) {
            needed.add(jsonlField);
        }
    }
    // 独立处理的列（不在 EXTENDED_FIELD_MAP 中）
    if (present.has('集数'))
        needed.add('话数');
    if (present.has('标签/分级'))
        needed.add('meta_tags');
    return needed;
}
/**
 * 把多个分片按行号拼成完整记录
 *
 * 校验（任一不满足即返回错误，不产出半成品）：
 * - 各片行数必须一致（不一致说明有一片是别的期次或下载被截断）；
 * - 除 `sid` 外同一字段不得出现在两片（出现了说明清单与实际数据不符）；
 * - 每行长度必须与该片表头一致。
 *
 * @param shards 已解析的分片
 * @returns 成功为 { entries }；失败为 { errors }
 */
export function joinShardRows(shards) {
    if (shards.length === 0) {
        return { errors: ['没有可拼接的分片'] };
    }
    const expected = shards[0]?.rows.length ?? 0;
    for (const shard of shards) {
        if (shard.rows.length !== expected) {
            return {
                errors: [
                    `各分片行数不一致：${shards[0]?.name ?? '?'} 有 ${String(expected)} 行，` +
                        `${shard.name} 有 ${String(shard.rows.length)} 行（可能是不同期次或下载不完整）`,
                ],
            };
        }
    }
    const errors = [];
    const owner = new Map();
    for (const shard of shards) {
        for (const field of shard.fields) {
            const previous = owner.get(field);
            if (previous !== undefined && field !== 'sid') {
                errors.push(`字段 ${field} 同时出现在 ${previous} 与 ${shard.name} 两片`);
            }
            owner.set(field, shard.name);
        }
    }
    if (errors.length > 0)
        return { errors };
    const entries = [];
    for (let rowIndex = 0; rowIndex < expected; rowIndex += 1) {
        entries.push(mergeRowAt(shards, rowIndex, errors));
    }
    return errors.length > 0 ? { errors } : { entries };
}
/**
 * 把各分片的第 rowIndex 行合并成一条记录
 *
 * 行长度与表头不符时记一条错误并跳过该片（其余片照常合并），
 * 这样错误信息能一次列全，而不是在第一次不匹配时就中断。
 *
 * @param shards 已解析的分片
 * @param rowIndex 行号（0-based）
 * @param errors 收集错误的数组（原地追加）
 * @returns 合并后的记录（可能有字段缺失，此时 errors 非空）
 */
function mergeRowAt(shards, rowIndex, errors) {
    const record = {};
    for (const shard of shards) {
        const { fields } = shard;
        const row = shard.rows[rowIndex] ?? [];
        if (row.length === fields.length) {
            // 下标直取（性能审计 2026-10-24 P3：31k 行 × ~20 字段 ≈ 62 万次调用，
            // .at() 比下标慢 2-3 倍；行长度已校验等于表头长，不存在越界）
            for (const [column, field] of fields.entries()) {
                record[field] = row[column];
            }
        }
        else {
            errors.push(`${shard.name} 第 ${String(rowIndex + 1)} 行长度 ${String(row.length)} ` +
                `与表头 ${String(fields.length)} 不符`);
        }
    }
    return record;
}
/**
 * 把单片的 JSONL 文本解析成 { fields, rows }
 *
 * 与 `parseJsonl` 的两段式约定一致（首行表头、其后等长值数组），但**不要求
 * 含 subjectId**：`meta` / `stats` 等片靠行号对齐，不需要自身校验主键（校验由
 * {@link joinShardRows} 统一做）。
 *
 * @param name 分片短名（仅用于错误信息）
 * @param text 分片 JSONL 文本
 * @returns 解析结果；首行不是合法表头时返回 null
 */
export function parseShardText(name, text) {
    const lines = [];
    for (const raw of text.split(/\r\n|\r|\n/)) {
        const trimmed = raw.trim();
        if (trimmed)
            lines.push(trimmed);
    }
    const headerLine = lines.at(0);
    if (!headerLine)
        return null;
    const header = tryParseJson(headerLine);
    if (!isStringArray(header))
        return null;
    const fields = header;
    const rows = [];
    for (const line of lines.slice(1)) {
        const parsed = tryParseJson(line);
        // 单行坏掉就跳过：与 parseJsonl 的「非法行不中断整体解析」保持一致
        if (Array.isArray(parsed) && parsed.length === fields.length) {
            rows.push(parsed);
        }
    }
    return { name, fields, rows };
}
