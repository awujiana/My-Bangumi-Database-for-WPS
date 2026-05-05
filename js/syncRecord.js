// ========== 同步记录模块 ==========

/**
 * 设置同步记录工作表的表头
 * @param {object} sheet - 工作表对象
 */
function setSyncRecordHeaders(sheet) {
    // 更新表头
    let headers = ["序号", "同步时间", "名称", "URL", "SID", "条目类型", "次数", "内容", "状态", "备注"];
    
    console.log("setSyncRecordHeaders 开始 - 工作表:", sheet ? sheet.Name : "null");
    
    for (let i = 0; i < headers.length; i++) {
        let colLetter = colNumToLetter(i + 1);
        let cellAddr = colLetter + "1";
        console.log("设置表头 - 列:", cellAddr, "值:", headers[i]);
        
        try {
            let cell = sheet.Range(cellAddr);
            if (cell) {
                cell.Value2 = headers[i];  // 使用 Value2 更可靠
                if (cell.Font) {
                    cell.Font.Bold = true;
                }
                if (cell.Interior) {
                    cell.Interior.Color = BGM_COLOR.GRAY;
                }
                console.log("设置成功:", cellAddr, "当前值:", cell.Value2);
            } else {
                console.error("无法获取单元格:", cellAddr);
            }
        } catch (e) {
            console.error("设置表头失败 - 列:", cellAddr, "错误:", e);
        }
    }
    
    console.log("setSyncRecordHeaders 完成");
}

/**
 * 检查表头是否存在
 * @param {object} sheet - 工作表对象
 * @returns {boolean} 表头是否存在
 */
function checkHeaderExists(sheet) {
    try {
        let firstCell = sheet.Range("A1");
        if (!firstCell) {
            console.log("checkHeaderExists - A1 单元格不存在");
            return false;
        }
        // 处理 WPS COM 对象返回 null 的情况
        let val = firstCell.Value2;
        if (val === null || val === undefined || val === "") {
            console.log("checkHeaderExists - A1 值为空");
            return false;
        }
        // 将值转换为字符串并去除首尾空格
        let headerText = String(val).toString().trim();
        if (!headerText) {
            return false;
        }
        console.log("checkHeaderExists - 表头文本:", headerText);
        return headerText === "序号";
    } catch (e) {
        console.error("checkHeaderExists error:", e);
        return false;
    }
}

/**
 * 获取或创建同步记录工作表
 * @returns {object} 同步记录工作表对象
 */
function getOrCreateSyncRecordSheet() {
    let app = getApp();
    console.log("getOrCreateSyncRecordSheet - app:", !!app, "ActiveWorkbook:", !!(app && app.ActiveWorkbook));
    if (!app || !app.ActiveWorkbook) {
        console.error("无法获取 Application 或 ActiveWorkbook");
        alert("无法获取工作簿，请确保已打开 Excel/WPS 文档");
        return null;
    }
    
    let sheets = app.ActiveWorkbook.Sheets;
    let sheetName = "同步记录";
    console.log("getOrCreateSyncRecordSheet - 工作表数量:", sheets.Count);
    
    // 查找是否已存在
    for (let i = 1; i <= sheets.Count; i++) {
        console.log("检查工作表:", sheets.Item(i).Name);
        if (sheets.Item(i).Name === sheetName) {
            console.log("找到已有同步记录工作表");
            let existingSheet = sheets.Item(i);
            
            // 检查表头是否存在
            if (!checkHeaderExists(existingSheet)) {
                console.log("已有工作表没有表头，设置表头...");
                setSyncRecordHeaders(existingSheet);
            } else {
                console.log("表头已存在");
            }
            return existingSheet;
        }
    }
    
    console.log("创建新的同步记录工作表");
    
    try {
        // 创建新工作表
        let newSheet = sheets.Add();
        newSheet.Name = sheetName;
        
        console.log("新工作表已创建:", newSheet.Name);
        
        // 设置表头
        setSyncRecordHeaders(newSheet);
        
        console.log("同步记录工作表创建成功");
        return newSheet;
    } catch (e) {
        console.error("创建同步记录工作表失败:", e);
        alert("创建同步记录工作表失败: " + e.message);
        return null;
    }
}

