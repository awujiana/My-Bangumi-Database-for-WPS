// ts/services/ribbonService.ts
import { bgmLog, BGM, wpsMsgBox, loadBgToken, storeBgToken, getDataSheet, findHeaderRow, getLastRow, getColumnMap, extractSubjectId, mapWatchStatus, readCell, getCellValue, readRangeValues, getFilterStatus, BGM_COLOR, LOG_LEVELS, SyncToBangumiAsync, openUserCollection, clearRowColors, testTokenValidityForRibbon, fetchAllUserCollections, getCell, trim } from '../index.js';
/**
 * 获取同步预览统计（不发送请求，仅扫描 Excel）
 * @param ws 工作表对象
 * @param colMap 列映射
 * @param lastRow 数据最后一行
 * @param headerRow 表头行
 * @returns 统计信息 { total, valid, willSync, willSkip, alreadyUploaded }
 */
export function getSyncPreview(ws, colMap, lastRow, headerRow) {
    const startRow = headerRow + 1;
    let total = 0, valid = 0, willSync = 0, willSkip = 0, alreadyUploaded = 0;
    // 批量读取（与同步函数相同的列范围）
    const neededKeys = ['Bangumi_URL', '名称', '是否看完'];
    let maxCol = 1;
    for (const key of neededKeys) {
        if (colMap.has(key))
            maxCol = Math.max(maxCol, colMap.get(key));
    }
    const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol);
    // 获取可见行（与同步函数相同）
    const filterStatus = getFilterStatus(lastRow);
    let rowsToProcess = [];
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        rowsToProcess = filterStatus.visibleRows.filter(r => r >= startRow);
    }
    else {
        for (let r = startRow; r <= lastRow; r++)
            rowsToProcess.push(r);
    }
    for (const rowNum of rowsToProcess) {
        total++;
        const bgmUrl = (() => {
            if (allData) {
                const col = colMap.get('Bangumi_URL');
                if (col) {
                    const rowIdx = rowNum - startRow;
                    if (rowIdx >= 0 && rowIdx < allData.length) {
                        const rowData = allData[rowIdx];
                        if (Array.isArray(rowData) && col - 1 < rowData.length) {
                            return trim(rowData[col - 1]);
                        }
                    }
                }
            }
            return colMap.has('Bangumi_URL') ? trim(getCellValue(ws, rowNum, colMap.get('Bangumi_URL'))) : '';
        })();
        if (!bgmUrl || !extractSubjectId(bgmUrl)) {
            continue; // 无效行不计入 valid
        }
        valid++;
        // 检查是否已上传（D 列颜色）
        const seqCell = getCell(ws, rowNum, 4);
        const isUploaded = seqCell?.Interior && (seqCell.Interior.Color === BGM_COLOR.SUCCESS ||
            seqCell.Interior.Color === BGM_COLOR.LIGHT_GREEN ||
            seqCell.Interior.Color === BGM_COLOR.DARK_GREEN);
        if (isUploaded) {
            alreadyUploaded++;
            continue; // 已上传不再计入待同步或跳过
        }
        // 判断观看状态
        const watchStatus = (() => {
            const key = '是否看完';
            if (colMap.has(key)) {
                const col = colMap.get(key);
                return trim(readCell(ws, rowNum, col));
            }
            return '';
        })();
        // 空状态不计入待同步，跳过该条目
        if (!watchStatus) {
            continue;
        }
        const type = mapWatchStatus(watchStatus);
        if (type === 0) {
            willSkip++;
        }
        else {
            willSync++;
        }
    }
    return { total, valid, willSync, willSkip, alreadyUploaded };
}
/**
 * 异步检测 Excel 与 Bangumi 收藏之间的冲突
 * @returns 包含冲突条目列表及统计信息的对象
 */
