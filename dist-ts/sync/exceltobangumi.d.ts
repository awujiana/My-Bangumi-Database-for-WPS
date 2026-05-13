/**
 * @fileoverview Excel到Bangumi同步模块
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版，保留原注释和日志)
 */
/**
 * 打开Bangumi Token申请页面
 *
 * @function openBangumiTokenPage
 */
export declare function openBangumiTokenPage(): void;
/**
 * 测试Token有效性（Ribbon版本）
 *
 * @function testTokenValidityForRibbon
 * @param {string} [token] - 要测试的Token，不提供则自动加载
 */
export declare function testTokenValidityForRibbon(token?: string): void;
/**
 * 从URL或文本中提取Bangumi Subject ID
 *
 * @function extractSubjectId
 * @param {string} input - URL或包含ID的文本
 * @returns {string} 提取的Subject ID，失败返回空字符串
 *
 * @description
 * 支持的URL格式：
 * - https://bgm.tv/subject/123456
 * - https://bangumi.tv/subject/123456
 * - https://chii.in/subject/123456
 * - 直接输入数字ID
 *
 * @example
 * extractSubjectId('https://bgm.tv/subject/123456'); // 返回 '123456'
 * extractSubjectId('123456'); // 返回 '123456'
 */
export declare function extractSubjectId(input: string): string;
/**
 * @function mapWatchStatus
 * @param {string} status - 观看状态文本
 * @returns {number} API数值：1=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
 *
 * @description
 * 支持的状态文本映射：
 * - 想看/想看动画/否/wish → 1
 * - 在看/在看动画/在追/追/watching → 2
 * - 看过/看完/已看/完/completed → 3
 * - 搁置/暂停/on_hold → 4
 * - 抛弃/弃/弃番/drop/dropped → 5
 *
 * @example
 * mapWatchStatus('看完'); // 返回 3
 * mapWatchStatus('在看'); // 返回 2
 */
export declare function mapWatchStatus(status: string): number;
/**
 * 从字符串解析标签数组
 *
 * @function addTagsFromStr
 * @param {Set<string>} tagSet - 标签集合（输出参数）
 * @param {string} tagsRaw - 原始标签字符串
 *
 * @description
 * 标签分隔符支持：英文逗号、中文逗号、空格、分号、顿号、换行
 * 标签会被trim后加入集合，空白标签会被忽略
 *
 * @example
 * const tags = new Set<string>();
 * addTagsFromStr(tags, '治愈,日常,萌系');
 * // tags = {'治愈', '日常', '萌系'}
 */
export declare function addTagsFromStr(tagSet: Set<string>, raw: string): void;
/**
 * 构建标签数组
 *
 * @function buildTagsArray
 * @param {string} tagsRaw - 原始标签字符串
 * @returns {string[]} 标签数组
 *
 * @example
 * buildTagsArray('治愈,日常 萌系'); // 返回 ['治愈', '日常', '萌系']
 */
export declare function buildTagsArray(tagsRaw: string): string[];
/**
 * 获取筛选状态（可见行列表）
 * @param lastRow  可选扫描上限，默认取工作表最大行数
 * @param headerRow 表头行号，用于排除
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export declare function getFilterStatus(lastRow?: number, headerRow?: number): {
    hasFilter: boolean;
    visibleRows: number[];
    hiddenRows: number[];
};
/**
 * 根据序列号列获取连续的有效行
 *
 * @function getSequentialRowsBySeqCol
 * @param {number} startRow - 起始行
 * @param {number} endRow - 结束行
 * @param {Map<string, number>} [colMap] - 列映射（可选）
 * @returns {{ validRows: number[]; seqMap: Map<string, number> }} 有效行和序列号映射
 *
 * @description
 * 扫描序列号列，找出有序列号的数据行。
 * 序列号格式应为数字，用于标记同步进度。
 */
export declare function getSequentialRowsBySeqCol(startRow: number, endRow: number, colMap?: Map<string, number>): {
    validRows: number[];
    seqMap: Map<string, number>;
};
/**
 * 构建API请求的JSON Payload
 *
 * @function buildJsonPayload
 * @param {any} ws - 工作表对象
 * @param {number} rowNum - 数据行号
 * @param {Map<string, number>} colMap - 列映射
 * @param {string} finishedDate - 完播日期
 * @returns {string} JSON格式的请求体
 *
 * @description
 * 根据工作表中的数据构建Bangumi API所需的JSON格式。
 * 包含字段：type（状态）、rate（评分）、tags（标签）、
 * comment（感言）、ep（集数）、private（是否私有）
 */
export declare function buildJsonPayload(ws: any, rowNum: number, colMap: Map<string, number>, finishedDate: string): string;
/**
 * 发送Bangumi同步请求
 *
 * @function bgmRequestSync
 * @param {string} method - HTTP方法（POST/PUT/DELETE）
 * @param {string} endpoint - API端点
 * @param {string} jsonBody - JSON请求体
 * @param {string} token - API Token
 * @returns {{ code: number; message: string }} 请求结果
 */
export declare function bgmRequestSync(method: string, endpoint: string, jsonBody: string, token: string): {
    code: number;
    message: string;
};
/**
 * 设置Bangumi Token
 *
 * @function setBangumiToken
 * @param {string} token - Token字符串
 * @returns {boolean} 是否保存成功
 */
export declare function setBangumiToken(token: string): boolean;
/**
 * 异步同步到Bangumi（主同步函数）
 *
 * @async
 * @function SyncToBangumiAsync
 * @param {any} ws - 工作表对象
 * @param {Map<string, number>} colMap - 列映射
 * @param {string} token - API Token
 * @param {number} lastRow - 最后一行行号
 * @param {number} headerRow - 表头行行号
 * @param {SyncOptions} [options] - 同步选项
 * @returns {Promise<{ success: number; fail: number; skip: number; stopped: boolean }>} 同步结果统计
 *
 * @description
 * 这是主要的同步入口函数。它会：
 * 1. 获取筛选状态（如果是筛选状态则只同步可见行）
 * 2. 遍历每一行数据
 * 3. 提取Subject ID和同步信息
 * 4. 调用Bangumi API进行同步
 * 5. 标记同步结果（颜色）
 * 6. 记录同步历史
 */
/**
 * 同步选项接口
 */
export interface SyncOptions {
    /** 进度回调 */
    onProgress?: (current: number, total: number, message: string) => void;
    /** 单条完成回调 */
    onItemComplete?: (row: number, success: boolean, result: {
        code: number;
        message: string;
    }) => void;
    /** 需要跳过的SID集合（冲突处理） */
    skipSids?: Set<string>;
    /** 是否启用增量同步（基于指纹） */
    incremental?: boolean;
}
export declare function SyncToBangumiAsync(ws: any, colMap: Map<string, number>, token: string, lastRow: number, headerRow: number, options?: SyncOptions): Promise<{
    success: number;
    fail: number;
    skip: number;
    stopped: boolean;
}>;
/**
 * 测试单个条目更新
 *
 * @function testSingleUpdate
 */
export declare function testSingleUpdate(): void;
//# sourceMappingURL=exceltobangumi.d.ts.map