// ========== 同步记录缓存（优化重复读表）==========
let _syncRecordSidCache = new Map();   // sid → row
let _syncRecordListCache = [];         // 所有记录的缓存
let _syncRecordCacheValid = false;     // 缓存是否有效

function _invalidateSyncRecordCache() {
    _syncRecordSidCache.clear();
    _syncRecordListCache = [];
    _syncRecordCacheValid = false;
}

function _buildSyncRecordCache(sheet) {
    if (_syncRecordCacheValid) return;
    _syncRecordSidCache.clear();
    _syncRecordListCache = [];
    
    let lastRow = 1;
    try {
        let lastCell = sheet.Range("A" + sheet.Rows.Count);
        if (lastCell && lastCell.Value2) {
            let endCell = lastCell.End(-4162);
            lastRow = endCell.Row > 0 ? endCell.Row : 1;
        }
    } catch (e) {}
    
    for (let row = 2; row <= lastRow; row++) {
        try {
            let sid = sheet.Range("E" + row).Value2 || "";
            sid = String(sid).trim();
            let url = sheet.Range("D" + row).Value2 || "";
            url = String(url).trim();
            if (!url && !sid) continue;
            
            _syncRecordSidCache.set(sid, row);
            _syncRecordListCache.push({
                seq: sheet.Range("A" + row).Value2,
                time: sheet.Range("B" + row).Value2,
                name: sheet.Range("C" + row).Value2,
                url: url,
                sid: sid,
                type: sheet.Range("F" + row).Value2,
                count: sheet.Range("G" + row).Value2,
                content: sheet.Range("H" + row).Value2,
                status: sheet.Range("I" + row).Value2,
                message: sheet.Range("J" + row).Value2,
                row: row
            });
        } catch (e) {}
    }
    _syncRecordCacheValid = true;
}

function _getRecordRowBySid(sheet, sid) {
    if (!sid) return 0;
    _buildSyncRecordCache(sheet);
    return _syncRecordSidCache.get(sid) || 0;
}

/**
 * 添加同步记录
 * @param {object} options - 同步记录选项
 */
