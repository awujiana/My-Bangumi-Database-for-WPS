/**
 * @fileoverview 「 | 」分隔值合并的统一实现（零依赖叶子模块）
 * @module sync/value-merge
 * @description 收敛三份历史实现（原 `sheet-cleaning.ts` 的 mergeTagValues、
 *              原 `enrich-normalize.ts` 的 mergeTags、原 `github-time-format.ts`
 *              的 appendValueWithSeparator）。三者共同点：合并「已有值 + 新值」、
 *              按 ` | ` 连接、已存在则不重复追加；差异（分割口径、判重粒度、
 *              trim 时机）**显式保留并注明如下**，统一时不悄悄改掉任何一处的行为：
 *
 *   | 函数                     | 来源（重构前位置）              | 分割口径                        | 判重方式            | trim 时机            |
 *   | ------------------------ | ------------------------------- | ------------------------------- | ------------------- | -------------------- |
 *   | mergeTagValues           | sync/sheet-cleaning.ts:141      | 仅按 `|`（两侧空白可选）        | token 级精确相等    | 每个 token 分别 trim |
 *   | mergeTags                | sync/enrich-normalize.ts:62     | 按 `|` 及 `,、;/` 多分隔符      | token 级精确相等    | 每个 token 分别 trim |
 *   | appendValueWithSeparator | sync/github-time-format.ts:50   | 不分割（整体值语义）            | `includes` 子串判重 | 只 trim 整体值       |
 *
 * 三者的判重均**大小写敏感**；空值处理：token 级版本丢弃 trim 后为空的 token，
 * 整体值版本对空值分别走「返回对侧」的早退分支。
 *
 * 分层说明：本模块刻意保持零项目依赖（仅 import 同为纯叶子的
 * `tools/string-utilities-pure.js` 的 trim，sync → tools 为既有向下边），
 * 调用方跨 `ts/sync/` 与 `ts/ui/` 两层均可直接导入，不产生分层反向依赖，
 * 也不经过 `tools/util/index.ts` barrel（避免 barrel 整体 mock 时新导出变 undefined）。
 */
import { trim } from '../tools/string-utilities-pure.js';
/** 仅按 `|`（两侧空白可选）分割——与重构前 sheet-cleaning.ts 的 pipe 分割正则口径一致 */
const PIPE_ONLY_SEPARATOR = /\s*\|\s*/u;
/** 标签多分隔符：`|` 及 `,、;/`——与重构前 enrich-normalize.ts 的 splitTags 一致 */
const TAG_MULTI_SEPARATOR = /\s*\|\s*|\s*[,、;]\s*|\s*\/\s*/;
/**
 * 合并两个「 | 」分隔的值（保序去重）
 *
 * 语义与重构前 `sheet-cleaning.ts` 的 mergeTagValues 完全一致：
 * - 仅按 `|` 分割（不识别 `,` `;` `/` 等其它分隔符）
 * - 每个 token trim 后为空则丢弃
 * - token 级精确去重（大小写敏感、非子串）
 * - 以 ' | ' 连接
 */
export function mergeTagValues(base, extra) {
    const seen = new Set();
    const result = [];
    for (const part of [...base.split(PIPE_ONLY_SEPARATOR), ...extra.split(PIPE_ONLY_SEPARATOR)]) {
        const trimmed = part.trim();
        if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            result.push(trimmed);
        }
    }
    return result.join(' | ');
}
/**
 * 合并标签去重（多分隔符口径）
 *
 * 语义与重构前 `enrich-normalize.ts` 的 mergeTags 完全一致（沿用其 splitTags 的分割口径）：
 * - 按 `|` 及 `,、;/` 分割
 * - 每个 token trim 后为空则丢弃
 * - token 级精确去重（大小写敏感、非子串）
 * - 以 ' | '（原 TAG_SEPARATOR）连接
 */
export function mergeTags(oldTags, incomingTags) {
    const oldList = oldTags
        .split(TAG_MULTI_SEPARATOR)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    const list = incomingTags
        .split(TAG_MULTI_SEPARATOR)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    const merged = [...oldList];
    for (const tag of list) {
        if (!merged.includes(tag)) {
            merged.push(tag);
        }
    }
    return merged.join(' | ');
}
/**
 * 追加值到现有值后面，使用 ' | ' 分隔符（整体值语义）
 *
 * 语义与重构前 `github-time-format.ts` 的 appendValueWithSeparator 完全一致：
 * - 不分割：localValue / remoteValue 各作为整体处理
 * - 远程为空 → 返回本地值（不追加空值）
 * - 本地为空 → 直接返回新值
 * - 本地已包含新值（子串 includes）→ 返回本地值（避免重复）
 * - 否则 → 返回 "本地 | 新值"
 *
 * 与 mergeTagValues / mergeTags 的关键差异：判重用**子串**而非 token 精确相等，
 * 且不分割、不 trim 单个 token（只 trim 整体值）。
 */
export function appendValueWithSeparator(localValue, remoteValue) {
    const local = trim(localValue);
    const remote = trim(remoteValue);
    if (!remote)
        return local;
    if (!local)
        return remote;
    if (local.includes(remote))
        return local;
    return `${local} | ${remote}`;
}