export async function detectConflicts(ws, colMap, lastRow, headerRow, token) {
    const startRow = headerRow + 1;
    const conflicts = [];
    let conflictCount = 0;
    let bgmCollectionReady = false;
    // 1. 获取 Bangumi 收藏快照
    let bgmCollection = new Map();
    try {
        const collections = await fetchAllUserCollections(token);
        for (const item of collections) {
            const sid = String(item.subject_id);
            bgmCollection.set(sid, {
                type: item.type,
                rate: item.rate,
                tags: item.tags || [],
                comment: item.comment || '',
                subject_name: item.subject?.name || ''
            });
        }
        bgmCollectionReady = true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'detectConflicts', showAlert: false });
        // 获取失败时，返回空冲突信息
        return { conflicts, conflictCount, bgmCollectionReady };
    }
    // 2. 遍历 Excel 可见行，比对差异
    const filterStatus = getFilterStatus(lastRow);
    let rowsToProcess = [];
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        rowsToProcess = filterStatus.visibleRows.filter(r => r >= startRow);
    }
    else {
        for (let r = startRow; r <= lastRow; r++)
            rowsToProcess.push(r);
    }
    const getField = (row, key) => {
        if (colMap.has(key))
            return trim(readCell(ws, row, colMap.get(key)));
        return '';
    };
    for (const rowNum of rowsToProcess) {
        const bgmUrl = getField(rowNum, 'Bangumi_URL');
        if (!bgmUrl)
            continue;
        const sid = extractSubjectId(bgmUrl);
        if (!sid)
            continue;
        const bgmEntry = bgmCollection.get(sid);
        if (!bgmEntry)
            continue; // 无对应收藏，不视为冲突
        // 构建 Excel 的 payload
        const excelType = mapWatchStatus(getField(rowNum, '是否看完'));
        if (excelType === 0)
            continue; // 不上传，不参与冲突
        // 对比 type 字段
        if (bgmEntry.type !== undefined && Number(bgmEntry.type) !== excelType) {
            conflicts.push({
                row: rowNum,
                sid,
                name: getField(rowNum, '名称') || '',
                existingType: Number(bgmEntry.type),
                newType: excelType
            });
            conflictCount++;
        }
        // 可扩展对比 rate、tags、comment 等字段
    }
    return { conflicts, conflictCount, bgmCollectionReady };
}
/**
 * Ribbon 专用的完整同步流程：预览 → 冲突检测 → 确认 → 执行
 * @param conflictResolution 冲突处理策略，默认 'excel'（覆盖）
 */
