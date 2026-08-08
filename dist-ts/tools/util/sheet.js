/**
 * 工具模块 - 工作表读取与缓存
 * @module tools/util/sheet
 * @description 批量读取范围值、表头定位、列映射、最后行检测、缓存管理。
 *              本模块对 index.js 存在循环依赖（调用 BGM/bgmLog/getApp），仅在函数体内引用，运行时安全。
 */
import { LOG_LEVELS, PANEL_CONFIG, HEADER_KEYWORDS, COLUMN_RULES } from '../../core/constants.js';
import { colNumToLetter, trim } from '../stringUtils.js';
// 循环依赖：仅在函数体内使用 BGM/bgmLog/getApp，运行时安全
import { getCellValue } from './cell.js';
import { BGM, bgmLog, getApp } from './index.js';
// 同目录子模块：getCellValue
/**
 * 批量读取工作表中指定范围的所有值，返回字符串二维数组 [行][列]
 * 如果读取失败则返回空数组，调用方应处理空数组情况
 * @param ws 工作表对象
 * @param startRow 起始行
 * @param endRow 结束行
 * @param startCol 起始列
 * @param endCol 结束列
 * @returns 字符串二维数组
 */
function isNativeCode(val) {
    if (typeof val === 'function') {
        const str = val.toString();
        return str.includes('[native code]') || str.includes('function Value()');
    }
    if (val && typeof val === 'object') {
        const obj = val;
        if (typeof obj.toString === 'function') {
            const str = obj.toString();
            return str.includes('[native code]') || str.includes('function Value()');
        }
    }
    return false;
}
function safeCellValue(cell) {
    if (cell == null)
        return '';
    if (isNativeCode(cell))
        return '';
    if (typeof cell === 'function') {
        try {
            const result = cell();
            if (isNativeCode(result))
                return '';
            return result == null ? '' : String(result);
        }
        catch {
            return '';
        }
    }
    if (cell && typeof cell === 'object') {
        const obj = cell;
        if (obj.toString) {
            const str = obj.toString();
            if (isNativeCode(str) || isNativeCode(cell))
                return '';
            return str;
        }
    }
    return String(cell);
}
export function readRangeValues(ws, startRow, endRow, startCol, endCol) {
    if (!ws)
        return [];
    try {
        const range = ws.Range(`${colNumToLetter(startCol)}${startRow}:${colNumToLetter(endCol)}${endRow}`);
        // 复用 cell.ts 中的 tryGetProperty（未导出），此处通过 range 直接访问 Value2
        const raw = range.Value2;
        if (!raw)
            return [];
        // 处理单个值的情况
        if (!Array.isArray(raw)) {
            return [[safeCellValue(raw)]];
        }
        const result = [];
        for (const row of raw) {
            if (!Array.isArray(row)) {
                result.push([safeCellValue(row)]);
            }
            else {
                result.push(row.map((cell) => safeCellValue(cell)));
            }
        }
        return result;
    }
    catch {
        return [];
    }
}
// 缓存相关（模块级 Map）
const sheetCache = new Map();
/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export function cacheGet(key, factory) {
    if (sheetCache.has(key)) {
        return sheetCache.get(key);
    }
    const value = factory();
    sheetCache.set(key, value);
    return value;
}
export function findHeaderRow(ws, startRow) {
    const sheetName = ws?.Name || '';
    const cacheKey = `${sheetName}:headerRow:${startRow || 1}`;
    return cacheGet(cacheKey, () => {
        const sRow = startRow || 1;
        for (let row = sRow; row <= PANEL_CONFIG.MAX_SCAN_ROWS; row++) {
            let matchCount = 0;
            for (let col = 1; col <= PANEL_CONFIG.MAX_SCAN_COLUMNS; col++) {
                try {
                    const cellVal = String(getCellValue(ws, row, col)).toLowerCase();
                    if (!cellVal)
                        continue;
                    for (const header of HEADER_KEYWORDS) {
                        if (cellVal.indexOf(header.toLowerCase()) >= 0) {
                            matchCount++;
                            break;
                        }
                    }
                    if (matchCount >= 3)
                        break;
                }
                catch {
                    // 忽略：此处无需处理错误
                }
            }
            if (matchCount >= 3)
                return row;
        }
        return 0;
    });
}
/**
 * 获取列名到列号的映射（优化版：正则规则数组 + 缓存）
 * @param ws 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列名 -> 列号
 */
