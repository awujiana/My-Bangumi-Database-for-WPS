/**
 * 「数据同步」（远程仓库 → Excel）按钮的完整动作
 *
 * @module ui/handlers/remote-sync-action
 * @description 从 action-handlers.ts 抽出的 `syncFromGithub` 处理器（原 284 行，
 *              占那张分发表近 1/5）。它比表里其它条目大一个数量级：要读 4 个表单
 *              控件、拼时间筛选、记冲突策略、走「确认框 → 列映射框 → 真正同步 →
 *              结果弹窗」，夹在一张 40 项的扁平分发表里既难读，也让那个文件失去重点。
 *
 *              抽出后 action-handlers.ts 只留一行接线
 *              （`syncFromGithub: runRemoteSyncAction`），分发表回到「一张索引表」
 *              应有的形态。
 */
import { LOG_LEVELS, bgmLog, buildSyncConfig, completeSyncProgressDialog, formatDuration, getApp, getLastRow, getSyncRecordSheetIfExists, getSyncStrategy, getSyncSourceType, hideSyncProgressDialog, isGithubConfigComplete, REMOTE_SYNC_PHASES, showConfirm, showSyncMappingDialog, showSyncProgressDialog, showSyncResultDialog, showToast, syncFromRemote, updateSyncProgressDialog, } from '../../index.js';
import { createStatusBarWriter } from '../../tools/util/status-bar.js';
/** 同步指标计算（纯函数）：从 handleActionClick 的 try 块抽出，降低 try-complexity */
function computeSyncMetrics(result, syncStartTime) {
    const totalElapsed = Date.now() - syncStartTime;
    const totalProcessed = result.added + result.updated + result.deleted;
    const avgSpeed = totalProcessed > 0 && totalElapsed > 0 ? Math.round((totalProcessed / totalElapsed) * 1000) : 0;
    const efficiency = totalProcessed > 0 || result.unchanged > 0
        ? Math.round((totalProcessed / (totalProcessed + result.unchanged)) * 100)
        : 0;
    const etaMs = avgSpeed > 0 && result.remoteTotal > totalProcessed
        ? Math.round(((result.remoteTotal - totalProcessed) / avgSpeed) * 1000)
        : 0;
    return { totalElapsed, totalProcessed, avgSpeed, efficiency, etaMs };
}
// GitHub 仓库同步：立即同步（异步，按当前策略）
export function runRemoteSyncAction(context) {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始数据同步（远程仓库 → Excel）');
    // 读取同步源类型：优先用下拉框当前值，兜底用已保存的值
    const sourceTypeSelect = document.getElementById('syncSourceType');
    const currentSourceType = sourceTypeSelect?.value ?? getSyncSourceType();
    // 读取「仅同步选中行」开关
    const chkSelectedOnly = document.getElementById('chkSyncSelectedOnly');
    const isSelectedRowsOnly = chkSelectedOnly?.checked === true;
    // 读取时间筛选配置
    const chkTimeFilter = document.getElementById('chkTimeFilter');
    const isTimeFilterEnabled = chkTimeFilter?.checked === true;
    let timeFilter;
    if (isTimeFilterEnabled) {
        const yearSelect = document.getElementById('timeFilterYear');
        const rangeSelect = document.getElementById('timeFilterRange');
        const quarterSelect = document.getElementById('timeFilterQuarter');
        const monthSelect = document.getElementById('timeFilterMonth');
        const year = Number(yearSelect?.value || '2026');
        const range = rangeSelect?.value ?? 'year';
        timeFilter = {
            enabled: true,
            year,
            range,
            ...(range === 'quarter' && {
                quarter: Number(quarterSelect?.value || '1'),
            }),
            ...(range === 'month' && { month: Number(monthSelect?.value || '1') }),
        };
    }
    // 本地文件源仅需 path 字段；远程源（GitHub/GitLab/Gitee）要求 owner/repo/path
    // 本地文件路径复用 #githubPath 输入框（用户可手动粘贴绝对路径，UI 后续可扩展文件选择对话框）
    if (currentSourceType === 'local') {
        const pathInput = document.getElementById('githubPath');
        if (!pathInput?.value.trim()) {
            showToast('请先填写本地文件路径', 'warn');
            return;
        }
    }
    else if (!isGithubConfigComplete()) {
        showToast('请先填写并保存远程仓库配置', 'warn');
        return;
    }
    // 读取策略：优先用下拉框当前值（未保存也能即时生效），兜底用已保存的策略
    const strategySelect = document.getElementById('githubStrategy');
    const strategy = strategySelect?.value ?? getSyncStrategy();
    const strategyLabel = {
        'add-update': '新增+更新（不删除）',
        'add-only': '仅新增',
        'update-only': '仅更新',
        mirror: '镜像同步（含删除）',
        'force-overwrite': '强制覆盖',
    }[strategy];
    // 同步源类型对应的来源描述（本地文件 vs 远程仓库）
    const sourceLabel = currentSourceType === 'local' ? '本地文件' : '远程仓库';
    // 构建时间筛选描述
    let timeFilterDesc = '';
    if (timeFilter) {
        switch (timeFilter.range) {
            case 'future': {
                timeFilterDesc = `\n🔮 时间筛选：预告/未来动漫（无开播日期）`;
                break;
            }
            case 'year': {
                timeFilterDesc = `\n📅 时间筛选：${String(timeFilter.year)}年全年`;
                break;
            }
            case 'quarter': {
                timeFilterDesc = `\n📅 时间筛选：${String(timeFilter.year)}年${String(timeFilter.quarter ?? '')}月新番`;
                break;
            }
            default: {
                // month（默认，与旧 else 分支一致）
                timeFilterDesc = `\n📅 时间筛选：${String(timeFilter.year)}年${String(timeFilter.month ?? '')}月`;
                break;
            }
        }
    }
    showConfirm(`将从${sourceLabel}下载数据并按策略【${strategyLabel}】合并到当前工作表。\n（远程仓库 → Excel，与上传同步方向相反）${isSelectedRowsOnly ? '\n⚠️ 仅同步选中行' : ''}${timeFilterDesc}\n是否继续？`, async (confirmed) => {
        if (!confirmed) {
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消数据同步');
            return;
        }
        // 同步前列映射确认（2026-10-17）：确认框 → 列映射框 → 真正同步。
        // 用户在这里取消勾选 / 改目标列 / 补缺失列；点「取消同步」= 中止本次同步。
        // 弹窗不可用（如测试环境 barrel 被整体 mock）时按默认继续，不阻塞既有链路。
        const mappingConfig = typeof showSyncMappingDialog === 'function' ? await showSyncMappingDialog() : undefined;
        if (mappingConfig === null) {
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户在列映射确认框取消同步');
            return;
        }
        // 使用模块化进度弹窗（与「同步到 Bangumi」「选中行同步」保持一致）
        // AbortController 支持：用户点「停止」时**下载阶段与写入阶段都会立即中断**
        // （P2-7：applyDiffToSheet 每批写入前检查 signal，未处理条目计入 skipped）
        const abortController = new AbortController();
        // 构建配置摘要，显示在同步进度弹窗顶部
        const configContext = {
            source: sourceLabel,
            strategy: strategyLabel,
            direction: '远程仓库 → Excel',
            selectedRowsOnly: isSelectedRowsOnly,
        };
        if (timeFilter) {
            const tfContext = {
                range: timeFilter.range === 'all' ? 'year' : timeFilter.range,
                year: timeFilter.year,
            };
            if (timeFilter.quarter !== undefined)
                tfContext.quarter = timeFilter.quarter;
            if (timeFilter.month !== undefined)
                tfContext.month = timeFilter.month;
            configContext.timeFilter = tfContext;
        }
        const configSummary = buildSyncConfig(configContext);
        showSyncProgressDialog(`正在同步 - 数据同步（${sourceLabel} → Excel）`, {
            onPause: () => {
                bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 数据同步不支持暂停');
            },
            onResume: () => {
                bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 数据同步不支持恢复');
            },
            onStop: () => {
                bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 用户请求停止数据同步');
                abortController.abort();
            },
        }, configSummary, 
        // 阶段时间线：下载 → 比对 → 写入，由 remote-sync-core 推进
        REMOTE_SYNC_PHASES);
        // 状态栏同步更新（与 syncFromPanel 行为一致）
        const app = getApp();
        // 性能追踪：记录同步开始时间，用于计算总耗时
        const syncStartTime = Date.now();
        // StatusBar 节流（200ms）：逐行赋值 = 逐行一次 COM 往返
        const statusBar = createStatusBarWriter(app);
        try {
            const result = await syncFromRemote((current, total, message, eta) => {
                // message 写入日志区，eta 独立传入 ETA 区
                updateSyncProgressDialog(current, total, message, message, eta);
                const statusMessage = eta ? `${message} | ${eta}` : message;
                statusBar.write(`[${String(current)}/${String(total)}] ${statusMessage}`);
            }, strategy, abortController.signal, isSelectedRowsOnly, 
            // conflictResolution
            undefined, timeFilter, 
            // 列映射确认结果（取消勾选 / 改目标列）
            mappingConfig);
            const wasStopped = abortController.signal.aborted;
            const { totalElapsed, totalProcessed, avgSpeed, efficiency, etaMs } = computeSyncMetrics(result, syncStartTime);
            const summaryText = `远程 ${String(result.remoteTotal)} 条 → ✅${String(result.added)} 🔄${String(result.updated)} ❌${String(result.deleted)} ⏭️${String(result.unchanged)} ⚠️${String(result.failed)} | 耗时 ${formatDuration(totalElapsed)} | ${String(avgSpeed > 0 ? avgSpeed : '?')} 行/秒 | 效率 ${String(efficiency)}%`;
            // 写入阶段被中断时收尾文案如实标注「没跑完」，不能报成一次完整同步（P2-7）
            const summary = wasStopped ? `⏹️ 已停止（写入阶段中断）：${summaryText}` : summaryText;
            // 收尾行优先级：已停止 > 有剩余 > 全部完成（写成 if/else 避免嵌套三元）
            let tailLine = '✅ 全部完成';
            if (wasStopped) {
                tailLine = '⏹️ 已停止：剩余条目未处理';
            }
            else if (etaMs > 0) {
                tailLine = `🔮 预计剩余: ${formatDuration(etaMs)}`;
            }
            const details = [
                `📥 远程数据总量: ${String(result.remoteTotal)}`,
                `➕ 新增: ${String(result.added)}`,
                `✏️ 更新: ${String(result.updated)}`,
                `🗑️ 删除: ${String(result.deleted)}`,
                `⏭️ 无变更: ${String(result.unchanged)}`,
                `❌ 失败: ${String(result.failed)}`,
                `🔍 跳过: ${String(result.skipped)}`,
                `📊 实际处理: ${String(totalProcessed)} 条`,
                `⏱️ 总耗时: ${formatDuration(totalElapsed)}`,
                `⚡️ 平均速度: ${avgSpeed > 0 ? `${String(avgSpeed)} 行/秒` : '--'}`,
                `📈 处理效率: ${String(efficiency)}%`,
                tailLine,
            ];
            const stats = {
                added: result.added,
                updated: result.updated,
                deleted: result.deleted,
                unchanged: result.unchanged,
                failed: result.failed,
                skipped: result.skipped,
                remoteTotal: result.remoteTotal,
                elapsedMs: totalElapsed,
                avgSpeed,
                strategyLabel,
            };
            const detailItems = result.details && result.details.length > 0 ? result.details : undefined;
            completeSyncProgressDialog(summary, details, wasStopped, () => {
                let scrollToRow;
                try {
                    const recordSheet = getSyncRecordSheetIfExists();
                    if (recordSheet) {
                        scrollToRow = getLastRow(recordSheet);
                    }
                }
                catch {
                    // ignore
                }
                const options = {
                    result,
                    elapsedMs: totalElapsed,
                    avgSpeed,
                    strategyLabel,
                    stopped: wasStopped,
                };
                if (scrollToRow !== undefined) {
                    options.scrollToRow = scrollToRow;
                }
                showSyncResultDialog(options);
            }, stats, detailItems);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步完成 | 远程:${String(result.remoteTotal)} ✅:${String(result.added)} 🔄:${String(result.updated)} ❌:${String(result.deleted)} ⏭️:${String(result.unchanged)} ⚠️:${String(result.failed)} 🔍:${String(result.skipped)} | 耗时:${formatDuration(totalElapsed)} | 速度:${avgSpeed > 0 ? `${String(avgSpeed)}/s` : '?'} | 效率:${String(efficiency)}%`);
            if (app?.StatusBar !== undefined)
                app.StatusBar = false;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isAborted = abortController.signal.aborted;
            if (isAborted) {
                showSyncResultDialog({
                    result: {
                        remoteTotal: 0,
                        added: 0,
                        updated: 0,
                        deleted: 0,
                        unchanged: 0,
                        failed: 0,
                    },
                    elapsedMs: Date.now() - syncStartTime,
                    avgSpeed: 0,
                    strategyLabel,
                    stopped: true,
                });
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 数据同步被用户停止');
            }
            else {
                hideSyncProgressDialog();
                bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 数据同步失败: ${errorMessage}`);
                showToast(`数据同步失败：${errorMessage}`, 'error');
            }
            if (app?.StatusBar !== undefined)
                app.StatusBar = false;
        }
    });
    bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 数据同步已触发（策略: ${strategy}），耗时: ${String(Date.now() - context.startTime)}ms`);
}
