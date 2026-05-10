/**
 * Bangumi API 同步模块（修复版）
 * @module bangumi
 * @description 从 Excel 读取条目并批量同步到 Bangumi 收藏
 */


import {  showUserIdDialog,httpRequest, showAlert,Result,BatchSyncResult,getApp, bgmLog, getCell, getCellValue, sleep, loadBgToken,
         _setBgmUserId, _getBgmUserId, _getUserApiPath, trim,
         colNumToLetter, storeBgToken, readCell ,BGM ,XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, delay, readRangeValues,COLUMN_RULES, TYPE_TEXT_MAP,COLUMNS,WATCH_STATUS_MAP,HEADER_KEYWORDS,URL_PATTERNS,
    getColumnMap,} from '../index.js';


// 定义接口类型
interface FilterStatus {
  hasFilter: boolean;
  filteredColumns: Array<{ column: number; columnName: string; criteria: string }>;
  hiddenRows: number[];
  visibleRows: number[];
  filterDetails: string;
  columnCounts: { [key: number]: { [key: string]: number } };
  totalRows: number;
  visibleCount: number;
  hiddenCount: number;
}

interface SequentialRowsResult {
  validRows: number[];
  filteredRows: Array<{ startSeq: number; endSeq: number; count: number; afterRow: number }>;
  totalFiltered: number;
  hasFilter: boolean;
  visibleCount: number;
  hiddenCount: number;
}


interface CollectionItem {
  seq?: number | string;
  time?: string;
  name?: string;
  url?: string;
  sid?: string;
  type?: string | number;
  count?: number;
  content?: string;
  status?: string;
  message?: string;
  comment?: string;
  row?: number;
}

interface SyncOptions {
  onProgress?: (current: number, total: number, message: string) => void;
  onItemComplete?: (row: number, success: boolean, result: { code: number; message: string }) => void;
}

interface ColumnMap extends Map<string, number> {}

// 定义 Excel Range 接口
interface ExcelRange {
  Value2?: any;
  Interior?: {
    Color?: number;
    ColorIndex?: number;
  };
  Font?: {
    Bold?: boolean;
    Size?: number;
    Color?: number;
  };
  Row?: number;
  Column?: number;
  [key: string]: any;
}


let _cachedTotalRows = 0;

// ========== 工具函数 ==========
export function parseJsonBodySummary(jsonStr: string): string {
  if (!jsonStr) return "(空)";
  try {
    let obj = JSON.parse(jsonStr);
    let parts: string[] = [];
    if (obj.type !== undefined) parts.push("状态:" + (TYPE_TEXT_MAP[obj.type] || obj.type));
    if (obj.rate !== undefined && obj.rate > 0) parts.push("评分:" + obj.rate);
    if (obj.tags && obj.tags.length > 0) parts.push("标签:[" + obj.tags.join(",") + "]");
    if (obj.comment) {
      let comment = obj.comment.length > 30 ? obj.comment.substring(0, 30) + "..." : obj.comment;
      parts.push("评价:" + comment);
    }
    return parts.length > 0 ? parts.join(" | ") : "(仅标记状态)";
  } catch (e: any) {
    return jsonStr;
  }
}

export function isEmptyValue(val: any): boolean {
  return val === null || val === undefined || val === "" ||
         val === "null" || val === "NULL" || val === "Null" || val === "undefined";
}

function jsonEscape(s: string): string {
  s = s.split("\\").join("\\\\");
  s = s.split('"').join('\\"');
  s = s.split("\n").join("\\n");
  s = s.split("\r").join("\\n");
  s = s.split("\t").join("\\t");
  return s;
}

// ========== 获取数据工作表 ==========
export function getDataSheet(): any {
  let app = getApp();
  if (!app || !app.ActiveWorkbook) return null;

  if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
    try {
      return app.ActiveWorkbook.Worksheets.Item(BGM.sheet.lockedIndex);
    } catch (e: any) {
      bgmLog(LOG_LEVELS.WARN, "getDataSheet 锁定工作表失败: " + e.message);
    }
  }

  return app.ActiveWorkbook.ActiveSheet;
}