function addSyncRecord(options) {
    console.log("addSyncRecord 开始 - 选项:", JSON.stringify(options));
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) {
            console.error("addSyncRecord - 无法获取同步记录工作表");
            return false;
        }
        
        console.log("addSyncRecord - 获取工作表成功:", sheet ? sheet.Name : "无名称");
        
        // 找到最后一行
        let lastRow = 1;
        try {
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell && lastCell.Value2) {
                let endCell = lastCell.End(-4162);
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}
        
        if (lastRow === 1) {
            try {
                for (let i = 2; i <= 10000; i++) {
                    let cell = sheet.Range("A" + i);
                    if (!cell || !cell.Value2) break;
                    lastRow = i;
                }
            } catch (e) {}
        }
        
        console.log("addSyncRecord - 最终 lastRow:", lastRow);
        
        // 如果缓存无效，先重建
        _buildSyncRecordCache(sheet);
        
        // 检查是否已存在相同 SID 的记录
        let existingRow = _syncRecordSidCache.get(String(options.sid)) || 0;
        let currentCount = 1;
        if (existingRow > 0) {
            let countCell = sheet.Range("G" + existingRow);
            currentCount = countCell ? (parseInt(countCell.Value2) || 0) + 1 : 1;
        }
        
        let newRow = existingRow > 0 ? existingRow : lastRow + 1;
        console.log("addSyncRecord - existingRow:", existingRow, "newRow:", newRow, "count:", currentCount);
        
        // 生成序号
        let seqNum = existingRow > 0 ? existingRow - 1 : lastRow;
        
        // 同步时间
        let now = new Date();
        let timeStr = now.getFullYear() + "-" + 
                      String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                      String(now.getDate()).padStart(2, '0') + " " + 
                      String(now.getHours()).padStart(2, '0') + ":" + 
                      String(now.getMinutes()).padStart(2, '0') + ":" + 
                      String(now.getSeconds()).padStart(2, '0');
        
        // ---- 写入数据到工作表 ----
        // 使用与 setSyncRecordHeaders 相同的方式：sheet.Range().Value2
        // WPS 要求对超出已用区域的行写入时，调用方需确保 sheet 已激活
        console.log("addSyncRecord - 开始写入数据到行:", newRow);
        let writeSuccess = false;
        try {
            if (existingRow === 0) {
                let cellA = sheet.Range("A" + newRow);
                if (cellA) cellA.Value2 = seqNum;
            }
            let cellB = sheet.Range("B" + newRow);
            if (cellB) cellB.Value2 = timeStr;
            let cellC = sheet.Range("C" + newRow);
            if (cellC) cellC.Value2 = options.name || "";
            let cellD = sheet.Range("D" + newRow);
            if (cellD) cellD.Value2 = options.url || "";
            let cellE = sheet.Range("E" + newRow);
            if (cellE) cellE.Value2 = options.sid || "";
            let cellF = sheet.Range("F" + newRow);
            if (cellF) cellF.Value2 = options.type || "";
            let cellG = sheet.Range("G" + newRow);
            if (cellG) cellG.Value2 = currentCount;
            let cellH = sheet.Range("H" + newRow);
            if (cellH) cellH.Value2 = options.content || "";
            let cellI = sheet.Range("I" + newRow);
            if (cellI) cellI.Value2 = options.status || "成功";
            let cellJ = sheet.Range("J" + newRow);
            if (cellJ) cellJ.Value2 = options.message || "";
            
            // 验证写入：读回 A 列值确认
            let verifyA = sheet.Range("A" + newRow);
            let verifyVal = verifyA ? verifyA.Value2 : null;
            writeSuccess = (verifyVal !== null && verifyVal !== undefined && verifyVal !== "");
            console.log("addSyncRecord - 数据写入完成, 验证:", verifyVal, "成功:", writeSuccess);
        } catch (writeErr) {
            console.error("addSyncRecord - 写入失败:", writeErr);
        }
        
        // 写入失败时尝试激活后重写
        if (!writeSuccess) {
            console.log("addSyncRecord - 首次写入验证失败，尝试激活后重新写入");
            try {
                sheet.Activate();
                if (existingRow === 0) {
                    let cellA = sheet.Range("A" + newRow);
                    if (cellA) cellA.Value2 = seqNum;
                }
                let cellB = sheet.Range("B" + newRow);
                if (cellB) cellB.Value2 = timeStr;
                let cellC = sheet.Range("C" + newRow);
                if (cellC) cellC.Value2 = options.name || "";
                let cellD = sheet.Range("D" + newRow);
                if (cellD) cellD.Value2 = options.url || "";
                let cellE = sheet.Range("E" + newRow);
                if (cellE) cellE.Value2 = options.sid || "";
                let cellF = sheet.Range("F" + newRow);
                if (cellF) cellF.Value2 = options.type || "";
                let cellG = sheet.Range("G" + newRow);
                if (cellG) cellG.Value2 = currentCount;
                let cellH = sheet.Range("H" + newRow);
                if (cellH) cellH.Value2 = options.content || "";
                let cellI = sheet.Range("I" + newRow);
                if (cellI) cellI.Value2 = options.status || "成功";
                let cellJ = sheet.Range("J" + newRow);
                if (cellJ) cellJ.Value2 = options.message || "";
                let verifyA2 = sheet.Range("A" + newRow);
                writeSuccess = verifyA2 && (verifyA2.Value2 !== null && verifyA2.Value2 !== undefined && verifyA2.Value2 !== "");
                console.log("addSyncRecord - 重写后验证:", verifyA2 ? verifyA2.Value2 : "null", "成功:", writeSuccess);
            } catch (retryErr) {
                console.error("addSyncRecord - 重写也失败:", retryErr);
            }
        }
        
        // 更新缓存（直接操作内存，避免从 sheet 重新读取）
        if (existingRow === 0) {
            _syncRecordListCache.push({
                seq: seqNum,
                time: timeStr,
                name: options.name || "",
                url: options.url || "",
                sid: String(options.sid || ""),
                type: options.type || "",
                count: currentCount,
                content: options.content || "",
                status: options.status || "成功",
                message: options.message || "",
                row: newRow
            });
        } else {
            // 更新缓存中的已有记录
            for (let i = 0; i < _syncRecordListCache.length; i++) {
                if (String(_syncRecordListCache[i].sid) === String(options.sid)) {
                    _syncRecordListCache[i].time = timeStr;
                    _syncRecordListCache[i].name = options.name || _syncRecordListCache[i].name;
                    _syncRecordListCache[i].url = options.url || _syncRecordListCache[i].url;
                    _syncRecordListCache[i].type = options.type || _syncRecordListCache[i].type;
                    _syncRecordListCache[i].count = currentCount;
                    _syncRecordListCache[i].content = options.content || _syncRecordListCache[i].content;
                    _syncRecordListCache[i].status = options.status || _syncRecordListCache[i].status;
                    _syncRecordListCache[i].message = options.message || _syncRecordListCache[i].message;
                    break;
                }
            }
        }
        _syncRecordSidCache.set(String(options.sid), newRow);
        
        // 设置状态颜色（I 列）
        let statusCell = sheet.Range("I" + newRow);
        if (statusCell && statusCell.Interior) {
            if (options.status === "成功") {
                statusCell.Interior.Color = BGM_COLOR.SUCCESS;
            } else if (options.status === "失败") {
                statusCell.Interior.Color = BGM_COLOR.FAIL;
            } else {
                statusCell.Interior.Color = BGM_COLOR.SKIP;
            }
        }
        
        console.log("addSyncRecord - 缓存已更新，总记录数:", _syncRecordListCache.length);
        
        let action = existingRow > 0 ? "更新" : "新增";
        console.log("addSyncRecord " + action + " - 行:", newRow, "状态:", options.status);
        return true;
    } catch (e) {
        console.error("addSyncRecord error:", e);
        return false;
    }
}

