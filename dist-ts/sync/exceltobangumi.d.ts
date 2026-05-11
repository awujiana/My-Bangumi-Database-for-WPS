/**
 * @fileoverview Excel到Bangumi同步模块
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
/**
 * 同步选项接口
 *
 * @interface SyncOptions
 */
interface SyncOptions {
    onProgress?: (current: number, total: number, message: string) => void;
    onItemComplete?: (row: number, success: boolean, result: {
        code: number;
        message: string;
    }) => void;
    skipSids?: Set<string>;
    incremental?: boolean;
}
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
 * 打开用户收藏页面
 *
 * @function openUserCollection
 */
export declare function openUserCollection(): void;
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
 * 将观看状态文本转换为Bangumi API数值
 *
 * @function mapWatchStatus
 * @param {string} status - 观看状态文本
 * @returns {number} API数值：0=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
 *
 * @description
 * 支持的状态文本映射：
 * - 看过/看完/已看/完/completed → 3
 * - 在看/在看动画/在追/追/watching → 2
 * - 想看/想看动画/否/wish → 0
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
export declare function addTagsFromStr(tagSet: Set<string>, tagsRaw: string): void;
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
 * 获取筛选状态
 *
 * @function getFilterStatus
 * @param {number} [lastRow] - 最后一行行号
 * @returns {{ hasFilter: boolean; visibleRows: number[]; hiddenRows: number[] }} 筛选状态
 *
 * @description
 * 检测工作表是否启用了筛选，并返回可见行和隐藏行的行号数组
 */
/**
 * 获取筛选状态（可见行列表）
 * @param lastRow  可选扫描上限，默认取工作表最大行数
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export declare function getFilterStatus(lastRow?: number, headerRow?: number): {
    hasFilter: boolean;
    visibleRows: number[];
    hiddenRows: number[];
};
/**
 * 根据D列序列号获取连续的有效行
 *
 * @function getSequentialRowsBySeqCol
 * @param {number} startRow - 起始行
 * @param {number} endRow - 结束行
 * @returns {{ validRows: number[]; seqMap: Map<string, number> }} 有效行和序列号映射
 *
 * @description
 * 扫描D列（序列号列），找出有序列号的数据行。
 * 序列号格式应为数字，用于标记同步进度。
 */
export declare function getSequentialRowsBySeqCol(startRow: number, endRow: number): {
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
 * 清除当前活动工作表的 D 列颜色标记（与 clearSheetMarksInSheet 相同，但作用于活动工作表）清除所有行的颜色标记
 */
export declare function clearRowColors(): void;
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
 * @returns {Promise<{ success: number; fail: number; skip: number }>} 同步结果统计
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
 * 异步批量同步 Excel 数据到 Bangumi
 * - 支持筛选状态下仅处理可见行
 * - 批量读取单元格数据，提高性能
 * - 动态请求间隔，避免限制的同时提升速度
 * - 支持跳过冲突条目（通过 skipSids 集合）
 * - 跳过已上传条目（D列颜色）
 * - 统一错误处理，带详细日志
 *
 * @param ws 工作表对象
 * @param colMap 列名到列号的映射 Map
 * @param token Bangumi API 访问令牌
 * @param lastRow 数据区域最后一行
 * @param headerRow 表头行号
 * @param options 可选项（onProgress, onItemComplete, skipSids 回调）
 * @returns 同步结果统计 { success, fail, skip }
 */
/**
 * 异步批量同步 Excel 数据到 Bangumi（优化版）
 * - 支持筛选状态下仅处理可见行
 * - 批量读取单元格数据，提高性能
 * - 动态请求间隔，避免限制的同时提升速度
 * - 支持跳过冲突条目（通过 skipSids 集合）
 * - 支持增量同步：根据历史指纹自动跳过无变化条目，并在成功后更新指纹
 * - 统一错误处理，带详细日志
 *
 * @param ws 工作表对象
 * @param colMap 列名到列号的映射 Map
 * @param token Bangumi API 访问令牌
 * @param lastRow 数据区域最后一行
 * @param headerRow 表头行号
 * @param options 可选项（onProgress, onItemComplete, skipSids, incremental 回调）
 * @returns 同步结果统计 { success, fail, skip }
 */
export declare function SyncToBangumiAsync(ws: any, colMap: Map<string, number>, token: string, lastRow: number, headerRow: number, options?: SyncOptions): Promise<{
    success: number;
    fail: number;
    skip: number;
}>;
/**
 * 清除指定工作表的 D 列颜色标记
 * @param sheetIndex 工作表索引
 */
export declare function clearSheetMarksInSheet(sheetIndex: number): void;
/**
 * 测试单个条目更新
 *
 * @function testSingleUpdate
 */
export declare function testSingleUpdate(): void;
export {};
//# sourceMappingURL=exceltobangumi.d.ts.map