export function getBgmtoken(): string | null {
  return loadBgToken();
}

export function getLastRow(ws: any): number {
  try {
    const cell = getCell(ws, ws.Rows.Count, COLUMNS.SEQUENCE) as any;
    if (cell?.Value2) {
      return cell.End(XL.UP).Row;
    }
  } catch (e) {}
  return 1000;
}

export function extractSubjectId(url: string): string {
  if (!url) return "";
  for (let pattern of URL_PATTERNS) {
    let match = url.match(pattern);
    if (match) return match[1];
  }
  return "";
}

export function findHeaderRow(ws: any, startRow?: number): number {
  startRow = startRow || 1;
  for (let row = startRow; row <= 50; row++) {
    let matchCount = 0;
    for (let col = 1; col <= 50; col++) {
      try {
        let cellVal = String(getCellValue(ws, row, col)).toLowerCase();
        if (!cellVal) continue;
        for (let header of HEADER_KEYWORDS) {
          if (cellVal.indexOf(header.toLowerCase()) >= 0) {
            matchCount++;
            break;
          }
        }
        if (matchCount >= 3) break;
      } catch (e) {}
    }
    if (matchCount >= 3) return row;
  }
  return 0;
}



export function mapWatchStatus(status: any): number {
  if (isEmptyValue(status)) return 0;
  let s = trim(status);
  let result = WATCH_STATUS_MAP[s.toLowerCase()];
  if (result !== undefined) return result;
  if (s.indexOf("追") >= 0) return 2;
  if (s.indexOf("搁") >= 0 || s.indexOf("停") >= 0) return 4;
  if (s.indexOf("弃") >= 0) return 5;
  return 0;
}

export function addTagsFromStr(tagSet: Set<string>, raw: any): void {
  if (raw === "") return;
  let seps = ["|", "、", "/", "\\", ",", ";", "｜", "，", "。"];
  let s = String(raw);
  for (let sep of seps) {
    s = s.split(sep).join("|");
  }
  let parts = s.split("|");
  for (let p of parts) {
    let tag = trim(p);
    tag = tag.replace(/^\s+|\s+$/g, "");
    tag = tag.split(" ").join("_");
    tag = tag.split("\t").join("_");
    if (tag !== "" && !tagSet.has(tag) && tag.length > 0) {
      tagSet.add(tag);
    }
  }
}

function buildTags(ws: any, row: number, colMap: ColumnMap): string {
  let tagSet = new Set<string>();
  if (colMap.has("标签/分级")) {
    addTagsFromStr(tagSet, trim(getCellValue(ws, row, colMap.get("标签/分级")!)));
  }
  if (colMap.has("特点/印象")) {
    addTagsFromStr(tagSet, trim(getCellValue(ws, row, colMap.get("特点/印象")!)));
  }
  if (tagSet.size === 0) return "";
  let tags: string[] = [];
  for (let tag of tagSet) {
    tags.push('"' + tag + '"');
  }
  return tags.join(",");
}


