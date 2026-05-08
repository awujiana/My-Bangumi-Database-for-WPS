/**
 * 详细预览页面（模块化版）
 * @module ui/detail-preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */

import {
  getApp, bgmLog, BGM, readCell, trim, _getUserApiPath,
  wpsMsgBox, getCell, escapeHtml, showAlert, showToast,
  LOG_LEVELS, BGM_COLOR, type SyncRecord, findHeaderRow, getColumnMap, getSequentialRowsBySeqCol,
  extractSubjectId, mapWatchStatus, buildJsonPayload,
  bgmRequestSync, addSyncRecord, addTagsFromStr,WpsRange 
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
  ws: any,
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

function renderDetailItemHtml(rowData: DetailItem, colMap: ColumnMap, ws: any): string {
  const typeNames: Record<number, string> = { 0: '', 1: '想看', 2: '在看', 3: '看过', 4: '搁置', 5: '抛弃' };
  const typeName = typeNames[rowData.typeNum] || '未知';

  const tagSet = new Set<string>();
  addTagsFromStr(tagSet, rowData.tagsRaw);
  const tags = Array.from(tagSet);
  const tagsHtml = tags.length > 0
    ? `<div class="detail-value tags">${tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>`
    : '<div class="detail-value">-</div>';

  let jsonBody = '';
  if (rowData.sid) {
    jsonBody = buildJsonPayload(ws, rowData.row, colMap, rowData.finishedDate);
  }
  const urlDisplay = rowData.bgmUrl.length > 60 ? rowData.bgmUrl.substring(0, 60) + '...' : rowData.bgmUrl;

  return `
    <div class="detail-item ${rowData.isUploaded ? 'uploaded' : 'pending'}" data-type="${rowData.typeNum}" data-row="${rowData.row}" data-sid="${rowData.sid}">
      <div class="detail-item-header">
        <div class="detail-item-title">
          <span class="detail-item-row">行 ${rowData.row}</span>
          <span class="detail-item-name">${escapeHtml(rowData.name) || '(无名称)'}</span>
        </div>
        ${rowData.isUploaded
      ? `<button class="upload-single-btn reupload" onclick="window.uploadSingleRow(${rowData.row}, this)">重新上传</button>`
      : `<button class="upload-single-btn" onclick="window.uploadSingleRow(${rowData.row}, this)">上传</button>`
    }
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

// ========== 公有函数 ==========

export function previewSyncContent(): void {
  console.log('[preview] 开始执行 previewSyncContent');

  const select = document.getElementById('sheetSelect') as HTMLSelectElement;
  const endRowInput = document.getElementById('endRow') as HTMLInputElement;
  const startRowInput = document.getElementById('startRow') as HTMLInputElement;
  const sheetIndex = BGM.sheet.lockedIndex || parseInt(select?.value, 10) || 1;
  const userEndRow = parseInt(endRowInput?.value, 10) || 0;
  const selectMode = (document.querySelector('input[name="selectMode"]:checked') as HTMLInputElement)?.value || 'auto';

  const app = getApp();
  if (!app?.ActiveWorkbook) {
    safeAlert('无法获取 WPS Application 对象！');
    return;
  }

  let ws;
  try {
    ws = app.ActiveWorkbook.Worksheets.Item(sheetIndex);
  } catch (e) {
    safeAlert('无法获取工作表！');
    return;
  }

  const headerRow = findHeaderRow(ws) || 1;
  const dataStartRow = headerRow + 1;
  const colMap = getColumnMap(ws, headerRow);

  let lastRow = 1;
  try {
    const lastCell = getCell(ws, ws.Rows.Count, 4) as WpsRange | null;
    if (lastCell?.End) {
      lastRow = lastCell.End(-4162).Row;
    }
  } catch (e) {
    lastRow = 500;
  }

  const actualEndRow = userEndRow > 0 ? Math.min(userEndRow, lastRow) : lastRow;
  let rowsToPreview: number[] = [];

  if (selectMode === 'auto') {
    const seqResult = getSequentialRowsBySeqCol(dataStartRow, actualEndRow);
    rowsToPreview = seqResult?.validRows || [];
    if (rowsToPreview.length === 0) {
      for (let i = dataStartRow; i <= actualEndRow; i++) rowsToPreview.push(i);
    }
  } else {
    let manualStart = parseInt(startRowInput?.value, 10) || dataStartRow;
    let manualEnd = parseInt(endRowInput?.value, 10) || lastRow;
    if (isNaN(manualStart)) manualStart = dataStartRow;
    if (isNaN(manualEnd)) manualEnd = lastRow;
    if (manualStart > manualEnd) { manualStart = dataStartRow; manualEnd = lastRow; }
    for (let i = manualStart; i <= manualEnd; i++) rowsToPreview.push(i);
  }

  console.log('[preview] 待预览行数:', rowsToPreview.length);
  if (rowsToPreview.length === 0) {
    safeAlert('没有数据可预览！');
    return;
  }

  detailPreviewData = {
    allItems: [],
    currentFilter: 'all',
    totalWithType: 0,
    totalValid: 0,
    totalUploaded: 0,
    typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  const allValidRows: DetailItem[] = [];
  for (const rowNum of rowsToPreview) {
    const rowData = getRowData(ws, rowNum, colMap, headerRow, 4);
    if (!rowData.sid || rowData.typeNum === 0) continue;
    detailPreviewData.totalValid++;
    detailPreviewData.typeCount[rowData.typeNum]++;
    detailPreviewData.totalWithType++;
    if (rowData.isUploaded) {
      detailPreviewData.totalUploaded++;
      detailPreviewData.uploadedCount[rowData.typeNum]++;
    }
    allValidRows.push(rowData);
  }

  const itemsData: PreviewItem[] = allValidRows.map(rowData => ({
    html: renderDetailItemHtml(rowData, colMap, ws),
    type: rowData.typeNum,
  }));
  detailPreviewData.allItems = itemsData;

  const modalToolbar = document.getElementById('detailModalToolbar');
  const modalBody = document.getElementById('detailModalBody');
  if (modalToolbar && modalBody) {
    modalToolbar.innerHTML = buildFilterToolbar();
    modalBody.innerHTML = buildStatsHtml(rowsToPreview.length) + '<div id="detailItemsContainer">' + itemsData.map(item => item.html).join('') + '</div>';
    const modal = document.getElementById('detailModal') as HTMLElement;
    if (modal) {
      modal.style.display = 'flex';
      console.log('[preview] 模态框已显示');
    } else {
      console.error('[preview] 找不到 detailModal 元素');
      safeAlert('预览界面缺失，请联系开发者');
    }
  } else {
    console.error('[preview] 找不到 detailModalToolbar 或 detailModalBody');
    safeAlert('预览界面缺失，请联系开发者');
  }
}

// ========== UI 辅助函数 ==========
function buildFilterToolbar(): string {
  const d = detailPreviewData;
  let html = `<button class="filter-btn all active" onclick="window.filterDetailItems('all')">全部 (${d.totalWithType})</button>`;
  const addBtn = (type: number, label: string) => {
    if (d.typeCount[type] > 0) {
      html += `<button class="filter-btn type-${type}" onclick="window.filterDetailItems(${type})">${label} (${d.typeCount[type]})</button>`;
    }
  };
  addBtn(3, '看过');
  addBtn(2, '在追');
  addBtn(1, '想看');
  addBtn(4, '搁置');
  addBtn(5, '抛弃');
  return html;
}

function buildStatsHtml(totalRows: number): string {
  const d = detailPreviewData;
  const pending = d.totalWithType - d.totalUploaded;
  return `
    <div class="detail-stats">
      <div class="stat-card">
        <div class="stat-value">${totalRows}</div>
        <div class="stat-label">总行数</div>
      </div>
      <div class="stat-card" style="border-left:3px solid #f59e0b;">
        <div class="stat-value" style="color:#f59e0b;">${pending}</div>
        <div class="stat-label">待上传</div>
      </div>
      <div class="stat-card success" style="border-left:3px solid #22c55e;">
        <div class="stat-value" style="color:#22c55e;">${d.totalUploaded}</div>
        <div class="stat-label">已上传</div>
      </div>
    </div>
    <div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;">
      <span class="status-badge" style="background:#1a3a35;color:#4ade80;">D列序列号</span>
      ${createTypeBadges()}
    </div>
  `;
}

function createTypeBadges(): string {
  const d = detailPreviewData;
  const labels: Record<number, string> = { 3: '看过', 2: '在看', 1: '想看', 4: '搁置', 5: '抛弃' };
  let badges = '';
  for (const type in labels) {
    const count = d.typeCount[parseInt(type, 10)] || 0;
    if (count > 0) {
      const uploaded = d.uploadedCount[parseInt(type, 10)] || 0;
      badges += `<span class="status-badge type-${type}">${labels[parseInt(type, 10)]} ${count}${uploaded > 0 ? ' ✓' + uploaded : ''}</span>`;
    }
  }
  return badges;
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

      updateUploadStats();
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
      showToast('上传失败: ' + ((result?.message || '未知错误').substring(0, 60)), 'error');
    }
  } catch (e: any) {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.classList.remove('uploading');
      btnElement.classList.add('error');
      btnElement.textContent = '✗ 错误';
    }
    showToast('上传出错: ' + e.message.substring(0, 60), 'error');
  }
}

// ========== 模态框控制 ==========
export function updateUploadStats(): void {
  const modalBody = document.getElementById('detailModalBody');
  if (!modalBody) return;
  const d = detailPreviewData;
  const cards = modalBody.querySelectorAll('.stat-card .stat-value');
  if (cards.length >= 3) {
    cards[1].textContent = String(d.totalWithType - d.totalUploaded);
    cards[2].textContent = String(d.totalUploaded);
  }
}

export function filterDetailItems(filterType: string | number): void {
  detailPreviewData.currentFilter = String(filterType);
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.remove('active');
    if (filterType === 'all' && btn.classList.contains('all')) btn.classList.add('active');
    else if (btn.classList.contains('type-' + filterType)) btn.classList.add('active');
  });

  const container = document.getElementById('detailItemsContainer');
  if (!container) return;

  let visibleCount = 0;
  container.querySelectorAll('.detail-item').forEach((item) => {
    const match = filterType === 'all' || item.getAttribute('data-type') === String(filterType);
    (item as HTMLElement).style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });

  const modalBody = document.getElementById('detailModalBody');
  const statCards = modalBody?.querySelectorAll('.stat-card .stat-value');
  if (!statCards || statCards.length < 3) return;

  const d = detailPreviewData;
  if (filterType === 'all') {
    statCards[0].textContent = String(d.totalWithType);
    statCards[1].textContent = String(d.totalWithType - d.totalUploaded);
    statCards[2].textContent = String(d.totalUploaded);
  } else {
    const typeNum = parseInt(String(filterType), 10);
    statCards[0].textContent = String(visibleCount);
    statCards[1].textContent = String((d.typeCount[typeNum] || 0) - (d.uploadedCount[typeNum] || 0));
    statCards[2].textContent = String(d.uploadedCount[typeNum] || 0);
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
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch (e) {}
  const detail = `同步记录详情\n\n名称: ${record.name || ""}\nSID: ${record.sid || ""}\nURL: ${record.url || ""}\n时间: ${record.time || ""}\n状态: ${record.status || ""}\n同步次数: ${record.count || ""}\n备注: ${record.message || ""}\n\n同步内容:\n${content}`;
  safeAlert(detail, '同步记录详情');
}

// ========== 挂载到 window（仅用于 HTML onclick 调用）==========
if (typeof window !== 'undefined') {
  (window as any).uploadSingleRow = uploadSingleRow;
  (window as any).previewSyncContent = previewSyncContent;
  (window as any).filterDetailItems = filterDetailItems;
  (window as any).updateUploadStats = updateUploadStats;
  (window as any).showDetailModal = showDetailModal;
  (window as any).closeDetailModal = closeDetailModal;
  (window as any).viewSyncRecordDetail = viewSyncRecordDetail;
}