export function getColumnMap(ws, headerRow) {
    const sheetName = ws?.Name || '';
    const cacheKey = `${sheetName}:columnMap:${headerRow}`;
    return cacheGet(cacheKey, () => {
        const colMap = new Map();
        let firstNonEmptyCol;
        const lastCol = 50;
        for (let i = 1; i <= lastCol; i++) {
            const colName = trim(String(getCellValue(ws, headerRow, i)));
            // 记录第一个非空列作为序列号列候选
            if (!firstNonEmptyCol && colName) {
                firstNonEmptyCol = i;
            }
            if (!colName)
                continue;
            for (const [pattern, key] of COLUMN_RULES) {
                if (pattern.test(colName)) {
                    if (!colMap.has(key)) {
                        colMap.set(key, i);
                        break; // 匹配到未映射的key，处理下一列
                    }
                    // 该key已被前面的列匹配，继续尝试其他规则
                }
            }
        }
        // 如果没有通过规则匹配到序列号列，尝试找一个未被其他 key 占用的列
        // 修复：避免将"序列号"映射到已被"是否看完"等字段占用的列，导致两个字段读取同一列
        if (!colMap.has('序列号')) {
            const mappedCols = new Set(colMap.values());
            let seqCol;
            if (firstNonEmptyCol && !mappedCols.has(firstNonEmptyCol)) {
                // 第一个非空列未被占用，使用它
                seqCol = firstNonEmptyCol;
            }
            else {
                // 第一个非空列已被占用，向后查找第一个未被占用的非空列
                for (let i = 1; i <= lastCol; i++) {
                    if (!mappedCols.has(i)) {
                        const v = trim(String(getCellValue(ws, headerRow, i)));
                        if (v) {
                            seqCol = i;
                            break;
                        }
                    }
                }
            }
            if (seqCol) {
                colMap.set('序列号', seqCol);
                bgmLog(LOG_LEVELS.INFO, `[getColumnMap] 序列号列未匹配到表头，使用列 ${seqCol} 作为序列号列`);
            }
        }
        return colMap;
    });
}
/** 清除指定工作表的所有缓存 */
export function clearSheetCache(ws) {
    const prefix = ws?.Name || '';
    for (const key of sheetCache.keys()) {
        if (key.startsWith(prefix))
            sheetCache.delete(key);
    }
}
/**
 * 在表头行中查找第一个匹配「序列号 / Bangumi URL / 名称 / 别名」的列索引
 * @param ws           工作表
 * @param headerRow 表头行号
 * @returns 列索引（1‑based），若未找到返回 undefined
 */
