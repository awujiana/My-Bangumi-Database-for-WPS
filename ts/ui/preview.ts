/**
 * 详细预览页面（模块化版）
 * @module ui/detail-preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */

import {
  getApp, bgmLog, BGM, readCell, trim, _getUserApiPath,
  wpsMsgBox, getCell, escapeHtml, showAlert, showToast,
  LOG_LEVELS, BGM_COLOR, type SyncRecord, findHeaderRow, getColumnMap, getSyncPreview,detectConflicts,
  extractSubjectId, mapWatchStatus, buildJsonPayload,WpsWorksheet,
  bgmRequestSync, addSyncRecord, addTagsFromStr,WpsRange ,WATCH_STATUS_MAP ,SyncToBangumiAsync
} from '../index.js';


import { getAllSyncRecords } from '../sync/syncRecord.js';
import { loadBgToken } from '../tools/util.js';

// ========== 类型定义 ==========
export interface DetailItem {
  row: number;
  name: string;
  bgmUrl: string;
  sid: string;
  status: string;
  rate: string;
  tagsRaw: string;
  finishedDate: string;
  typeNum: number;
  isUploaded: boolean;
  urlCell: WpsRange | null;
}

export interface PreviewItem {
  html: string;
  type: number;
}

export interface DetailPreviewData {
  //  所有条目（包含无效和已上传）
   allItems: PreviewItem[];
  currentFilter: string;
  totalWithType: number;
  totalValid: number;
  totalUploaded: number;
  typeCount: Record<number, number>;
  uploadedCount: Record<number, number>;
}

type ColumnMap = Map<string, number>;

// ========== 辅助函数 ==========

function safeAlert(message: string, title?: string): void {
  if (document.getElementById('bgmDialogContainer')) {
    showAlert(message, title);
  } else {
    wpsMsgBox(message, 0, 64);
  }
}

function isUploadedByColor(seqCell: WpsRange | null): boolean {
  if (!seqCell?.Interior) return false;
  const c = seqCell.Interior.Color;
  return c === BGM_COLOR.SUCCESS || c === BGM_COLOR.LIGHT_GREEN || c === BGM_COLOR.DARK_GREEN;
}

function getRowData(
  ws: WpsWorksheet | null | undefined,
  rowNum: number,
  colMap: ColumnMap,
  headerRow: number,
  seqCol = 4
): DetailItem {
  const data: DetailItem = {
    row: rowNum,
    name: '',
    bgmUrl: '',
    sid: '',
    status: '',
    rate: '',
    tagsRaw: '',
    finishedDate: '',
    typeNum: 0,
    isUploaded: false,
    urlCell: null,
  };

  const readCol = (mapKey: string): string => {
    if (colMap.has(mapKey)) {
      const col = colMap.get(mapKey)!;
      const value = trim(readCell(ws, rowNum, col));
      if (mapKey === 'Bangumi_URL') {
        data.urlCell = getCell(ws, rowNum, col) as WpsRange | null;
      }
      return value;
    }
    return '';
  };

  data.bgmUrl = readCol('Bangumi_URL');
  data.name = readCol('名称');
  data.status = readCol('是否看完');
  data.rate = readCol('打分');
  data.tagsRaw = readCol('标签/分级');
  data.finishedDate = readCol('完播日');

  if (data.bgmUrl) {
    data.sid = extractSubjectId(data.bgmUrl);
  }
  if (data.sid) {
    data.typeNum = mapWatchStatus(data.status);
  }

  const seqCell = getCell(ws, rowNum, seqCol) as WpsRange | null;
  data.isUploaded = isUploadedByColor(seqCell);
  return data;
}



/**
 * 渲染详情项的HTML内容
 * @param rowData - 详情项数据对象，包含名称、类型、标签等信息
 * @param colMap - 列映射关系，用于构建JSON载荷
 * @param ws - 工作表对象，用于构建JSON载荷
 * @returns 返回渲染后的详情项HTML字符串
 */
