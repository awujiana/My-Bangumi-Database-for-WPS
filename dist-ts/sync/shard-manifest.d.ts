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
/** 清单中单个分片的描述 */
export interface ShardDescriptor {
    /** 分片短名（base / meta / …），仅用于日志与选择 */
    name: string;
    /** 数据仓库内的文件名（与清单同目录） */
    file: string;
    /** 该片包含的字段名（顺序即列序，第 1 个固定是 subjectId） */
    fields: string[];
    /** 压缩后字节数（可选，用于日志） */
    bytes?: number;
    /** 内容 sha256（可选，用于完整性校验） */
    sha256?: string;
}
/** 分片清单结构（data/anime.manifest.json） */
export interface ShardManifest {
    /** 格式版本；本模块只认 1 */
    formatVersion: number;
    /** 条目类型编号（2 = 动画） */
    subjectType: number;
    /** 类型标签（文件名前缀，如 anime） */
    typeLabel: string;
    /** 本期数据日期（YYYY-MM-DD） */
    updatedAt: string;
    /** 记录条数（各片行数一致） */
    recordCount: number;
    /** 分片列表 */
    shards: ShardDescriptor[];
}
/**
 * 拼接时必须存在的字段
 *
 * - `sid`：唯一连接键，没有它无法与其它片对齐；
 * - `updatedAt`：同步时间筛选与「最近更新」展示都依赖它；
 * - `name`：写入 Excel 名称列的依据。
 *
 * 三者都在 `base` 片里，因此 `base` 是**必选**、不可取消。
 */
export declare const REQUIRED_FIELDS: readonly string[];
/**
 * 解析清单文本
 *
 * 结构非法、版本不认识、或没有任何分片时返回 null（由调用方决定如何降级）。
 * 不抛异常：调用方通常处在「先试清单、失败则回退旧单片」的分支里。
 *
 * @param text 清单 JSON 文本
 * @returns 解析结果；不可用时为 null
 */
export declare function parseShardManifest(text: string): ShardManifest | null;
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
export declare function isManifestPath(path: string): boolean;
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
export declare function resolveSiblingPath(manifestPath: string, fileName: string): string;
/**
 * 取某分片必须下载的字段集合（供按表头选片使用）
 *
 * @param manifest 清单
 * @returns 字段名 → 分片名 的映射（同名字段只保留首次出现的分片）
 */
export declare function buildFieldIndex(manifest: ShardManifest): Map<string, string>;
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
export declare function selectShards(manifest: ShardManifest, neededFields?: Iterable<string>, manual?: readonly string[] | null): ShardDescriptor[];
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
export declare function neededFieldsForColumns(columns: readonly string[]): Set<string>;
/** 单片的解析结果（表头 + 值数组） */
export interface ShardData {
    /** 分片短名 */
    name: string;
    /** 该片表头（字段名，顺序即列序） */
    fields: string[];
    /** 值数组，每行与 fields 等长 */
    rows: unknown[][];
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
export declare function joinShardRows(shards: readonly ShardData[]): {
    entries: Record<string, unknown>[];
} | {
    errors: string[];
};
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
export declare function parseShardText(name: string, text: string): ShardData | null;
//# sourceMappingURL=shard-manifest.d.ts.map