export function buildJsonPayload(ws: any, row: number, colMap: ColumnMap, finishedDate: any): string {
  let watchStatus = "";
  if (colMap.has("是否看完")) {
    watchStatus = trim(getCellValue(ws, row, colMap.get("是否看完")!));
  }
  let bgmType = mapWatchStatus(watchStatus);
    if (bgmType === 0) return "";
    
    let parts: string[] = [];
    parts.push('"type":' + bgmType);
    
    if (colMap.has("打分")) {
      let rateVal = getCellValue(ws, row, colMap.get("打分")!);
      let rateNum = parseInt(String(rateVal), 10);
      if (!isNaN(rateNum)) {
        let rate = Math.max(0, Math.min(10, rateNum));
        if (rate >= 0) parts.push('"rate":' + rate);
      }
    }
    
    if (colMap.has("剧透/感言")) {
      let comment = trim(getCellValue(ws, row, colMap.get("剧透/感言")!));
        if (comment !== "") {
          parts.push('"comment":"' + jsonEscape(comment) + '"');
        }
      }
      
      let tags = buildTags(ws, row, colMap);
      if (tags !== "") parts.push('"tags":[' + tags + ']');
      
      // 新增：支持私密收藏
      if (colMap.has("私密收藏")) {
        const privateVal = trim(getCellValue(ws, row, colMap.get("私密收藏")!)).toLowerCase();
        if (privateVal === "是" || privateVal === "1" || privateVal === "true") {
          parts.push('"private":true');
        }
      }
      
      return "{" + parts.join(",") + "}";
    }
    
    export function bgmRequestSync(method: string, endpoint: string, body: any, token: string): { code: number; message: string } {
      const { MAX_RETRIES, RETRY_DELAY_BASE } = BGM_CONFIG;
      let retries = 0;
      
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      if (!validMethods.includes(method.toUpperCase())) {
        return { code: 0, message: "Invalid HTTP method" };
      }
      if (!endpoint || typeof endpoint !== 'string') {
        return { code: 0, message: "Invalid endpoint" };
      }
      if (endpoint.includes('..') || endpoint.includes('//') || endpoint.startsWith('http')) {
        return { code: 0, message: "Invalid endpoint path" };
      }
      if (body && typeof body === 'string' && body.trim().startsWith('{')) {
        try { JSON.parse(body); } catch (e) { return { code: 0, message: "Invalid JSON body" }; }
      }
      
      while (retries <= MAX_RETRIES) {
        let xhr = new XMLHttpRequest();
        xhr.open(method, BGM_CONFIG.API_BASE + endpoint, false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");
        try {
          xhr.send(body);
          let statusCode = xhr.status;
          if (statusCode === 204) return { code: statusCode, message: "OK" };
          if (statusCode === 200 || statusCode === 201 || statusCode === 202) return { code: statusCode, message: xhr.responseText };
          if (statusCode === 429 && retries < MAX_RETRIES) {
        retries++;
        let retryDelay = RETRY_DELAY_BASE * Math.pow(2, retries - 1);
        sleep(retryDelay);
        continue;
      }
      return { code: statusCode, message: xhr.responseText || "Error" };
    } catch (err: any) {
      return { code: 0, message: "Error: " + err.message };
    }
  }
  return { code: 429, message: `超过最大重试次数(${MAX_RETRIES}次)` };
}

export async function bgmRequest(method: string, endpoint: string, body: any, token: string): Promise<{ code: number; message: string }> {
  return bgmRequestSync(method, endpoint, body, token);
}






// 异步同步函数 SyncToBangumiAsync
export async function SyncToBangumiAsync(
    ws: any,
    colMap: ColumnMap,
    token: string,
    lastRow: number,
    headerRow: number,
    options: SyncOptions = {}
): Promise<BatchSyncResult> {
    const { onProgress, onItemComplete } = options;
    if (!ws || !colMap || !token || !lastRow || !headerRow) throw new Error('缺少必要的同步参数');

    BGM.sync.isRunning = true;
    BGM.sync.lastSyncTime = null;

    // 获取同步记录工作表
    let syncRecordSheet = null;
    if (typeof (window as any).getOrCreateSyncRecordSheet === 'function') {
        syncRecordSheet = (window as any).getOrCreateSyncRecordSheet();
    }

    // ========== 1. 筛选状态检测与可见行获取 ==========
    let visibleRows: number[] = [];
    let isFiltered = false;
    try {
        const autoFilter = ws.AutoFilter;
        if (autoFilter && (autoFilter.FilterMode === true || ws.AutoFilterMode === true)) {
            isFiltered = true;
            // 通过 SpecialCells 或回退获取可见行
            const filterRange = autoFilter.Range;
            const filterStartRow = filterRange ? filterRange.Row + 1 : headerRow + 1;
            try {
                const lastCell = getCell(ws, lastRow, 4) as any;
                const actualLastRow = lastCell?.End ? lastCell.End(-4162).Row : lastRow;
                const rangeStr = `${colNumToLetter(4)}${filterStartRow}:${colNumToLetter(4)}${actualLastRow}`;
                const visibleCells = ws.Range(rangeStr).SpecialCells(12);
                if (visibleCells) {
                    for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                        const area = visibleCells.Areas.Item(a);
                        for (let r = 1; r <= area.Rows.Count; r++) {
                            visibleRows.push(area.Rows.Item(r).Row);
                        }
                    }
                }
            } catch (e) {
                // 回退到逐行检查
                const checkEnd = Math.min(lastRow, headerRow + 5000);
                for (let r = filterStartRow; r <= checkEnd; r++) {
                    try {
                        if (!ws.Rows(r).Hidden) visibleRows.push(r);
                    } catch (e2) { visibleRows.push(r); }
                }
            }
        }
    } catch (e) { /* 忽略筛选检测错误 */ }

    // 如果没有筛选，所有行都可见
    if (!isFiltered || visibleRows.length === 0) {
        for (let r = headerRow + 1; r <= lastRow; r++) visibleRows.push(r);
    }

    // ========== 2. 批量读取数据缓存 ==========
    const neededKeys = ['Bangumi_URL', '名称', '是否看完', '打分', '标签/分级', '完播日', '类别', '剧透/感言', '集号'];
    let maxCol = 1;
    for (const key of neededKeys) {
        if (colMap.has(key)) maxCol = Math.max(maxCol, colMap.get(key)!);
    }
    const totalDataRows = lastRow - headerRow;
    const allData = readRangeValues(ws, headerRow + 1, lastRow, 1, maxCol);

    // 辅助取值函数：从缓存中取，若缓存失效则回退到逐单元格读取
    const getField = (row: number, key: string): string => {
        if (allData && Array.isArray(allData)) {
            const col = colMap.get(key);
            if (!col) return '';
            const rowIdx = row - headerRow - 1;
            if (rowIdx >= 0 && rowIdx < allData.length) {
                const rowData = allData[rowIdx];
                if (Array.isArray(rowData) && col - 1 < rowData.length) {
                    return trim(rowData[col - 1]);
                }
            }
        }
        // 回退
        return colMap.has(key) ? trim(getCellValue(ws, row, colMap.get(key)!)) : '';
    };

    // ========== 3. 统计变量 ==========
    let successCount = 0, failCount = 0, skipCount = 0;
    const totalCount = visibleRows.length;
    let lastRequestTime = 0;
    const MIN_INTERVAL = 200; // 毫秒

    // ========== 4. 遍历可见行 ==========
    for (let idx = 0; idx < visibleRows.length; idx++) {
        const row = visibleRows[idx];
        const currentIndex = idx + 1;
        if (onProgress) onProgress(currentIndex, totalCount, `正在处理第 ${row} 行...`);

        try {
            const bgmUrl = getField(row, 'Bangumi_URL');
            const name = getField(row, '名称');
            const itemType = getField(row, '类别');
            const finishedDate = getField(row, '完播日');

            if (!bgmUrl) {
                skipCount++;
                onItemComplete?.(row, false, { code: 0, message: '无 Bangumi URL' });
                continue;
            }
            const sid = extractSubjectId(bgmUrl);
            if (!sid) {
                skipCount++;
                onItemComplete?.(row, false, { code: 0, message: '无 SID' });
                continue;
            }

            const jsonBody = buildJsonPayload(ws, row, colMap, finishedDate);
            if (!jsonBody) {
                skipCount++;
                onItemComplete?.(row, false, { code: 0, message: '状态不上传' });
                continue;
            }

            // 动态请求间隔
            const now = Date.now();
            const elapsed = now - lastRequestTime;
            if (elapsed < MIN_INTERVAL) {
                await delay(MIN_INTERVAL - elapsed);
            }

            // 发送请求
            const result = await (typeof httpRequest === 'function'
                ? httpRequest(`/subject/${sid}/update`, { method: 'POST', body: jsonBody, token })
                : Promise.resolve(bgmRequestSync('POST', `/v0/users/${_getUserApiPath()}/collections/${sid}`, jsonBody, token))
            );
            lastRequestTime = Date.now();

            let syncSuccess = false, statusCode = 0, errMsg = '';
            if (result instanceof Result) {
                syncSuccess = result.isOk();
                statusCode = (result.data as any)?.status || 0;
                errMsg = result.error?.message || '';
            } else {
                statusCode = result.code || 0;
                syncSuccess = [200, 201, 202, 204].includes(statusCode);
                errMsg = result.message || '';
            }

            const bodySummary = parseJsonBodySummary(jsonBody);
            const recordData: CollectionItem = {
                name: name || '(无名称)',
                url: bgmUrl,
                sid,
                type: itemType,
                content: bodySummary,
                status: syncSuccess ? '成功' : '失败',
                message: syncSuccess ? `行 ${row}` : (errMsg || `HTTP ${statusCode}`),
                count: 1
            };

            if (syncSuccess) {
                successCount++;
                try { const cell = getCell(ws, row, 1) as ExcelRange; if (cell?.Interior) cell.Interior.Color = BGM_COLOR.SUCCESS; } catch(_){}
            } else {
                failCount++;
                try { const cell = getCell(ws, row, 1) as ExcelRange; if (cell?.Interior) cell.Interior.Color = BGM_COLOR.FAIL; } catch(_){}
            }

            if (syncRecordSheet && typeof (window as any).addSyncRecord === 'function') {
                (window as any).addSyncRecord(syncRecordSheet, recordData);
            }
            onItemComplete?.(row, syncSuccess, { code: statusCode, message: errMsg });

        } catch (err: any) {
            failCount++;
            bgmLog(LOG_LEVELS.ERROR, `同步第 ${row} 行出错: ${err.message}`);
            onItemComplete?.(row, false, { code: 0, message: err.message });
        }
    }

    BGM.sync.isRunning = false;
    BGM.sync.lastSyncTime = new Date().toISOString();
    return { success: successCount, fail: failCount, skip: skipCount };
}
// ========== 筛选相关 ==========
export function getFilterStatus(endRow?: number, getColumnCounts?: boolean): FilterStatus | null {
  let app = getApp();
  if (!app) return null;
  let ws = getDataSheet();
  if (!ws) return null;

  let result: FilterStatus = { hasFilter: false, filteredColumns: [], hiddenRows: [], visibleRows: [], filterDetails: "", columnCounts: {}, totalRows: 0, visibleCount: 0, hiddenCount: 0 };

  try {
    let autoFilter = ws.AutoFilter;
    let filterMode = false;
    let filterStartRow = 2;

    if (autoFilter) {
      filterMode = autoFilter.FilterMode === true;
      result.hasFilter = filterMode;
      if (autoFilter.Range) {
        let filterRange = autoFilter.Range;
        filterStartRow = filterRange.Row + 1;
        result.totalRows = filterRange.Rows.Count - 1;
        _cachedTotalRows = result.totalRows;
      }
      let filters = autoFilter.Filters;
      if (filters && filters.Count > 0) {
        let details: string[] = [];
        for (let i = 1; i <= filters.Count; i++) {
          try {
            let f = filters(i);
            if (f && f.On) {
              let colLetter = colNumToLetter(i);
              let headerCell = ws.Range(colLetter + "1") || ws.Cells(1, i);
              let colName = headerCell.Value2 ? String(headerCell.Value2).substring(0, 10) : "列" + i;
              let criteria = f.Criteria1 || "";
              if (f.Criteria2) criteria += " / " + f.Criteria2;
              if (f.Operator === 1) criteria = f.Criteria1 + " 且 " + f.Criteria2;
              details.push(colName + ": " + criteria);
              result.filteredColumns.push({ column: i, columnName: colName, criteria });
            }
          } catch(e){}
        }
        result.filterDetails = details.join(" | ");
      }
    }

    let scanEndRow: number;
    if (endRow && endRow > 0) scanEndRow = endRow;
    else if (_cachedTotalRows > 0) scanEndRow = filterStartRow + _cachedTotalRows + 50;
    else scanEndRow = getLastRow(ws);

    try {
      if (filterMode && autoFilter && autoFilter.Range) {
        let filterRange = autoFilter.Range;
        let actualLastRow = getLastRow(ws);
        let filterEndRow = Math.min(filterRange.Row + filterRange.Rows.Count - 1, actualLastRow);
        try {
          let visibleCells = ws.Range(`D${filterStartRow}:D${filterEndRow}`).SpecialCells(12);
          if (visibleCells) {
            try {
              for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                let area = visibleCells.Areas.Item(a);
                for (let r = 1; r <= area.Rows.Count; r++) {
                  let rowNum = area.Rows.Item(r).Row;
                  let seqNum = parseInt(ws.Range("D" + rowNum).Value2);
                  if (!isNaN(seqNum) && seqNum > 0) result.visibleRows.push(rowNum);
                }
              }
            } catch(e){}
          }
        } catch(e){}

        let totalDataRows = 0;
        for (let i = filterStartRow; i <= filterEndRow; i++) {
          let seqNum = parseInt(ws.Range("D" + i).Value2);
          if (!isNaN(seqNum) && seqNum > 0) totalDataRows++;
        }
        result.totalRows = totalDataRows;

        if (result.visibleRows.length > 0) {
          let visibleSet = new Set(result.visibleRows);
          for (let i = filterStartRow; i <= filterEndRow; i++) {
            let seqNum = parseInt(ws.Range("D" + i).Value2);
            if (!isNaN(seqNum) && seqNum > 0 && !visibleSet.has(i)) result.hiddenRows.push(i);
          }
        }
      }
    } catch(e){}

    if (result.visibleRows.length === 0 && result.hiddenRows.length === 0) {
      for (let i = filterStartRow; i <= scanEndRow; i++) {
        try {
          let hidden = ws.Rows(i).Hidden;
          if (hidden === true) result.hiddenRows.push(i);
          else result.visibleRows.push(i);
        } catch(e){ result.visibleRows.push(i); }
      }
    }

    result.visibleCount = result.visibleRows.length;
    result.hiddenCount = result.hiddenRows.length;
    if (getColumnCounts) result.columnCounts = getColumnValueCounts(ws, scanEndRow);
  } catch(e: any){ bgmLog(LOG_LEVELS.ERROR, "getFilterStatus error: " + e.message); }
  return result;
}

