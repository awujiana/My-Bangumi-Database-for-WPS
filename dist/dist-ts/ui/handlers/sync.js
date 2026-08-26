/**
 * UI 事件处理模块 - 同步相关
 * @module ui/handlers/sync
 * @description 从面板同步到 Bangumi、从 BGM API 同步收藏标记等。
 */
import { LOG_LEVELS, bgmLog, BGM, loadBgToken, _setBgmUserId, getApp, getCell, trim, showAlert, showConfirm, setStatus, verifyToken, fetchAllUserCollections, findHeaderRow, getColumnMap, getLastRow, extractSubjectId, getDataSheet, SyncToBangumiAsync, getOrCreateSyncRecordSheet, getAllSyncRecords, addSyncRecord, BGM_COLOR, COLLECTION_TYPE_NAMES, BGM_SUBJECT_TYPES, setCellValue, clearSheetCache, showSyncProgressDialog, updateSyncProgressDialog, completeSyncProgressDialog, hideSyncProgressDialog, buildSyncConfig, formatDuration, } from '../../index.js';
import { getSyncPreview, detectConflicts } from '../../services/ribbonService.js';
import { ensureSheetHeaders } from '../../tools/util/index.js';
import { _T } from './_constants.js';
import { showTokenDialog } from './token.js';
/**
 * 将 Bangumi 收藏列表填充到空工作表。
 * 仅写入 colMap 中存在的列，避免向不存在的列写入。
 * @returns 实际写入的数据行数
 */