function renderDetailItemHtml(rowData: DetailItem, colMap: ColumnMap, ws: WpsWorksheet | null | undefined): string {
  // 定义观看状态类型映射
  const typeNames: Record<number, string> = { 0: '', 1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃' };
  const typeName = typeNames[rowData.typeNum] || '未知';

  // 解析标签数据
  const tagSet = new Set<string>();
  addTagsFromStr(tagSet, rowData.tagsRaw);
  const tags = Array.from(tagSet);
  // 生成标签HTML
  const tagsHtml = tags.length > 0
    ? `<div class="detail-value tags">${tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>`
    : '<div class="detail-value">-</div>';

  // 构建JSON请求载荷
  let jsonBody = '';
  if (rowData.sid) {
    jsonBody = buildJsonPayload(ws, rowData.row, colMap, rowData.finishedDate);
  }
  // 截断显示URL，避免过长影响UI
  const urlDisplay = rowData.bgmUrl.length > 60 ? rowData.bgmUrl.substring(0, 60) + '...' : rowData.bgmUrl;

  // 返回完整的HTML模板字符串
  return `
    <div class="detail-item ${rowData.isUploaded ? 'uploaded' : 'pending'}" data-type="${rowData.typeNum}" data-row="${rowData.row}" data-sid="${rowData.sid}" data-status="${escapeHtml(rowData.status)}">
      <div class="detail-item-header">
        <div class="detail-item-title">
          <span class="detail-item-row">行 ${rowData.row}</span>
          <span class="detail-item-name">${escapeHtml(rowData.name) || '(无名称)'}</span>
        </div>
        <button class="upload-single-btn ${rowData.isUploaded ? 'reupload' : ''}" data-row="${rowData.row}">
          ${rowData.isUploaded ? '重新上传' : '上传'}
        </button>
        ${rowData.isUploaded ? '<span class="uploaded-badge">✓ 已上传</span>' : ''}
      </div>
      <div class="detail-item-body">
        <div class="detail-row">
          <span class="detail-label">Bangumi URL</span>
          <span class="detail-value url">${escapeHtml(urlDisplay) || '(空)'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Subject ID</span>
          <span class="detail-value sid ${rowData.sid ? 'valid' : ''}">${rowData.sid || '✘ 无法提取'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">观看状态</span>
          <span class="detail-value">${typeName} (type=${rowData.typeNum})</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">完播日</span>
          <span class="detail-value">${(!rowData.finishedDate || rowData.finishedDate === 'null') ? '(空白)' : escapeHtml(rowData.finishedDate)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">评分</span>
          <span class="detail-value" style="color:#f39c12;font-weight:600;">${rowData.rate && rowData.rate !== 'true' && rowData.rate !== 'True' ? '⭐ ' + rowData.rate : '(空)'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">标签</span>
          ${tagsHtml}
        </div>
        ${rowData.sid ? `
        <div class="detail-row" style="flex-direction:column;gap:6px;">
          <span class="detail-label" style="min-width:auto;">将发送的请求</span>
          <div class="detail-value" style="color:#27ae60;font-weight:500;">
            POST /v0/users/{userId}/collections/${rowData.sid}
          </div>
          <div class="detail-value json">${escapeHtml(jsonBody)}</div>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}
 
        

// ========== 状态存储 ==========
let detailPreviewData: DetailPreviewData = {
  allItems: [],
  currentFilter: 'all',
  totalWithType: 0,
  totalValid: 0,
  totalUploaded: 0,
  typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

// 从映射表中提取标准中文状态列表（过滤数字和英文）
const VALID_STATUSES = Object.keys(WATCH_STATUS_MAP)
    .filter(key => /^[\u4e00-\u9fa5]+$/.test(key)) // 只保留纯中文
    .filter((key, idx, arr) => arr.indexOf(key) === idx); // 去重

/**
 * 将非标准状态文本标准化（如 "是" → "看过"）
 */
function normalizeStatus(rawStatus: string): string {
    const trimmed = rawStatus.trim();
    if (!trimmed) return '';
    // 如果在映射表中找到（包括中文和英文），则转换为对应的状态码，
    // 然后再映射回中文名称。也可以直接基于文本映射。
    const code = WATCH_STATUS_MAP[trimmed.toLowerCase()];
    if (code !== undefined) {
        // 根据状态码返回标准中文名称
        const reverseMap: Record<number, string> = { 0: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃' };
        return reverseMap[code] || trimmed;
    }
    return trimmed; // 未识别的保持原样
}
// ========== 公有函数 ==========




export function previewSyncContent(): void {
    bgmLog(LOG_LEVELS.INFO, '[preview] 开始执行 previewSyncContent');

    const dp = BGM.dataPreview;
    if (!dp || !dp.ws) {
        showToast('请先在预览面板中加载数据', 'warn');
        return;
    }

    const { ws, visibleRows, headerRow, dataStartRow } = dp;
    const dataRows = visibleRows.filter(r => r !== headerRow && r >= dataStartRow);
    bgmLog(LOG_LEVELS.INFO, `[preview] 过滤后得到 ${dataRows.length} 条数据行`);

    if (dataRows.length === 0) {
        showToast('没有可预览的数据行', 'info');
        return;
    }

    const colMap = getColumnMap(ws, headerRow);
    if (!colMap || colMap.size === 0) {
        showToast('无法读取列映射', 'error');
        return;
    }

    // 重置统计
    detailPreviewData = {
        allItems: [],
        currentFilter: 'all',
        totalWithType: 0,
        totalValid: 0,
        totalUploaded: 0,
        typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };

    let cardsHtml = '<div class="detail-list">';
    let actualCardCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
        const rowNum = dataRows[i];
        try {
            const rowData = getRowData(ws, rowNum, colMap, headerRow, 4);

            // 过滤无效行
            if (!rowData.bgmUrl || !rowData.sid) {
                bgmLog(LOG_LEVELS.DEBUG, `[preview] 跳过行 ${rowNum} (无 Bangumi URL)`);
                continue;
            }
            // 可选：过滤全空（名称、状态、标签全空）
            if (!rowData.name && !rowData.status && !rowData.tagsRaw) {
                bgmLog(LOG_LEVELS.DEBUG, `[preview] 跳过行 ${rowNum} (空卡片)`);
                continue;
            }

            actualCardCount++;

            // 标准化观看状态（用于 data-status 属性）
            const normalizedStatus = normalizeStatus(rowData.status);
            // 将标准化后的状态放回 rowData，便于后续统计和卡片渲染
            rowData.status = normalizedStatus;

            // 更新统计数据（仅当状态码在 1-5 范围内）
            if (rowData.typeNum >= 1 && rowData.typeNum <= 5) {
                detailPreviewData.totalWithType++;
                detailPreviewData.typeCount[rowData.typeNum] =
                    (detailPreviewData.typeCount[rowData.typeNum] || 0) + 1;
                if (rowData.isUploaded) {
                    detailPreviewData.totalUploaded++;
                    detailPreviewData.uploadedCount[rowData.typeNum] =
                        (detailPreviewData.uploadedCount[rowData.typeNum] || 0) + 1;
                }
            }

            // 生成卡片 HTML
            cardsHtml += renderDetailItemHtml(rowData, colMap, ws);
        } catch (e: any) {
            BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'previewSyncContent' });
            cardsHtml += `<div class="detail-item error">行 ${rowNum} 处理出错: ${escapeHtml((e as Error).message)}</div>`;
        }
    }
    cardsHtml += '</div>';

    // 生成统计卡片（使用 actualCardCount）
    const statsHtml = buildStatsHtml(actualCardCount);

    // 插入模态框
    const modal = document.getElementById('syncPreviewModal');
    if (!modal) return;
    const body = modal.querySelector('.modal-body');
    if (!body) {return;}
    else {
       body.addEventListener('click', (e) => {
           const target = e.target as HTMLElement;
           const btn = target.closest('.upload-single-btn');
           // 确保 btn 是 HTMLElement 且包含 dataset
           if (!(btn instanceof HTMLElement)) return;
       
           const rowNum = parseInt(btn.dataset.row || '', 10);
           if (isNaN(rowNum)) return;
       
           uploadSingleRow(rowNum, btn as HTMLButtonElement);
       });
   }
    body.innerHTML = statsHtml + cardsHtml;
    modal.style.display = 'block';

    // ----- 状态下拉筛选器 -----
    const header = modal.querySelector('.modal-header');
    if (!header) return;

    const oldSelect = document.getElementById('statusFilterSelect');
    if (oldSelect) oldSelect.remove();

    // 收集卡片中出现的标准状态及其计数
    const statusMap = new Map<string, number>();
    body.querySelectorAll<HTMLElement>('.detail-item').forEach(item => {
        const s = item.dataset.status;
        if (s && VALID_STATUSES.includes(s)) {   // 只统计有效标准状态
            statusMap.set(s, (statusMap.get(s) || 0) + 1);
        }
    });

    // 按预定义顺序排序
    const priorityStatus = ['想看', '在看', '看过', '搁置', '抛弃'];
    const sortedStatus = [
        ...priorityStatus.filter(s => statusMap.has(s)),
        ...Array.from(statusMap.keys()).filter(s => !priorityStatus.includes(s)).sort()
    ];

    const select = document.createElement('select');
    select.id = 'statusFilterSelect';
    select.className = 'status-filter-select';
    select.innerHTML = `<option value="all">全部 (${actualCardCount})</option>` +
        sortedStatus.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)} (${statusMap.get(s)})</option>`).join('');

    const syncBtn = document.getElementById('syncAllBtn');
    if (syncBtn) {
        syncBtn.insertAdjacentElement('afterend', select);
    } else {
        header.appendChild(select);
    }

    select.addEventListener('change', () => {
        const filter = select.value;
        body.querySelectorAll<HTMLElement>('.detail-item').forEach(item => {
            item.style.display = (filter === 'all' || item.dataset.status === filter) ? '' : 'none';
        });
    });

    select.value = 'all';
    select.dispatchEvent(new Event('change'));

    bgmLog(LOG_LEVELS.INFO, `[preview] 模态框已显示（${actualCardCount} 条卡片，下拉全部）`);
}

// ========== UI 辅助函数 ==========

// 生成统计卡片HTML
function buildStatsHtml(totalRows: number): string {
  const d = detailPreviewData;
  const pending = d.totalWithType - d.totalUploaded;

  return `
    <div class="detail-stats">
      <div class="stat-cards stat-cards-centered">
        <div class="stat-card">
          <div class="stat-value">${totalRows}</div>
          <div class="stat-label">总行数</div>
        </div>
        <div class="stat-card stat-card-pending">
          <div class="stat-value" style="color:#f59e0b;">${pending}</div>
          <div class="stat-label">待上传</div>
        </div>
        <div class="stat-card stat-card-uploaded">
          <div class="stat-value" style="color:#22c55e;">${d.totalUploaded}</div>
          <div class="stat-label">已上传</div>
        </div>
      </div>
    </div>
  `;
}

// ========== 单条上传 ==========
export function uploadSingleRow(rowNum: number, btnElement?: HTMLButtonElement): void {
  const token = loadBgToken();
  if (!token) {
    safeAlert('请先设置 Bangumi Token！');
    return;
  }

  if (btnElement) {
    btnElement.disabled = true;
    btnElement.classList.add('uploading');
    btnElement.textContent = '上传中...';
  }

  try {
    const app = getApp();
    if (!app?.ActiveWorkbook) throw new Error('无法获取 Application');

    const select = document.getElementById('sheetSelect') as HTMLSelectElement;
    const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value, 10) || 1;
    const ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);

    const headerRow = findHeaderRow(ws) || 1;
    const colMap: ColumnMap = getColumnMap(ws, headerRow);
    if (!colMap.has('Bangumi_URL')) throw new Error('未找到 Bangumi URL 列');

    const rowData = getRowData(ws, rowNum, colMap, headerRow, 4);
    if (!rowData.sid) throw new Error('无法提取 Subject ID');

    const jsonBody = buildJsonPayload(ws, rowNum, colMap, rowData.finishedDate);
    if (!jsonBody) throw new Error('无法构建请求体');

    const result = bgmRequestSync('POST', `/v0/users/${_getUserApiPath()}/collections/${rowData.sid}`, jsonBody, token);
    const statusCode = result?.code || 0;
    const seqCell = getCell(ws, rowNum, 4) as WpsRange | null;

    if ([200, 201, 202, 204].includes(statusCode)) {
      if (seqCell?.Interior) seqCell.Interior.Color = BGM_COLOR.SUCCESS;

      if (btnElement) {
        btnElement.classList.remove('uploading');
        btnElement.classList.add('reupload');
        btnElement.textContent = '重新上传';
        btnElement.disabled = false;
      }

      const detailItem = btnElement?.closest('.detail-item') as HTMLElement | null;
      if (detailItem) {
        detailItem.classList.remove('pending');
        detailItem.classList.add('uploaded');
        if (!detailItem.querySelector('.uploaded-badge')) {
          const header = detailItem.querySelector('.detail-item-header');
          if (header) {
            const badge = document.createElement('span');
            badge.className = 'uploaded-badge';
            badge.textContent = '✓ 已上传';
            header.appendChild(badge);
          }
        }
      }

      addSyncRecord({
        name: rowData.name || '(无名称)',
        url: rowData.bgmUrl,
        sid: rowData.sid,
        type: '',
        content: jsonBody,
        status: '成功',
        message: '行 ' + rowNum,
        count: 1,
      });

    } else {
      if (seqCell?.Interior) seqCell.Interior.Color = BGM_COLOR.FAIL;

      if (btnElement) {
        btnElement.classList.remove('uploading');
        btnElement.classList.add('error');
        btnElement.textContent = '✗ 失败';
        btnElement.disabled = false;
      }

      addSyncRecord({
        name: rowData.name || '(无名称)',
        url: rowData.bgmUrl,
        sid: rowData.sid,
        type: '',
        content: jsonBody,
        status: '失败',
        message: result?.message || 'HTTP ' + statusCode,
        count: 1,
      });
      BGM.handleError(new Error('上传失败: ' + (result?.message || '未知错误')), { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'UploadSingleRow' });
      showToast('上传失败: ' + ((result?.message || '未知错误').substring(0, 60)), 'error');
    }
  } catch (e: any) {
    BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.ERROR, context: 'UploadSingleRow' });
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.classList.remove('uploading');
      btnElement.classList.add('error');
      btnElement.textContent = '✗ 错误';
    }
    showToast('上传出错: ' + e.message.substring(0, 60), 'error');
    BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.ERROR, context: 'UploadSingleRow' });
  }
}





export function showDetailModal(): void {
  const modal = document.getElementById('detailModal');
  if (modal) (modal as HTMLElement).style.display = 'flex';
}

export function closeDetailModal(): void {
  const modal = document.getElementById('detailModal');
  if (modal) (modal as HTMLElement).style.display = 'none';
}

export function viewSyncRecordDetail(sid: string): void {
  if (typeof getAllSyncRecords !== 'function') {
    safeAlert('同步记录功能不可用！');
    return;
  }
  const records = getAllSyncRecords();
  const record = records.find((r: SyncRecord) => String(r.sid) === String(sid));
  if (!record) {
    safeAlert('未找到该同步记录');
    return;
  }
  let content = record.content || '';
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch (e: any) {
    BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'ViewSyncRecordDetail' });
  }
  const detail = `同步记录详情\n\n名称: ${record.name || ""}\nSID: ${record.sid || ""}\nURL: ${record.url || ""}\n时间: ${record.time || ""}\n状态: ${record.status || ""}\n同步次数: ${record.count || ""}\n备注: ${record.message || ""}\n\n同步内容:\n${content}`;
  safeAlert(detail, '同步记录详情');
}




/*
 * 一键同步所有可见数据行（由 BGM.sync.startSync 调用）
 * - 依赖 BGM.dataPreview 中的预览数据
 * - 使用 getSyncPreview 和 detectConflicts 进行统计和冲突检测
 * - 调用 SyncToBangumiAsync 执行批量同步
 * - 通过事件总线通知进度
 * @returns 同步结果统计 { success, fail, skip }
 */
export async function syncAllRows(): Promise<{ success: number; fail: number; skip: number }> {
    const dp = BGM.dataPreview;
    if (!dp?.ws) {
        showToast('请先在预览面板中加载数据', 'warn');
        return { success: 0, fail: 0, skip: 0 };
    }

    const token = loadBgToken();
    if (!token) {
        safeAlert('请先设置 Bangumi Token！');
        return { success: 0, fail: 0, skip: 0 };
    }

    const { ws, visibleRows, headerRow, dataStartRow } = dp;
    const dataRows = visibleRows.filter(r => r !== headerRow && r >= dataStartRow);
    if (dataRows.length === 0) {
        showToast('没有可同步的数据行', 'info');
        return { success: 0, fail: 0, skip: 0 };
    }

    const colMap = getColumnMap(ws, headerRow);
    if (!colMap || colMap.size === 0) {
        showToast('无法读取列映射', 'error');
        return { success: 0, fail: 0, skip: 0 };
    }

    const lastRow = Math.max(...dataRows); // 使用可见行最大行号作为数据范围

    // ---------- 1. 同步预览统计 ----------
    const preview = getSyncPreview(ws, colMap, lastRow, headerRow);

    // ---------- 2. 冲突检测（可选，默认以 Excel 覆盖） ----------
    let conflictSids: Set<string> | undefined = undefined;
    let conflictInfo = '';
    try {
        const { conflicts, conflictCount } = await detectConflicts(ws, colMap, lastRow, headerRow, token);
        if (conflictCount > 0) {
            // 使用 Ribbon 的统一策略：默认以 Excel 覆盖，所以只需记录，不跳过
            conflictInfo = `检测到 ${conflictCount} 条冲突，将以 Excel 数据覆盖。`;
            bgmLog(LOG_LEVELS.WARN, conflictInfo);
            // 如需跳过，可启用下行代码（需传入 skipSids 给 SyncToBangumiAsync）
            // conflictSids = new Set(conflicts.map(c => c.sid));
        }
    } catch (e: any) {
        const bgmErr = BGM.handleError(e, { showAlert: false });
        bgmErr.message = '冲突检测失败，已跳过此步骤。原始错误: ' + bgmErr.message;
    }

    // ---------- 3. 读取增量同步设置 ----------
    const app = (window as any).Application;
    let incremental = false;
    try {
        incremental = app?.PluginStorage?.getItem('bgm_incremental_sync') === 'true';
    } catch (e: any) {
        bgmLog(LOG_LEVELS.WARN, `[syncAllRows] 读取增量同步设置失败: ${e.message}`);
    }
    bgmLog(LOG_LEVELS.INFO, `[syncAllRows] 增量同步: ${incremental ? '开启' : '关闭'}`);

    // ---------- 4. 执行同步 ----------
    try {
        const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
            skipSids: conflictSids,        // 跳过冲突的 sid 集合
            incremental,                  // 从 Ribbon 设置读取
            onProgress: (current, total, message) => {
                BGM.setSyncProgress(current, total, message);
            },
            onItemComplete: (row, success, _result) => {
                // 这里可以不做额外处理，因为颜色标记由内部完成
            }
        });

        BGM.setSyncComplete(result);
        showToast(`同步完成：成功 ${result.success}，失败 ${result.fail}，跳过 ${result.skip}`, 'success');
        return result;
    } catch (err: any) {
        BGM.handleError(err, { showAlert: true });
        return { success: 0, fail: 0, skip: 0 };
    }
}