export function getColumnValueCounts(ws: any, endRow: number): { [key: number]: { [key: string]: number } } {
  let counts: { [key: number]: { [key: string]: number } } = {};
  try {
    let autoFilter = ws.AutoFilter;
    if (autoFilter && autoFilter.Range) {
      let filterRange = autoFilter.Range;
      let colCount = filterRange.Columns.Count;
      for (let col = 1; col <= colCount; col++) {
        let valueCounts: { [key: string]: number } = { "(空白)": 0 };
        for (let row = 2; row <= endRow; row++) {
          let val = ws.Cells(row, col).Value2;
          if (val === null || val === undefined || val === "") valueCounts["(空白)"]++;
          else {
            let key = String(val).substring(0, 50);
            valueCounts[key] = (valueCounts[key] || 0) + 1;
          }
        }
        if (Object.keys(valueCounts).length > 1 || valueCounts["(空白)"] !== endRow - 1) counts[col] = valueCounts;
      }
    }
  } catch(e){}
  return counts;
}

export function getVisibleRows(): number[] { 
  let status = getFilterStatus(); 
  return status ? status.visibleRows : []; 
}

export function getFilteredRows(): number[] { 
  let status = getFilterStatus(); 
  return status ? status.hiddenRows : []; 
}

export function getSequentialRowsBySeqCol(startRow?: number, endRow?: number): SequentialRowsResult {
  let app = getApp();
  if (!app) return { validRows: [], filteredRows: [], totalFiltered: 0, hasFilter: false, visibleCount: 0, hiddenCount: 0 };
  let ws = getDataSheet();
  if (!ws) return { validRows: [], filteredRows: [], totalFiltered: 0, hasFilter: false, visibleCount: 0, hiddenCount: 0 };

  let filterStatus = getFilterStatus(endRow);
  let visibleRows = filterStatus ? filterStatus.visibleRows : [];
  let isFiltered = filterStatus ? filterStatus.hasFilter : false;

  let result: SequentialRowsResult = { validRows: [], filteredRows: [], totalFiltered: 0, hasFilter: isFiltered, visibleCount: visibleRows.length, hiddenCount: filterStatus ? filterStatus.hiddenCount : 0 };
  let seqCol = 4;

  if (isFiltered) {
    let visibleSeqMap = new Map<number, number>();
    for (let row of visibleRows) {
      let seqValue = parseInt(ws.Range("D" + row).Value2);
      if (!isNaN(seqValue)) visibleSeqMap.set(row, seqValue);
    }
    let sortedRows = Array.from(visibleSeqMap.keys()).sort((a,b) => a-b);
    if (sortedRows.length === 0) return result;
    result.validRows.push(sortedRows[0]);
    for (let i = 1; i < sortedRows.length; i++) {
      let prevSeq = visibleSeqMap.get(sortedRows[i-1])!;
      let currSeq = visibleSeqMap.get(sortedRows[i])!;
      if (currSeq === prevSeq + 1) result.validRows.push(sortedRows[i]);
      else if (currSeq > prevSeq + 1) {
        let gap = currSeq - prevSeq - 1;
        result.totalFiltered += gap;
        result.filteredRows.push({ startSeq: prevSeq + 1, endSeq: currSeq - 1, count: gap, afterRow: sortedRows[i] });
        result.validRows.push(sortedRows[i]);
      }
    }
  } else {
    let start = startRow || 2;
    let scanEnd = endRow && endRow > 0 ? endRow : getLastRow(ws);
    for (let row = start; row <= scanEnd; row++) {
      let seq = parseInt(ws.Range("D" + row).Value2);
      if (!isNaN(seq) && seq > 0) result.validRows.push(row);
    }
  }
  return result;
}