async function _fillSheetWithCollections(ws, collections, headerRow, colMap) {
    let written = 0;
    const total = collections.length;
    for (let i = 0; i < total; i++) {
        const item = collections[i];
        if (!item || !item.subject_id)
            continue;
        const row = headerRow + 1 + i;
        const subject = item.subject;
        const name = subject?.name_cn || subject?.name || '';
        const alias = subject?.name_cn && subject?.name ? subject.name : '';
        const url = `https://bgm.tv/subject/${item.subject_id}`;
        const writes = [];
        const seqCol = colMap.get('序列号');
        if (seqCol !== undefined)
            writes.push({ col: seqCol, value: i + 1 });
        const nameCol = colMap.get('名称');
        if (nameCol !== undefined && name)
            writes.push({ col: nameCol, value: name });
        const aliasCol = colMap.get('别名');
        if (aliasCol !== undefined && alias)
            writes.push({ col: aliasCol, value: alias });
        const urlCol = colMap.get('Bangumi_URL');
        if (urlCol !== undefined)
            writes.push({ col: urlCol, value: url });
        const categoryCol = colMap.get('类别');
        if (categoryCol !== undefined) {
            writes.push({ col: categoryCol, value: BGM_SUBJECT_TYPES[item.subject_type || 2] ?? '' });
        }
        const finishedCol = colMap.get('是否看完');
        if (finishedCol !== undefined) {
            // type 2 = 看过，视为已看完；其余状态视为未看完
            writes.push({ col: finishedCol, value: item.type === 2 ? '是' : '否' });
        }
        const scoreCol = colMap.get('打分');
        if (scoreCol !== undefined && item.rate != null)
            writes.push({ col: scoreCol, value: item.rate });
        const tagsCol = colMap.get('标签/分级');
        if (tagsCol !== undefined && item.tags && item.tags.length > 0) {
            writes.push({ col: tagsCol, value: item.tags.join(', ') });
        }
        const commentCol = colMap.get('剧透/感言');
        if (commentCol !== undefined && item.comment) {
            writes.push({ col: commentCol, value: item.comment });
        }
        let rowOk = true;
        for (const { col, value } of writes) {
            if (!setCellValue(ws, row, col, value)) {
                rowOk = false;
            }
        }
        if (rowOk)
            written++;
        // 每 50 行更新一次状态并让出事件循环，避免 UI 卡死
        if ((i + 1) % 50 === 0) {
            setStatus(`正在填充收藏数据：${i + 1}/${total}`, 'info');
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    setStatus(`收藏数据填充完成：${written}/${total}`, 'info');
    return written;
}
// ========== 从面板同步（异步，带进度条） ==========
/**
 * 准备同步所需的数据与工作表（步骤 1-10）。
 * 任何检查失败时返回 null（已显示相应提示）。
 */
function prepareSyncFromPanel() {
    // 防重入检查已由 syncFromPanel 入口的 enterRunningState() 处理，此处不再重复
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] ========== 开始执行同步操作 ==========');
    // 1. 检查必要函数是否加载
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤1: 检查必要函数是否加载');
    if (typeof findHeaderRow !== 'function' ||
        typeof getColumnMap !== 'function' ||
        typeof getLastRow !== 'function') {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 必要函数未加载完成');
        showAlert(_T.loadingWait);
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（函数未加载），耗时: ${Date.now() - startTime}ms`);
        return null;
    }
    // 2. 检查 Token
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤2: 检查 Token');
    const token = loadBgToken();
    if (!token) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] Token 未设置');
        showAlert(_T.pleaseSetBgmToken);
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（Token未设置），耗时: ${Date.now() - startTime}ms`);
        return null;
    }
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] Token 已设置（长度: ${token.length}）`);
    // 3. 获取应用和工作表对象
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤3: 获取应用和工作表对象');
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        bgmLog(LOG_LEVELS.ERROR, '[syncFromPanel] 无法获取 Application 对象');
        showAlert('无法获取 Application 对象！');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（无法获取Application），耗时: ${Date.now() - startTime}ms`);
        return null;
    }
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] Application 对象获取成功');
    // 3.1 记住用户当前活动的工作表
    let originalActiveSheet = null;
    try {
        originalActiveSheet = app.ActiveWorkbook.ActiveSheet;
        if (originalActiveSheet) {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 记住用户当前工作表: ${originalActiveSheet.Name}`);
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 获取当前工作表失败: ${e.message}`);
    }
    // 3.2 确保同步记录工作表存在（不激活）
    let syncSheet = null;
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤3.2: 确保同步记录工作表存在');
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncSheet = getOrCreateSyncRecordSheet();
        if (syncSheet) {
            bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 同步记录工作表已创建/获取（暂不激活）');
        }
    }
    // 4. 获取数据工作表并激活（确保筛选检测正确）
    const ws = getDataSheet();
    if (!ws) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到数据工作表');
        showAlert('未找到数据工作表，请先锁定工作表。');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（未找到数据工作表），耗时: ${Date.now() - startTime}ms`);
        return null;
    }
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 数据工作表获取成功');
    try {
        ws.Activate();
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已激活数据工作表: ${ws.Name}（用于筛选检测）`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 激活数据工作表失败: ${e.message}`);
    }
    // 5. 解析表头和列映射
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤5: 解析表头和列映射');
    const headerRow = findHeaderRow(ws);
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 表头行: ${headerRow}`);
    const lastRow = getLastRow(ws);
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 最后一行: ${lastRow}`);
    const colMap = getColumnMap(ws, headerRow);
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 列映射完成，共 ${colMap.size} 列`);
    if (!colMap.has('Bangumi_URL')) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 未找到 Bangumi_URL 列');
        showAlert('未找到 "Bangumi URL" 列！');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（缺少Bangumi_URL列），耗时: ${Date.now() - startTime}ms`);
        return null;
    }
    // 6. 增量同步开关（提前读取）
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤6: 检查增量同步设置');
    const incremental = document.getElementById('chkIncremental')?.checked ?? false;
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 增量同步: ${incremental ? '开启' : '关闭'}`);
    // 构建增量同步的指纹映射
    let fingerprintMap;
    if (incremental) {
        const allRecords = getAllSyncRecords ? getAllSyncRecords() : [];
        fingerprintMap = new Map();
        for (const r of allRecords) {
            if (r.sid && r.fingerprint) {
                fingerprintMap.set(r.sid, r.fingerprint);
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 增量同步模式：已加载 ${fingerprintMap.size} 条历史指纹`);
    }
    return {
        ws,
        colMap,
        token,
        lastRow,
        headerRow,
        incremental,
        fingerprintMap,
        originalActiveSheet,
        syncSheet,
        app,
        startTime,
    };
}
/**
 * 冲突确认与执行同步（步骤 11-16）。
 * @returns true 表示同步已执行（成功或异常），false 表示用户取消。
 */
async function confirmAndExecuteSync(prepared) {
    const { ws, colMap, token, lastRow, headerRow, incremental, fingerprintMap, syncSheet, app, startTime, } = prepared;
    // 7. 获取同步预览统计（传入增量同步选项）
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤7: 获取同步预览统计');
    const preview = getSyncPreview(ws, colMap, lastRow, headerRow, {
        incremental,
        ...(fingerprintMap !== undefined && { fingerprintMap }),
    });
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 数据预览 - 总行数: ${preview.total}, 有效: ${preview.valid}, 已上传: ${preview.alreadyUploaded}, 待同步: ${preview.willSync}, 跳过: ${preview.willSkip}, 无URL: ${preview.noUrl}, 空状态: ${preview.emptyStatus}, 增量跳过: ${preview.incrementalSkipped}`);
    // 8. 冲突检测与策略
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤8: 冲突检测');
    const conflictSelect = document.getElementById('conflictStrategy');
    const conflictStrategy = conflictSelect?.value || 'skip';
    bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突策略: ${conflictStrategy}`);
    let conflictSids = undefined;
    let conflictMsg = '';
    try {
        bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 开始检测冲突...');
        const { conflicts, conflictCount } = await detectConflicts(ws, colMap, lastRow, headerRow, token);
        if (conflictCount > 0) {
            bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 检测到 ${conflictCount} 条冲突`);
            if (conflictStrategy === 'skip') {
                conflictSids = new Set(conflicts.map((c) => c.sid));
                conflictMsg = `检测到 ${conflictCount} 条冲突，已选择【跳过冲突】。\n\n`;
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突处理策略: 跳过 ${conflictCount} 条冲突条目`);
            }
            else {
                conflictMsg = `检测到 ${conflictCount} 条冲突，将使用【Excel数据覆盖】。\n\n`;
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 冲突处理策略: 使用Excel数据覆盖 ${conflictCount} 条冲突`);
            }
        }
        else {
            bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 未检测到冲突');
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 冲突检测失败: ${e.message}`);
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'syncFromPanel' });
    }
    // 9. 确认对话框
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤9: 显示确认对话框');
    const msg = `数据预览：
            总行数：${preview.total}
            有效条目：${preview.valid}
            已上传（跳过）：${preview.alreadyUploaded}
            待同步：${preview.willSync}
            不上传（状态跳过）：${preview.willSkip}
            无URL：${preview.noUrl}
            空状态：${preview.emptyStatus}
            ${incremental ? `增量跳过：${preview.incrementalSkipped}\n` : ''}${conflictMsg}是否继续同步？\n\n同步开始后将切换到同步记录工作表查看进度。`;
    const confirmed = await new Promise((resolve) => {
        showConfirm(msg, (confirmed) => resolve(confirmed));
    });
    if (!confirmed) {
        bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 用户取消同步');
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步操作终止（用户取消），耗时: ${Date.now() - startTime}ms`);
        return false;
    }
    // 10. 切换到同步记录工作表，让用户看到实时写入
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤10: 切换到同步记录工作表');
    if (syncSheet) {
        try {
            syncSheet.Activate();
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已激活同步记录工作表: ${syncSheet.Name}`);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 激活同步记录工作表失败: ${e.message}`);
        }
    }
    // 11. 执行同步
    bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 步骤11: 开始执行同步');
    try {
        const syncFromPanelConfig = buildSyncConfig({
            source: '当前工作表',
            strategy: conflictStrategy === 'skip' ? '跳过冲突' : '覆盖冲突',
            direction: 'Excel → Bangumi',
            extra: [
                { label: '数据范围', value: `第${headerRow + 1}~${lastRow}行` },
                { label: '增量同步', value: incremental ? '开启' : '关闭' },
                { label: '冲突数', value: conflictMsg ? String(conflictSids?.size ?? 0) : '0' },
            ],
        });
        showSyncProgressDialog('正在同步 - 同步到 Bangumi', {
            onPause: () => BGM.sync.pause(),
            onResume: () => BGM.sync.resume(),
            onStop: () => BGM.sync.requestStop(),
        }, syncFromPanelConfig);
        bgmLog(LOG_LEVELS.INFO, '[syncFromPanel] 调用 SyncToBangumiAsync...');
        const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
            ...(conflictSids !== undefined && { skipSids: conflictSids }),
            incremental,
            onProgress: (current, total, message) => {
                updateSyncProgressDialog(current, total, message);
                if (app.StatusBar !== undefined) {
                    app.StatusBar = `[${current}/${total}] ${message}`;
                }
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步进度: ${current}/${total} - ${message}`);
            },
        });
        // 切换弹窗为完成状态
        const totalElapsed = Date.now() - startTime;
        const totalProcessed = result.success + result.fail;
        const avgSpeed = totalProcessed > 0 && totalElapsed > 0
            ? Math.round((totalProcessed / totalElapsed) * 1000)
            : 0;
        const summary = `📊 同步 ${result.success + result.fail + result.skip} 条 | 耗时 ${formatDuration(totalElapsed)}\n\n✅ 成功: ${result.success}\n❌ 失败: ${result.fail}\n⏭️ 跳过: ${result.skip}`;
        const details = result.stopped
            ? [
                '⚠️ 同步被用户停止',
                `成功 ${result.success} 条`,
                `失败 ${result.fail} 条`,
                `跳过 ${result.skip} 条`,
                `⏱️ 耗时: ${formatDuration(totalElapsed)}`,
                `⚡ 平均速度: ${avgSpeed > 0 ? avgSpeed + ' 行/秒' : '--'}`,
            ]
            : [
                `成功 ${result.success} 条`,
                `失败 ${result.fail} 条`,
                `跳过 ${result.skip} 条`,
                `⏱️ 耗时: ${formatDuration(totalElapsed)}`,
                `⚡ 平均速度: ${avgSpeed > 0 ? avgSpeed + ' 行/秒' : '--'}`,
            ];
        // 构造 SyncProgressStats 用于图表渲染（将 Bangumi 同步的 success 映射为 added）
        const stats = {
            added: result.success,
            updated: 0,
            deleted: 0,
            unchanged: 0,
            failed: result.fail,
            skipped: result.skip,
            remoteTotal: result.success + result.fail + result.skip,
            elapsedMs: totalElapsed,
            avgSpeed,
            strategyLabel: '同步到 Bangumi',
        };
        completeSyncProgressDialog(summary, details, result.stopped, undefined, stats);
        if (app.StatusBar !== undefined)
            app.StatusBar = false;
        if (result.stopped) {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步已被用户停止！成功: ${result.success}, 失败: ${result.fail}, 跳过: ${result.skip}`);
        }
        else {
            bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 同步完成！成功: ${result.success}, 失败: ${result.fail}, 跳过: ${result.skip}`);
        }
    }
    catch (err) {
        hideSyncProgressDialog();
        if (app.StatusBar !== undefined)
            app.StatusBar = false;
        bgmLog(LOG_LEVELS.ERROR, `[syncFromPanel] 同步失败: ${err.message}`);
        BGM.handleError(err, { context: 'syncFromPanel', showAlert: true });
    }
    finally {
        BGM.sync.exitRunningState();
    }
    return true;
}
export async function syncFromPanel() {
    // 防重入检查：在执行任何耗时操作前就获取运行锁，避免预览/冲突检测期间用户重复点击
    if (!BGM.sync.enterRunningState()) {
        bgmLog(LOG_LEVELS.WARN, '[syncFromPanel] 同步正在进行中，拒绝重入');
        showAlert('同步正在进行中，请稍后再试', '提示');
        return;
    }
    const prepared = prepareSyncFromPanel();
    if (prepared === null) {
        BGM.sync.exitRunningState();
        return;
    }
    let completed = false;
    try {
        completed = await confirmAndExecuteSync(prepared);
    }
    finally {
        // 兜底释放运行锁（正常完成/异常路径已由 confirmAndExecuteSync 释放，此处仅处理用户取消的情况）
        if (BGM.sync.isRunning) {
            BGM.sync.exitRunningState();
        }
        // 无论成功失败或取消，最后都尝试恢复用户之前的工作表
        if (prepared.originalActiveSheet) {
            try {
                prepared.originalActiveSheet.Activate();
                bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] 已恢复用户之前的工作表: ${prepared.originalActiveSheet.Name}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[syncFromPanel] 恢复工作表失败: ${e.message}`);
            }
        }
    }
    if (completed) {
        bgmLog(LOG_LEVELS.INFO, `[syncFromPanel] ========== 同步操作结束，总耗时: ${Date.now() - prepared.startTime}ms ==========`);
    }
}
// ========== 从BGM同步收藏标记 ==========
export async function syncCollectionFromBgm() {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncCollectionFromBgm] ========== 开始从 BGM 同步收藏标记 ==========');
    const select = document.getElementById('sheetSelect');
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value || '') || 1;
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 目标工作表索引: ${sheetIndex}`);
    const token = loadBgToken();
    if (!token) {
        bgmLog(LOG_LEVELS.WARN, '[syncCollectionFromBgm] Token 未设置');
        showAlert(_T.pleaseSetBgmToken);
        bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 操作终止（Token未设置），耗时: ${Date.now() - startTime}ms`);
        return;
    }
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] Token 已设置（长度: ${token.length}）`);
    try {
        bgmLog(LOG_LEVELS.INFO, '[syncCollectionFromBgm] 调用 syncFromBgmByAPI...');
        await syncFromBgmByAPI(sheetIndex);
        bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] 同步完成，耗时: ${Date.now() - startTime}ms`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, `[syncCollectionFromBgm] 同步失败: ${e.message}`);
        BGM.handleError(e, { context: 'syncCollectionFromBgm', showAlert: true });
    }
    bgmLog(LOG_LEVELS.INFO, `[syncCollectionFromBgm] ========== 操作结束，总耗时: ${Date.now() - startTime}ms ==========`);
}
export async function syncFromBgmByAPI(sheetIndex) {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetBgmToken);
        showTokenDialog('');
        return;
    }
    showConfirm('将 从 BGM API 获取你的收藏列表，并在 D 列标记已收藏的条目，同时写入同步记录表。\n\n是否继续？', async (confirmed) => {
        if (confirmed) {
            await _doAPISync(sheetIndex, token);
        }
    });
}
async function _doAPISync(sheetIndex, token) {
    const syncStartTs = Date.now();
    // 记住原始活动工作表
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        showAlert('无法获取 Application');
        return;
    }
    let originalActiveSheet = null;
    try {
        originalActiveSheet = app.ActiveWorkbook.ActiveSheet;
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 记住原始工作表: ${originalActiveSheet?.Name}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 获取原始工作表失败: ${e.message}`);
    }
    // 获取同步记录工作表
    let syncSheet = null;
    if (typeof getOrCreateSyncRecordSheet === 'function') {
        syncSheet = getOrCreateSyncRecordSheet();
        if (!syncSheet) {
            showAlert('创建同步记录表失败');
            return;
        }
    }
    const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
    // 1. 验证 Token 并获取收藏列表
    setStatus('正在验证 Token...', 'info');
    const verifyResult = await verifyToken(token);
    if (!verifyResult.valid) {
        showAlert('✘ ' + verifyResult.message);
        return;
    }
    _setBgmUserId(verifyResult.userId || '');
    setStatus('正在获取收藏列表...', 'info');
    const userCollections = await fetchAllUserCollections(token);
    // 2. 解析表头与空表检测
    let headerRow = typeof findHeaderRow === 'function' ? findHeaderRow(ws) : 1;
    let colMap = typeof getColumnMap === 'function' ? getColumnMap(ws, headerRow) : new Map();
    let lastRow = typeof getLastRow === 'function' ? getLastRow(ws) : 200;
    // 空表时提供从 Bangumi API 自动填充
    if (lastRow <= headerRow || headerRow === 0) {
        if (userCollections.length === 0) {
            bgmLog(LOG_LEVELS.INFO, '[_doAPISync] 工作表为空且 Bangumi 账号无收藏数据');
            showAlert('当前工作表为空，且 Bangumi 账号暂无收藏数据，无法填充。');
            return;
        }
        const confirmed = await new Promise((resolve) => {
            showConfirm(`当前工作表为空，是否从 Bangumi 收藏列表自动填充 ${userCollections.length} 条条目？`, (confirmed) => resolve(confirmed));
        });
        if (!confirmed) {
            bgmLog(LOG_LEVELS.INFO, '[_doAPISync] 用户取消空表填充');
            return;
        }
        // 缺少表头时先写入标准表头
        if (headerRow === 0 || !colMap.has('Bangumi_URL')) {
            if (typeof ensureSheetHeaders !== 'function' || !ensureSheetHeaders(ws)) {
                showAlert('工作表为空且无法写入标准表头，请检查工作表状态。');
                return;
            }
            clearSheetCache(ws);
            headerRow = findHeaderRow(ws);
            colMap = getColumnMap(ws, headerRow);
            if (headerRow === 0 || !colMap.has('Bangumi_URL')) {
                showAlert('写入标准表头后仍未找到 Bangumi URL 列，请检查模板。');
                return;
            }
        }
        setStatus('正在填充收藏数据到 Excel...', 'info');
        const filledCount = await _fillSheetWithCollections(ws, userCollections, headerRow, colMap);
        if (filledCount === 0) {
            showAlert('未能写入任何收藏数据，请检查工作表是否可编辑。');
            return;
        }
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 空表填充完成：${filledCount}/${userCollections.length}`);
        // 重新计算待处理行
        clearSheetCache(ws);
        lastRow = typeof getLastRow === 'function' ? getLastRow(ws, true, headerRow) : lastRow;
        headerRow = typeof findHeaderRow === 'function' ? findHeaderRow(ws) : headerRow;
        colMap = typeof getColumnMap === 'function' ? getColumnMap(ws, headerRow) : colMap;
    }
    // 3. 必须有 Bangumi_URL 列
    if (!colMap.has('Bangumi_URL')) {
        showAlert('未找到 Bangumi URL 列！');
        return;
    }
    const rowsToProcess = [];
    for (let r = headerRow + 1; r <= lastRow; r++)
        rowsToProcess.push(r);
    if (rowsToProcess.length === 0) {
        showAlert('没有需要处理的数据行！');
        return;
    }
    const collectionMap = new Map();
    userCollections.forEach((c) => collectionMap.set(String(c.subject_id), c));
    // 切换到同步记录工作表，让用户能看到实时写入
    if (syncSheet) {
        try {
            syncSheet.Activate();
            bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 已激活同步记录工作表: ${syncSheet.Name}`);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 激活同步记录工作表失败: ${e.message}`);
        }
    }
    let syncRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
    const syncCountMap = new Map();
    syncRecords.forEach((r) => syncCountMap.set(String(r.sid || ''), (syncCountMap.get(String(r.sid || '')) || 0) + 1));
    // 使用从 ../index.js 导入的 BGM_SUBJECT_TYPES 常量（与 core/constants.ts 中定义一致）
    // 启动同步状态机：使用 enterRunningState 进行防重入检查
    if (!BGM.sync.enterRunningState()) {
        bgmLog(LOG_LEVELS.WARN, '[_doAPISync] 已有同步进行中，拒绝重入');
        showAlert('同步正在进行中，请稍后再试', '提示');
        return;
    }
    try {
        const collectionConfig = buildSyncConfig({
            source: 'Bangumi 收藏列表',
            strategy: '收藏回写',
            direction: 'Bangumi → Excel',
            extra: [
                { label: '收藏条目', value: String(userCollections.length) },
                { label: '待处理行', value: String(rowsToProcess.length) },
            ],
        });
        showSyncProgressDialog('正在收藏回写', {
            onPause: () => BGM.sync.pause(),
            onResume: () => BGM.sync.resume(),
            onStop: () => BGM.sync.requestStop(),
        }, collectionConfig);
        // 两阶段进度合并：累计 total，避免阶段切换时进度条从 100% 回退到 0%
        const totalCollect = userCollections.length;
        const totalRows = rowsToProcess.length;
        const totalCombined = totalCollect + totalRows;
        let currentCombined = 0;
        // 阶段1：写入收藏到同步记录表（显示进度，但不需要定位单元格）
        for (let i = 0; i < userCollections.length; i++) {
            if (BGM.sync.checkShouldStop())
                break;
            if (BGM.sync.checkPaused())
                await BGM.sync.waitForResume();
            if (BGM.sync.checkShouldStop())
                break;
            const item = userCollections[i];
            if (item === undefined)
                continue;
            const itemName = item.subject?.name_cn || item.subject?.name || '(无名称)';
            if (typeof addSyncRecord === 'function') {
                addSyncRecord({
                    name: itemName,
                    url: 'https://bgm.tv/subject/' + item.subject_id,
                    sid: String(item.subject_id),
                    type: BGM_SUBJECT_TYPES[item.subject_type || 2] ?? '',
                    content: '标记同步',
                    status: '成功',
                    count: 1,
                    collType: COLLECTION_TYPE_NAMES[item.type] || '',
                });
            }
            currentCombined++;
            updateSyncProgressDialog(currentCombined, totalCombined, `阶段1: 收藏写入同步记录 ${i + 1}/${totalCollect}`, `📥 [${i + 1}/${totalCollect}] ${itemName}`);
        }
        syncRecords = typeof getAllSyncRecords === 'function' ? getAllSyncRecords() : [];
        syncCountMap.clear();
        syncRecords.forEach((r) => syncCountMap.set(String(r.sid || ''), (syncCountMap.get(String(r.sid || '')) || 0) + 1));
        // 阶段2：在 Excel 数据表上标记已收藏的行（需要定位单元格）
        // 切换回数据工作表，便于暂停时定位
        try {
            ws.Activate();
            bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 阶段2：已切回数据工作表进行标记`);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 切回数据工作表失败: ${e.message}`);
        }
        const urlCol = colMap.get('Bangumi_URL');
        const seqColForLocate = colMap.get('序列号') || 9;
        BGM.sync.updatePosition(ws, 0, seqColForLocate);
        let matchedCount = 0;
        for (let i = 0; i < rowsToProcess.length; i++) {
            if (BGM.sync.checkShouldStop()) {
                bgmLog(LOG_LEVELS.INFO, '[_doAPISync] 阶段2：检测到停止请求，终止');
                break;
            }
            if (BGM.sync.checkPaused()) {
                bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 阶段2：已暂停，进度 ${i}/${totalRows}，等待恢复...`);
                await BGM.sync.waitForResume();
                if (BGM.sync.checkShouldStop())
                    break;
            }
            const row = rowsToProcess[i];
            if (row === undefined)
                continue;
            // 更新当前位置（行号）以便暂停时定位
            BGM.sync.updatePosition(undefined, row);
            const bgmUrlCell = colMap.has('Bangumi_URL') ? getCell(ws, row, urlCol) : null;
            const bgmUrl = bgmUrlCell ? trim(String(bgmUrlCell.Value ?? '')) : '';
            const sid = typeof extractSubjectId === 'function' ? extractSubjectId(bgmUrl) : '';
            let matched = false;
            if (sid && collectionMap.has(sid)) {
                const seqCol = colMap.get('序列号') || 9;
                const seqCell = getCell(ws, row, seqCol);
                if (seqCell && seqCell.Interior) {
                    const syncCount = syncCountMap.get(sid) || 0;
                    seqCell.Interior.Color =
                        syncCount === 1
                            ? BGM_COLOR.BGM_SYNC
                            : syncCount === 2
                                ? BGM_COLOR.LIGHT_GREEN
                                : BGM_COLOR.DARK_GREEN;
                }
                matchedCount++;
                matched = true;
            }
            currentCombined++;
            updateSyncProgressDialog(currentCombined, totalCombined, `阶段2: 标记数据表 ${i + 1}/${totalRows}（匹配 ${matchedCount}）`, matched
                ? `✓ [${i + 1}/${totalRows}] 行${row} 匹配 SID=${sid}`
                : `· [${i + 1}/${totalRows}] 行${row} 未匹配`);
        }
        // 输出同步统计
        const totalCollections = userCollections.length;
        const wasStopped = BGM.sync.checkShouldStop();
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] ========== 同步统计 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] BGM 收藏总数: ${totalCollections}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 数据表总行数: ${rowsToProcess.length}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 匹配标记数: ${matchedCount}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 同步记录条数: ${syncRecords.length}`);
        bgmLog(LOG_LEVELS.INFO, `[_doAPISync] ================================`);
        // 切换弹窗为完成状态
        const totalElapsed = Date.now() - syncStartTs;
        const totalProcessed = matchedCount;
        const avgSpeed = totalProcessed > 0 && totalElapsed > 0
            ? Math.round((totalProcessed / totalElapsed) * 1000)
            : 0;
        const summary = `📊 BGM 收藏 ${totalCollections} 条 | 数据表 ${rowsToProcess.length} 行 | 耗时 ${formatDuration(totalElapsed)}\n\n✅ 匹配标记: ${matchedCount}\n📝 同步记录: ${syncRecords.length}`;
        const detailsArr = [
            `BGM 收藏总数: ${totalCollections}`,
            `数据表总行数: ${rowsToProcess.length}`,
            `匹配标记数: ${matchedCount}`,
            `同步记录条数: ${syncRecords.length}`,
            `⏱️ 耗时: ${formatDuration(totalElapsed)}`,
            `⚡ 平均速度: ${avgSpeed > 0 ? avgSpeed + ' 行/秒' : '--'}`,
        ];
        if (wasStopped)
            detailsArr.unshift('⚠️ 同步被用户停止');
        const stats = {
            added: matchedCount,
            updated: 0,
            deleted: 0,
            unchanged: rowsToProcess.length - matchedCount,
            failed: 0,
            skipped: 0,
            remoteTotal: totalCollections,
            elapsedMs: totalElapsed,
            avgSpeed,
            strategyLabel: 'BGM 收藏同步',
        };
        completeSyncProgressDialog(summary, detailsArr, wasStopped, undefined, stats);
        // 恢复原始工作表
        if (originalActiveSheet) {
            try {
                originalActiveSheet.Activate();
                bgmLog(LOG_LEVELS.INFO, `[_doAPISync] 已恢复原始工作表: ${originalActiveSheet.Name}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[_doAPISync] 恢复原始工作表失败: ${e.message}`);
            }
        }
    }
    catch (e) {
        hideSyncProgressDialog();
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: '_doAPISync' });
        showAlert(_T.syncFailed + e.message, _T.syncFailed);
        setStatus(_T.syncFailed, 'error');
    }
    finally {
        BGM.sync.exitRunningState();
        // 确保即使发生异常也尝试恢复原始工作表
        if (originalActiveSheet) {
            try {
                originalActiveSheet.Activate();
            }
            catch {
                // 静默处理恢复失败
            }
        }
    }
}