/**
 * 更新同步记录
 * @param {string} sid - 要更新的记录的SID
 * @param {object} updates - 要更新的字段
 */
function updateSyncRecord(sid, updates) {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return false;
        
        let lastRow = 1;
        try {
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell) {
                let endCell = lastCell.End(-4162);
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}
        
        // 查找对应的记录（按SID查找）
        for (let row = 2; row <= lastRow; row++) {
            let recordSid = sheet.Range("E" + row).Value;
            if (recordSid === sid) {
                // 更新同步次数（G 列 = 第7列）
                if (updates.count !== undefined) {
                    let currentCount = parseInt(sheet.Range("G" + row).Value) || 0;
                    sheet.Range("G" + row).Value = currentCount + updates.count;
                }
                // 更新时间
                if (updates.time) {
                    sheet.Range("B" + row).Value = updates.time;
                }
                // 更新状态（I 列 = 第9列）
                if (updates.status) {
                    sheet.Range("I" + row).Value = updates.status;
                    let statusCell = sheet.Range("I" + row);
                    if (statusCell && statusCell.Interior) {
                        if (updates.status === "成功") {
                            statusCell.Interior.Color = BGM_COLOR.SUCCESS;
                        } else if (updates.status === "失败") {
                            statusCell.Interior.Color = BGM_COLOR.FAIL;
                        }
                    }
                }
                // 更新备注（J 列 = 第10列）
                if (updates.message) {
                    let currentMsg = sheet.Range("J" + row).Value || "";
                    let newMsg = currentMsg ? currentMsg + "; " + updates.message : updates.message;
                    sheet.Range("J" + row).Value = newMsg;
                }
                _invalidateSyncRecordCache();
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error("updateSyncRecord error:", e);
        return false;
    }
}

/**
 * 获取同步记录列表
 * @returns {Array} 同步记录数组
 */
function getAllSyncRecords() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return [];
        _buildSyncRecordCache(sheet);
        return _syncRecordListCache.slice(); // 返回缓存的副本
    } catch (e) {
        console.error("getAllSyncRecords error:", e);
        return [];
    }
}

/**
 * 清除同步记录（不含确认对话框，由调用方控制确认逻辑）
 * taskpane 调用时通过自定义 showConfirmDialog 处理后调用此函数
 * @returns {boolean} 是否清除成功
 */
function clearSyncRecords() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return false;
        
        // 激活此工作表后再删除（WPS COM 要求激活才能操作已用区域）
        try { sheet.Activate(); } catch (e) {}
        
        let lastRow = 1;
        try {
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell) {
                let endCell = lastCell.End(-4162);
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}
        
        if (lastRow < 2) {
            alert("没有同步记录可清除");
            return true;
        }
        
        // 删除数据行（保留表头）
        let range = sheet.Range("A2:J" + lastRow);
        range.Delete();
        
        _invalidateSyncRecordCache();
        alert("已清除 " + (lastRow - 1) + " 条同步记录");
        return true;
    } catch (e) {
        console.error("clearSyncRecords error:", e);
        alert("清除同步记录失败: " + e.message);
        return false;
    }
}