function findAnchorColumn(ws, headerRow) {
    const keywords = [
        // 序列号
        '序号',
        '编号',
        '序列号',
        '整理序号',
        'id',
        'no',
        'number',
        // Bangumi URL
        'bangumi',
        'url',
        '链接',
        '地址',
        'bgm',
        // 名称
        '名称',
        '标题',
        '作品名',
        'title',
        'name',
        // 别名
        '别名',
        '又名',
        'alias',
        'othername',
    ];
    const maxCols = 50;
    for (let c = 1; c <= maxCols; c++) {
        const val = ws.Range(`${colNumToLetter(c)}${headerRow}`).Value2;
        if (val == null)
            continue;
        const text = String(val).trim().toLowerCase();
        if (keywords.some((kw) => text === kw || text.includes(kw))) {
            return c;
        }
    }
    return undefined;
}
/**
 * 获取工作表的最后有效数据行
 * @param ws            工作表对象（WpsWorksheet）
 * @param forceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export function getLastRow(ws, forceRefresh = false, headerRow) {
    if (!ws) {
        bgmLog(LOG_LEVELS.WARN, 'getLastRow: 工作表对象无效，返回默认值 50000');
        return 50000;
    }
    const sheetName = ws.Name || '';
    const cacheKey = `${sheetName}:lastRow${headerRow ? `:hr${headerRow}` : ''}`;
    if (forceRefresh) {
        clearSheetCache(ws);
        bgmLog(LOG_LEVELS.INFO, '缓存已清除，重新计算最后行');
    }
    const cached = cacheGet(cacheKey, () => {
        bgmLog(LOG_LEVELS.INFO, `正在计算工作表 "${sheetName}" 的最后数据行（${headerRow ? '根据表头自动选择列' : '多列回退'}）...`);
        // 1. 如果提供了表头行，尝试自动选择锚定列
        if (headerRow != null && headerRow >= 1) {
            const col = findAnchorColumn(ws, headerRow);
            if (col) {
                try {
                    // ✅ 修复点：使用 col 拼地址，而不是硬编码 D
                    const colLetter = colNumToLetter(col);
                    const cell = ws.Range(`${colLetter}${ws.Rows.Count}`);
                    const endCell = cell.End(-4162);
                    if (endCell && endCell.Row > 0) {
                        bgmLog(LOG_LEVELS.INFO, `根据表头找到锚定列 ${col}(${colLetter})，最后行: ${endCell.Row}`);
                        return endCell.Row;
                    }
                }
                catch (e) {
                    bgmLog(LOG_LEVELS.WARN, `锚定列 ${col} 定位失败: ${e.message}，回退到原有逻辑`);
                }
            }
        }
        // 2. 优先 D 列（常见序号列）
        try {
            const cell = ws.Range(`D${ws.Rows.Count}`);
            const endCell = cell.End(-4162);
            if (endCell && endCell.Row > 0) {
                bgmLog(LOG_LEVELS.INFO, `D列向上定位成功，最后行: ${endCell.Row}`);
                return endCell.Row;
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `D列定位失败: ${e.message}`);
        }
        // 3. 尝试 A 列
        try {
            const cell = ws.Range(`A${ws.Rows.Count}`);
            const endCell = cell.End(-4162);
            if (endCell && endCell.Row > 0) {
                bgmLog(LOG_LEVELS.INFO, `A列向上定位成功，最后行: ${endCell.Row}`);
                return endCell.Row;
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `A列定位失败: ${e.message}`);
        }
        // 4. UsedRange 兜底
        try {
            const usedRange = ws.UsedRange;
            if (usedRange) {
                const last = usedRange.Row + usedRange.Rows.Count - 1;
                if (last > 0) {
                    bgmLog(LOG_LEVELS.INFO, `UsedRange 估算最后行: ${last}`);
                    return last;
                }
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `UsedRange 失败: ${e.message}`);
        }
        // 5. 最终默认值
        bgmLog(LOG_LEVELS.WARN, `无法确定工作表 "${sheetName}" 的最后行，使用默认值 50000`);
        return 50000;
    });
    bgmLog(LOG_LEVELS.INFO, `工作表 "${sheetName}" 最后数据行: ${cached}${sheetCache.has(cacheKey) ? ' (来自缓存)' : ' (首次计算)'}`);
    return cached;
}
export function isEmptyValue(val) {
    return (val === null ||
        val === undefined ||
        val === '' ||
        val === 'null' ||
        val === 'NULL' ||
        val === 'Null' ||
        val === 'undefined');
}
// ========== 获取数据工作表 ==========
export function getDataSheet() {
    const app = getApp();
    if (!app || !app.ActiveWorkbook)
        return null;
    bgmLog(LOG_LEVELS.INFO, `getDataSheet: isLocked=${BGM.sheet.isLocked}, lockedIndex=${BGM.sheet.lockedIndex}`);
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        try {
            const ws = app.ActiveWorkbook.Worksheets.Item(BGM.sheet.lockedIndex);
            bgmLog(LOG_LEVELS.INFO, `getDataSheet: 返回锁定的工作表: ${ws.Name}`);
            return ws;
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, 'getDataSheet 锁定工作表失败: ' + e.message);
        }
    }
    const ws = app.ActiveWorkbook.ActiveSheet;
    bgmLog(LOG_LEVELS.INFO, `getDataSheet: 返回当前活动工作表: ${ws.Name}`);
    return ws;
}
export function safeActivate(ws) {
    if (ws && typeof ws.Activate === 'function') {
        ws.Activate();
    }
    else {
        bgmLog(LOG_LEVELS.WARN, 'safeActivate: 无法激活工作表');
    }
}