export function clearRowColors(): void {
  let ws = getDataSheet();
  if (!ws) return;
  let lastRow = getLastRow(ws);
  for (let i = 2; i <= lastRow; i++) {
    try { 
      let cell = getCell(ws, i, 1) as ExcelRange; 
      if (cell?.Interior) cell.Interior.ColorIndex = -4142; 
    } catch(e){}
  }
  showAlert("完成", "已清除所有颜色标记");
}

export function testSingleUpdate(): void {
  let ws = getDataSheet();
if (!ws) { showAlert("错误", "未找到数据工作表！"); return; }
  let token = getBgmtoken();
  if (!token) { showAlert("提示", "请先设置 Token！"); return; }
  let app = getApp();
  if (!app?.ActiveCell) { showAlert("提示", "请先选中一个单元格"); return; }

  let row = app.ActiveCell.Row;
  let headerRow = findHeaderRow(ws);
  let colMap = getColumnMap(ws, headerRow);
  if (!colMap.has("Bangumi_URL")) { showAlert ("提示", "未找到 Bangumi URL 列"); return; }

  let bgmUrl = trim(getCellValue(ws, row, colMap.get("Bangumi_URL")!));
  let sid = extractSubjectId(bgmUrl);
  if (!sid) { showAlert("提示", "当前行没有 Bangumi URL"); return; }

  let finishedDate = colMap.has("完播日") ? trim(getCellValue(ws, row, colMap.get("完播日")!)) : "";
  let jsonBody = buildJsonPayload(ws, row, colMap, finishedDate);
  if (!jsonBody) { showAlert("提示", "当前行观看状态不上传"); return; }

  let result = bgmRequestSync("POST", `/v0/users/${_getUserApiPath()}/collections/${sid}`, jsonBody, token);
  if (result.code === 204 || result.code === 200 || result.code === 201) {
    showAlert("测试成功", `条目 ${sid} 更新成功！\n\n请求体: ${parseJsonBodySummary(jsonBody)}`);
  } else {
    showAlert("测试失败", `条目 ${sid} 更新失败！\n\n状态码: ${result.code}\n响应: ${result.message}`);
  }
}