/**
 * 激活同步记录工作表（批量写入前调用，确保写入生效）
 * @returns {object|null} 同步记录工作表对象
 */
function activateSyncRecordSheet() {
    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) return null;
    try { sheet.Activate(); } catch (e) {}
    return sheet;
}

/**
 * 完成批量写入后刷新同步记录工作表
 */
function finalizeSyncRecordBatch() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (sheet) {
            try { sheet.Calculate(); } catch (e) {}
            // 标记缓存有效
            _syncRecordCacheValid = true;
        }
    } catch (e) {}
}

/**
 * 查看同步记录（打开工作表）
 */
function openSyncRecordSheet() {
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) {
            alert("无法打开同步记录工作表");
            return;
        }
        sheet.Activate();
    } catch (e) {
        alert("打开同步记录工作表失败: " + e.message);
    }
}

// ========== BGM 收藏类型映射 ==========
const BGM_SUBJECT_TYPES = {
    1: "书籍",
    2: "动画",
    3: "音乐",
    4: "游戏",
    6: "真人剧"
};

/**
 * 从 Bangumi API 获取用户收藏列表并写入同步记录表
 * @param {string} token - Bangumi Access Token
 * @param {boolean} includeAllTypes - 是否获取所有类型（动画、书籍、音乐、游戏等）
 * @param {number} maxItems - 最大获取条数，默认500
 * @param {function} progressCallback - 进度回调函数 (current, total, message)
 * @returns {object} - {success: boolean, count: number, message: string}
 */
function fetchAndRecordBgCollections(token, includeAllTypes, maxItems, progressCallback) {
    console.log("fetchAndRecordBgCollections 开始执行");
    console.log("参数 - includeAllTypes:", includeAllTypes, "maxItems:", maxItems);
    
    // 参数处理
    if (maxItems === undefined || maxItems === null) maxItems = 500;
    if (includeAllTypes === undefined) includeAllTypes = true;
    
    let app = getApp();
    if (!app) {
        console.error("无法获取 Application 对象");
        return { success: false, count: 0, message: "无法获取 Application 对象" };
    }
    
    // 获取或创建同步记录工作表
    let sheet = getOrCreateSyncRecordSheet();
    if (!sheet) {
        return { success: false, count: 0, message: "无法获取同步记录工作表" };
    }
    
    try {
        // 定义要获取的类型
        let typesToFetch;
        if (includeAllTypes) {
            typesToFetch = [1, 2, 3, 4, 6]; // 书籍、动画、音乐、游戏、真人剧
        } else {
            typesToFetch = [2]; // 默认只获取动画
        }
        
        console.log("将获取的类型:", typesToFetch.map(t => BGM_SUBJECT_TYPES[t] || "未知").join(", "));
        
        let totalCollected = 0;
        let allCollections = [];
        
        // 分页获取每个类型的收藏
        for (let typeIndex = 0; typeIndex < typesToFetch.length; typeIndex++) {
            let subjectType = typesToFetch[typeIndex];
            let typeName = BGM_SUBJECT_TYPES[subjectType] || "未知类型";
            
            console.log(`正在获取「${typeName}」收藏 (type=${subjectType})...`);
            
            if (progressCallback) {
                progressCallback(totalCollected, maxItems, `正在获取「${typeName}」收藏...`);
            }
            
            // 获取该类型的所有收藏
            let typeCollections = fetchCollectionsByType(token, subjectType, maxItems);
            
            if (typeCollections.error) {
                console.error(`获取「${typeName}」收藏失败:`, typeCollections.error);
                continue;
            }
            
            console.log(`获取到「${typeName}」收藏 ${typeCollections.items.length} 条`);
            
            // 为每个条目添加类型信息
            for (let i = 0; i < typeCollections.items.length; i++) {
                let item = typeCollections.items[i];
                item.subject_type = subjectType;
                item.subject_type_name = typeName;
                allCollections.push(item);
            }
            
            totalCollected += typeCollections.items.length;
            
            // 如果已达到最大条数，停止获取
            if (totalCollected >= maxItems) {
                console.log("已达到最大条数限制，停止获取");
                break;
            }
            
            // 延迟，避免请求过快
            sleep(500);
        }
        
        console.log(`总共获取到 ${allCollections.length} 条收藏`);
        
        if (allCollections.length === 0) {
            return { success: true, count: 0, message: "未获取到任何收藏" };
        }
        
        // 写入同步记录表
        if (progressCallback) {
            progressCallback(maxItems, maxItems, "正在写入同步记录表...");
        }
        
        let writtenCount = 0;
        let timeStr = formatCurrentTime();
        
        for (let i = 0; i < allCollections.length; i++) {
            let item = allCollections[i];
            
            // 构建 URL
            let url = "https://bgm.tv/subject/" + item.subject_id;
            
            // 获取名称（优先中文名）
            let name = item.name_cn || item.name || item.subject?.name_cn || item.subject?.name || "(无名称)";
            
            // 构建同步内容摘要
            let contentSummary = JSON.stringify({
                type: item.type,
                rate: item.rate,
                subject_type: item.subject_type
            }, null, 2);
            
            // 添加同步记录
            let recordOptions = {
                name: name,
                url: url,
                sid: String(item.subject_id),
                type: item.subject_type_name,
                content: "标记同步：" + item.subject_type_name + "收藏",
                status: "成功",
                message: "从BGM同步",
                count: 1
            };
            
            addSyncRecord(recordOptions);
            writtenCount++;
            
            // 每50条报告一次进度
            if (progressCallback && i % 50 === 0) {
                progressCallback(i, allCollections.length, `已写入 ${i}/${allCollections.length} 条...`);
            }
        }
        
        console.log("写入完成，共写入", writtenCount, "条记录");
        
        return { 
            success: true, 
            count: writtenCount, 
            message: `成功写入 ${writtenCount} 条收藏到同步记录表` 
        };
        
    } catch (e) {
        console.error("fetchAndRecordBgCollections 出错:", e);
        return { success: false, count: 0, message: "发生错误: " + e.message };
    }
}