export async function syncWithConfirmation() {
    const app = window.Application;
    const ws = getDataSheet();
    if (!ws) {
        wpsMsgBox('未找到数据工作表', 0, 64);
        return;
    }
    const token = loadBgToken();
    if (!token) {
        wpsMsgBox('请先设置 Token', 0, 48);
        return;
    }
    const headerRow = findHeaderRow(ws) || 1;
    const lastRow = getLastRow(ws);
    const colMap = getColumnMap(ws, headerRow);
    if (!colMap.has("Bangumi_URL")) {
        wpsMsgBox('未找到 Bangumi URL 列', 0, 48);
        return;
    }
    // 1. 预览统计
    const preview = getSyncPreview(ws, colMap, lastRow, headerRow);
    // 2. 读取 Ribbon 复选框状态（冲突策略 + 增量同步）
    let conflictStrategy = 'excel';
    let incremental = false;
    try {
        if (app?.PluginStorage) {
            const skipConflicts = app.PluginStorage.getItem('bgm_skip_conflicts');
            if (skipConflicts === 'true') {
                conflictStrategy = 'skip';
            }
            const incr = app.PluginStorage.getItem('bgm_incremental_sync');
            if (incr === 'true') {
                incremental = true;
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'syncWithConfirmation:readRibbonOptions', showAlert: false });
    }
    // 3. 冲突检测
    let conflictInfo = '';
    let skipSids = undefined;
    try {
        const { conflicts, conflictCount } = await detectConflicts(ws, colMap, lastRow, headerRow, token);
        if (conflictCount > 0) {
            if (conflictStrategy === 'skip') {
                skipSids = new Set(conflicts.map(c => c.sid));
                conflictInfo = `检测到 ${conflictCount} 条冲突，已选择【跳过冲突】。\n\n`;
            }
            else {
                conflictInfo = `检测到 ${conflictCount} 条冲突，将使用【Excel数据覆盖】。\n\n`;
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'syncWithConfirmation:conflictDetection', showAlert: false });
    }
    // 4. 确认弹窗
    const msg = `数据预览：
        总行数：${preview.total}
        有效条目：${preview.valid}
        已上传（跳过）：${preview.alreadyUploaded}
        待同步：${preview.willSync}
        不上传（状态跳过）：${preview.willSkip}
        无效（无SID）：${preview.total - preview.valid}
        ${conflictInfo}是否继续同步？`;
    const confirmResult = app?.MessageBox?.(msg, 4 + 32);
    if (confirmResult !== 6)
        return;
    // 5. 执行同步（传入跳过冲突集合和增量同步开关）
    try {
        const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
            skipSids,
            incremental,
            onProgress: (current, total, message) => {
                if (app.StatusBar !== undefined)
                    app.StatusBar = `[${current}/${total}] ${message}`;
            }
        });
        app.StatusBar = false;
        app?.MessageBox?.(`同步完成！\n成功: ${result.success} 条\n失败: ${result.fail} 条\n跳过: ${result.skip} 条`, 0, 64);
    }
    catch (err) {
        app.StatusBar = false;
        BGM.handleError(err, { context: 'Ribbon同步', showAlert: true });
    }
}
/** 设置 Token（Ribbon 版本） */
export async function setTokenForRibbon() {
    const currentToken = loadBgToken() || '';
    const app = window.Application;
    const newToken = app?.InputBox?.('请输入 Access Token', '设置 Token', currentToken, 2);
    if (newToken && newToken !== false && typeof newToken === 'string') {
        const saved = storeBgToken(newToken);
        if (saved) {
            bgmLog(LOG_LEVELS.INFO, 'Token 已保存，通知面板更新...');
            BGM.notifyTokenUpdated();
            // 通知面板刷新状态
            notifyPanelTokenUpdated();
            if (typeof testTokenValidityForRibbon === 'function') {
                testTokenValidityForRibbon(newToken);
            }
            return true;
        }
        else {
            app?.MessageBox?.('Token 保存失败，请检查插件存储权限', 0, 16);
        }
    }
    return false;
}
/**
 * 通知面板 Token 已更新
 * 通过 postMessage 跨域通信
 */
function notifyPanelTokenUpdated() {
    try {
        // 尝试通知 taskpane.html
        if (typeof window !== 'undefined' && window.parent) {
            window.parent.postMessage({
                type: 'BGM:tokenUpdated',
                timestamp: Date.now()
            }, '*');
        }
        // 触发事件总线（供面板内的事件监听器使用）
        BGM.notifyTokenUpdated();
        bgmLog(LOG_LEVELS.DEBUG, '已发送 Token 更新通知');
    }
    catch (e) {
        BGM.handleError(new Error('通知面板失败', e), { showAlert: false });
    }
}
/** 测试 Token（Ribbon 版本） */
export function testTokenForRibbon() {
    const token = loadBgToken();
    if (token) {
        testTokenValidityForRibbon(token);
        BGM.notifyTokenUpdated();
    }
    else {
        window.Application?.MessageBox?.('请先设置 Token！', 0, 48);
    }
}
/** 设置用户 ID（Ribbon 版本） */
export function setUserIdForRibbon() {
    const app = window.Application;
    const userId = app?.InputBox?.('请输入用户 ID（数字）', '设置用户 ID', '', 2);
    if (userId && userId !== false) {
        BGM.setUserId(String(userId).trim());
        app?.MessageBox?.('用户 ID 已保存', 0, 64);
    }
}
/** 打开收藏页面 */
export function openCollectionForRibbon() {
    openUserCollection();
}
/** 清除颜色标记 */
export function clearColorsForRibbon() {
    clearRowColors?.();
}