export function previewSubjectIdExtraction(): void {
  let ws = getDataSheet(); if (!ws) return;
  let headerRow = findHeaderRow(ws); if (headerRow === 0) return;
  let colMap = getColumnMap(ws, headerRow);
  if (!colMap.has("Bangumi_URL")) { showAlert("提示", "未找到 Bangumi URL 列"); return; }
  let lastRow = getLastRow(ws);
  let previewRows = Math.min(10, lastRow - headerRow);
  let msg = `前${previewRows}行的 URL -> subject_id 提取结果：\n\n`;
  for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
    let url = trim(getCellValue(ws, i, colMap.get("Bangumi_URL")!));
    msg += `行${i}: ${url.length > 50 ? url.substring(0,50)+'...' : url} -> [${extractSubjectId(url)}]\n`;
  }
  showAlert("预览 URL 提取", msg);
}

export function previewJsonPayload(): void {
  let ws = getDataSheet(); if (!ws) return;
  let headerRow = findHeaderRow(ws); if (headerRow === 0) return;
  let colMap = getColumnMap(ws, headerRow);
  let previewRows = Math.min(5, 5);
  let msg = `前${previewRows}行的请求体预览：\n\n`;
  for (let i = headerRow + 1; i <= headerRow + previewRows; i++) {
    let url = colMap.has("Bangumi_URL") ? trim(getCellValue(ws, i, colMap.get("Bangumi_URL")!)) : "";
    let sid = extractSubjectId(url);
    let finishedDate = colMap.has("完播日") ? trim(getCellValue(ws, i, colMap.get("完播日")!)) : "";
    let jsonBody = buildJsonPayload(ws, i, colMap, finishedDate);
    msg += `行${i} [ID:${sid}]\n${jsonBody || "(空)"}\n\n`;
  }
  showAlert("预览请求体", msg);
}