/**
 * 获取指定类型的收藏列表
 * @param {string} token - Access Token
 * @param {number} subjectType - 条目类型 (1=书籍, 2=动画, 3=音乐, 4=游戏, 6=真人剧)
 * @param {number} maxItems - 最大条数
 * @returns {object} - {items: array, error: string|null}
 */
function fetchCollectionsByType(token, subjectType, maxItems) {
    let allItems = [];
    let page = 1;
    let limit = 100;
    let lastError = null;
    
    const BGM_API_BASE = "https://api.bgm.tv";
    
    try {
        while (allItems.length < maxItems) {
            let xhr = new XMLHttpRequest();
            let url = `${BGM_API_BASE}/v0/users/${_getUserApiPath()}/collections?subject_type=${subjectType}&limit=${limit}&offset=${(page - 1) * limit}`;
            
            xhr.open("GET", url, false);
            xhr.setRequestHeader("Authorization", "Bearer " + token);
            xhr.send();
            
            console.log(`fetchCollectionsByType - type=${subjectType}, page=${page}, status=${xhr.status}`);
            
            if (xhr.status === 401) {
                lastError = "Token 无效或已过期";
                break;
            }
            
            if (xhr.status === 403) {
                lastError = "没有权限访问收藏列表";
                break;
            }
            
            if (xhr.status === 404 || xhr.status === 204) {
                // 该类型收藏为空
                break;
            }
            
            if (xhr.status !== 200) {
                lastError = `HTTP ${xhr.status}`;
                break;
            }
            
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                lastError = "响应格式错误";
                break;
            }
            
            if (!Array.isArray(data) || data.length === 0) {
                break;
            }
            
            allItems = allItems.concat(data);
            
            if (data.length < limit) {
                break;
            }
            
            page++;
            
            // 防止无限循环
            if (page > 50) {
                console.log("已达到最大页数限制");
                break;
            }
            
            // 延迟
            sleep(300);
        }
    } catch (e) {
        lastError = e.message;
        console.error("fetchCollectionsByType 出错:", e);
    }
    
    return {
        items: allItems.slice(0, maxItems),
        error: lastError
    };
}

/**
 * 格式化当前时间为字符串
 * @returns {string} 时间字符串 YYYY-MM-DD HH:mm:ss
 */
