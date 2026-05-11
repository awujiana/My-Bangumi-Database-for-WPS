/**
 * 详细预览页面（模块化版）
 * @module ui/detail-preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */
const ITEM_HEIGHT = 180;   // 每个条目的高度（根据实际样式调整）
const CONTAINER_HEIGHT = 600;
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
    bgmLog(LOG_LEVELS.INFO, '[preview] 开始执行 previewSyncContent');

    const dp = BGM.dataPreview;
    if (!dp || !dp.ws) {
        showToast('请先在预览面板中加载数据', 'warn');
        return;
    }

    const { ws, visibleRows, headerRow, dataStartRow, previewColStart, previewColEnd, columnCount, headerNames } = dp;

    const dataRows = visibleRows.filter(r => r !== headerRow && r >= dataStartRow);
    bgmLog(LOG_LEVELS.INFO, `[preview] 过滤后得到 ${dataRows.length} 条数据行`);

    if (dataRows.length === 0) {
        showToast('没有可预览的数据行', 'info');
        return;
    }

    // 生成表格 HTML（与之前相同）
    let html = `<table class="preview-table"><thead><tr><th>#</th>`;
    for (let i = 0; i < columnCount; i++) {
        html += `<th>${escapeHtml(headerNames[i] || '')}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        html += `<tr><td class="preview-row-num">${row}</td>`;
        for (let c = previewColStart; c <= previewColEnd; c++) {
            html += `<td>${escapeHtml(readCell(ws, row, c))}</td>`;
        }
        html += `</tr>`;
    }
    html += `</tbody></table>`;

    // 直接使用页面已有的模态框
    const modal = document.getElementById('syncPreviewModal');
    const body = modal?.querySelector('.modal-body');
    if (modal && body) {
        body.innerHTML = html;
        modal.style.display = 'block';
        bgmLog(LOG_LEVELS.INFO, '[preview] 模态框已显示');
    } else {
        bgmLog(LOG_LEVELS.ERROR, '[preview] syncPreviewModal 或 .modal-body 不存在');
    }
}
let virtualScrollStart = 0;
let virtualScrollEnd = 0;

function renderVisibleItems(items: PreviewItem[]) {
    const container = document.getElementById('virtualScrollContainer');
    const content = document.getElementById('virtualScrollContent');
    if (!container || !content) return;

    const scrollTop = container.scrollTop;
    const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const endIndex = Math.min(
        startIndex + Math.ceil(CONTAINER_HEIGHT / ITEM_HEIGHT) + 5,
        items.length
    );

    if (startIndex === virtualScrollStart && endIndex === virtualScrollEnd) return;
    virtualScrollStart = startIndex;
    virtualScrollEnd = endIndex;

    const visibleItems = items.slice(startIndex, endIndex);
    content.style.top = (startIndex * ITEM_HEIGHT) + 'px';
    content.innerHTML = visibleItems.map(item => item.html).join('');
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
    const allItems = detailPreviewData.allItems;
    const filteredItems = filterType === 'all' 
        ? allItems 
        : allItems.filter(item => item.type === parseInt(filterType as string));

    // 重新渲染虚拟滚动
    const scrollContainer = document.getElementById('virtualScrollContainer');
    const scrollInner = document.getElementById('virtualScrollInner');
    const scrollContent = document.getElementById('virtualScrollContent');
    if (!scrollContainer || !scrollInner || !scrollContent) return;

    // 更新总高度
    scrollInner.style.height = `${filteredItems.length * ITEM_HEIGHT}px`;
    // 重置滚动位置
    scrollContainer.scrollTop = 0;
    // 重置虚拟状态
    virtualScrollStart = 0;
    virtualScrollEnd = 0;
    // 重新渲染
    renderVisibleItems(filteredItems);

    // 更新统计卡片（可选）
    const statCards = document.querySelectorAll('.stat-card .stat-value');
    if (statCards.length >= 3) {
        const d = detailPreviewData;
        if (filterType === 'all') {
            statCards[0].textContent = String(d.totalWithType);
            statCards[1].textContent = String(d.totalWithType - d.totalUploaded);
            statCards[2].textContent = String(d.totalUploaded);
        } else {
            const typeNum = parseInt(filterType as string);
            const typeTotal = d.typeCount[typeNum] || 0;
            const typeUploaded = d.uploadedCount[typeNum] || 0;
            statCards[0].textContent = String(typeTotal);
            statCards[1].textContent = String(typeTotal - typeUploaded);
            statCards[2].textContent = String(typeUploaded);
        }
    }

    // 更新按钮状态
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (filterType === 'all' && btn.classList.contains('all')) btn.classList.add('active');
        else if (btn.classList.contains('type-' + filterType)) btn.classList.add('active');
    });
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