export function setBangumiToken(): void {
    openBangumiTokenPage();
    // 打开 Token 页面后定时检查是否已保存（用户可能已复制粘贴）
    setTimeout(() => {
        const token = loadBgToken();
        if (token) testTokenValidityForRibbon(token);
    }, 2000);
}


export function openBangumiTokenPage(): void {
  let tokenUrl = "https://next.bgm.tv/demo/access-token/create";
  let app = getApp();
  try { if (app?.OAAssist) app.OAAssist.ShellExecute(tokenUrl); else window.open(tokenUrl, "_blank"); } catch(e) { window.open(tokenUrl, "_blank"); }
}

export function testTokenValidityForRibbon(token: string): void {
  if (!token) return;
  let xhr = new XMLHttpRequest();
  xhr.open("GET", BGM_CONFIG.API_BASE + "/v0/me", false);
  xhr.setRequestHeader("Authorization", "Bearer " + token);
  try {
    xhr.send();
    if (xhr.status === 200) {
      let userData = JSON.parse(xhr.responseText);
       showAlert("Token 有效", `Token 验证成功！\n\n用户: ${userData.nickname || userData.username}\nID: ${userData.id}`);
    } else if (xhr.status === 401) {
       showAlert("Token 无效", "Token 验证失败！请检查 Token 是否正确。");
    } else {
       showAlert("验证失败", `验证失败 (${xhr.status}): ${xhr.responseText}`);
    }
  } catch(err: any) {  showAlert("验证出错", `验证出错: ${err.message}`); }
}

export function openUserCollection(): void {
  let userId = _getBgmUserId();
  if (!userId) { if (typeof showUserIdDialog === 'function') showUserIdDialog(); return; }
  window.open(`https://bgm.tv/user/${userId}/collection`, "_blank");
}

export function buildTagsArray(tagsStr: string): string[] {
  if (!tagsStr) return [];
  let tagSet = new Set<string>();
  addTagsFromStr(tagSet, tagsStr);
  return Array.from(tagSet).slice(0, 5);
}