function formatCurrentTime() {
    let now = new Date();
    return now.getFullYear() + "-" + 
           String(now.getMonth() + 1).padStart(2, '0') + "-" + 
           String(now.getDate()).padStart(2, '0') + " " + 
           String(now.getHours()).padStart(2, '0') + ":" + 
           String(now.getMinutes()).padStart(2, '0') + ":" + 
           String(now.getSeconds()).padStart(2, '0');
}

// ========== 标记已上传条目到工作表 D 列 ==========

/**
 * 标记已上传条目到工作表 D 列
 * 从同步记录表中读取已上传的条目，根据类型（动画/书籍）匹配后在工作表 D 列标记
 * @param {string} sheetType - 工作表类型："动画"（剧集）或 "书籍"（小说）
 * @param {function} progressCallback - 进度回调函数
 * @returns {object} - {success: boolean, marked: number, message: string}
 */
function markUploadedItemsInSheet(sheetType, progressCallback) {
    console.log("markUploadedItemsInSheet 开始执行, sheetType:", sheetType);
    
    let app = getApp();
    if (!app || !app.ActiveWorkbook) {
        return { success: false, marked: 0, message: "无法获取工作簿" };
    }
    
    // 获取当前工作表（剧集/小说）
    let dataSheet = app.ActiveSheet;
    if (!dataSheet) {
        return { success: false, marked: 0, message: "未找到数据工作表" };
    }
    
    // 获取同步记录表
    let recordSheet = getOrCreateSyncRecordSheet();
    if (!recordSheet) {
        return { success: false, marked: 0, message: "未找到同步记录表" };
    }
    
    try {
        // 读取同步记录表中的已上传条目
        if (progressCallback) {
            progressCallback(0, 100, "正在读取同步记录...");
        }
        
        let recordLastRow = recordSheet.Range("A" + recordSheet.Rows.Count).End(-4162).Row;
        if (recordLastRow < 2) {
            return { success: true, marked: 0, message: "同步记录表为空" };
        }
        
        // 读取所有同步记录，构建 URL/SID -> 记录 的映射
        let uploadedMap = new Map(); // key: URL或SID, value: 记录信息
        let nameToRecordMap = new Map(); // key: 名称, value: 记录信息
        
        // 遍历同步记录表
        for (let i = 2; i <= recordLastRow; i++) {
            // 获取状态（I 列，索引9）
            let status = recordSheet.Range("I" + i).Value2;
            if (status !== "成功") continue;
            
            // 获取 URL（D 列，索引4）
            let url = recordSheet.Range("D" + i).Value2 || "";
            url = String(url).trim();
            
            // 获取 SID（E 列，索引5）
            let sid = recordSheet.Range("E" + i).Value2 || "";
            sid = String(sid).trim();
            
            // 获取类型（F 列，索引6）
            let type = recordSheet.Range("F" + i).Value2 || "";
            type = String(type).trim();
            
            // 获取名称（C 列，索引3）
            let name = recordSheet.Range("C" + i).Value2 || "";
            name = String(name).trim();
            
            // 过滤类型
            let typeMatch = false;
            if (sheetType === "动画" || sheetType === "剧集") {
                typeMatch = (type === "动画");
            } else if (sheetType === "书籍" || sheetType === "小说") {
                typeMatch = (type === "书籍");
            } else {
                typeMatch = true; // 所有类型
            }
            
            if (!typeMatch) continue;
            
            // 记录信息
            let recordInfo = {
                name: name,
                url: url,
                sid: sid,
                type: type,
                row: i
            };
            
            // 添加到映射
            if (url) uploadedMap.set(url.toLowerCase(), recordInfo);
            if (sid) uploadedMap.set("bgm.tv/subject/" + sid.toLowerCase(), recordInfo);
            if (name) nameToRecordMap.set(name.toLowerCase(), recordInfo);
        }
        
        console.log("读取到已上传条目数量:", uploadedMap.size + nameToRecordMap.size);
        
        if (uploadedMap.size === 0 && nameToRecordMap.size === 0) {
            return { success: true, marked: 0, message: "同步记录表中没有已上传的" + sheetType + "条目" };
        }
        
        // 读取当前工作表，查找并标记
        if (progressCallback) {
            progressCallback(20, 100, "正在扫描工作表...");
        }
        
        // 查找表头行
        let dataHeaderRow = 1;
        for (let i = 1; i <= 20; i++) {
            let firstCell = dataSheet.Range("A" + i).Value2;
            if (firstCell && String(firstCell).trim() !== "") {
                dataHeaderRow = i;
                break;
            }
        }
        
        // 查找名称列（通常是 B 列或名称相关列）和 URL 列
        let lastCol = dataSheet.Range("A" + dataHeaderRow).End(-4161).Column; // xlToRight
        let lastRow = dataSheet.Range("A" + dataSheet.Rows.Count).End(-4162).Row;
        
        let nameCol = 0; // 名称列
        let urlCol = 0;  // URL 列
        
        for (let col = 1; col <= lastCol; col++) {
            let headerVal = dataSheet.Range(colNumToLetter(col) + dataHeaderRow).Value2 || "";
            headerVal = String(headerVal).toLowerCase();
            
            if (headerVal.includes("名称") || headerVal === "name" || headerVal === "标题") {
                nameCol = col;
            }
            if (headerVal.includes("bangumi") || headerVal.includes("url") || headerVal.includes("bgm")) {
                urlCol = col;
            }
        }
        
        // 如果没有找到名称列，尝试使用 B 列
        if (nameCol === 0) nameCol = 2;
        if (urlCol === 0) urlCol = lastCol; // 默认最后一列
        
        console.log("工作表结构: nameCol=" + nameCol + ", urlCol=" + urlCol);
        
        // 设置 D 列表头
        let dHeaderCell = dataSheet.Range("D" + dataHeaderRow);
        if (!dHeaderCell.Value2 || dHeaderCell.Value2 === "") {
            dHeaderCell.Value2 = "同步状态";
            dHeaderCell.Interior.Color = BGM_COLOR.GRAY;
        }
        
        // 标记已上传的条目
        let markedCount = 0;
        let startRow = dataHeaderRow + 1;
        
        for (let row = startRow; row <= lastRow; row++) {
            // 检查是否已有标记
            let existingMark = dataSheet.Range("D" + row).Value2;
            if (existingMark && String(existingMark).includes("BGM已上传")) {
                continue; // 跳过已标记的行
            }
            
            // 获取名称
            let itemName = dataSheet.Range(colNumToLetter(nameCol) + row).Value2 || "";
            itemName = String(itemName).trim();
            
            // 获取 URL
            let itemUrl = dataSheet.Range(colNumToLetter(urlCol) + row).Value2 || "";
            itemUrl = String(itemUrl).trim();
            
            // 尝试匹配
            let isMatched = false;
            
            // 1. 优先通过 URL 匹配
            if (itemUrl) {
                let urlLower = itemUrl.toLowerCase();
                if (uploadedMap.has(urlLower)) {
                    isMatched = true;
                }
                // 尝试提取 SID 匹配
                let match = itemUrl.match(/bgm\.tv\/subject\/(\d+)/i);
                if (match) {
                    let sidKey = "bgm.tv/subject/" + match[1].toLowerCase();
                    if (uploadedMap.has(sidKey)) {
                        isMatched = true;
                    }
                }
            }
            
            // 2. 通过名称匹配
            if (!isMatched && itemName) {
                let nameLower = itemName.toLowerCase();
                if (nameToRecordMap.has(nameLower)) {
                    isMatched = true;
                }
            }
            
            // 标记
            if (isMatched) {
                dataSheet.Range("D" + row).Value2 = "✓ BGM已上传";
                dataSheet.Range("D" + row).Interior.Color = BGM_COLOR.SUCCESS;
                markedCount++;
            }
            
            // 进度
            if (progressCallback && row % 50 === 0) {
                let progress = 20 + Math.floor((row - startRow) / (lastRow - startRow + 1) * 80);
                progressCallback(progress, 100, `正在扫描... 已标记 ${markedCount} 条`);
            }
        }
        
        console.log("标记完成，共标记", markedCount, "条");
        
        return { 
            success: true, 
            marked: markedCount, 
            message: `已在 D 列标记 ${markedCount} 个已上传到 BGM 的${sheetType}条目` 
        };
        
    } catch (e) {
        console.error("markUploadedItemsInSheet 出错:", e);
        return { success: false, marked: 0, message: "发生错误: " + e.message };
    }
}
