// ========== 同步记录模块 ==========

/**
 * 设置同步记录工作表的表头
 * @param {object} sheet - 工作表对象
 */
function setSyncRecordHeaders(sheet) {
    // 更新表头：增加"类型"列
    let headers = ["序号", "同步时间", "名称", "URL", "SID", "类型", "同步次数", "同步内容", "状态", "备注"];
    
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
                    cell.Interior.Color = 0xD3D3D3;
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
            // 方法1：使用 End 向上查找
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell && lastCell.Value2) {
                let endCell = lastCell.End(-4162); // xlUp
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
            console.log("addSyncRecord - End方法 lastRow:", lastRow);
        } catch (e) {
            console.log("addSyncRecord - End方法失败:", e.message);
        }
        
        // 方法2：如果 End 返回 1，尝试循环查找
        if (lastRow === 1) {
            try {
                for (let i = 2; i <= 10000; i++) {
                    let cell = sheet.Range("A" + i);
                    if (!cell || !cell.Value2) break;
                    lastRow = i;
                }
                console.log("addSyncRecord - 循环方法 lastRow:", lastRow);
            } catch (e) {
                console.log("addSyncRecord - 循环方法失败:", e.message);
            }
        }
        
        console.log("addSyncRecord - 最终 lastRow:", lastRow);
        
        // 检查是否已存在相同 SID 的记录
        let existingRow = 0;
        let currentCount = 1;
        for (let i = 2; i <= lastRow; i++) {
            let sidCell = sheet.Range("E" + i);
            let sidValue = sidCell ? trim(String(sidCell.Value2 || "")) : "";
            if (sidValue === String(options.sid)) {
                existingRow = i;
                let countCell = sheet.Range("F" + i);
                currentCount = countCell ? (parseInt(countCell.Value2) || 0) + 1 : 1;
                break;
            }
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
        
        // 写入数据（列顺序：序号、时间、名称、URL、SID、类型、同步次数、同步内容、状态、备注）
        console.log("addSyncRecord - 开始写入数据到行:", newRow);
        if (existingRow === 0) {
            // 新增：设置序号
            sheet.Range("A" + newRow).Value = seqNum;
            console.log("addSyncRecord - 写入序号:", seqNum);
        }
        sheet.Range("B" + newRow).Value = timeStr;
        sheet.Range("C" + newRow).Value = options.name || "";
        sheet.Range("D" + newRow).Value = options.url || "";
        sheet.Range("E" + newRow).Value = options.sid || "";
        sheet.Range("F" + newRow).Value = options.type || ""; // 类型
        sheet.Range("G" + newRow).Value = currentCount;
        sheet.Range("H" + newRow).Value = options.content || "";
        sheet.Range("I" + newRow).Value = options.status || "成功";
        sheet.Range("J" + newRow).Value = options.message || "";
        console.log("addSyncRecord - 数据写入完成");
        
        // 验证写入
        let verifyCell = sheet.Range("E" + newRow);
        console.log("addSyncRecord - 验证写入，E列值:", verifyCell ? verifyCell.Value2 : "null");
        
        // 设置状态颜色（I 列）
        let statusCell = sheet.Range("I" + newRow);
        if (statusCell && statusCell.Interior) {
            if (options.status === "成功") {
                statusCell.Interior.Color = 0xCCFFCC;
            } else if (options.status === "失败") {
                statusCell.Interior.Color = 0xFFCCCC;
            } else {
                statusCell.Interior.Color = 0xFFFFCC;
            }
        }
        
        // 刷新工作表显示
        sheet.Activate();
        sheet.Calculate();
        console.log("addSyncRecord - 工作表已刷新");
        
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
                            statusCell.Interior.Color = 0xCCFFCC;
                        } else if (updates.status === "失败") {
                            statusCell.Interior.Color = 0xFFCCCC;
                        }
                    }
                }
                // 更新备注（J 列 = 第10列）
                if (updates.message) {
                    let currentMsg = sheet.Range("J" + row).Value || "";
                    let newMsg = currentMsg ? currentMsg + "; " + updates.message : updates.message;
                    sheet.Range("J" + row).Value = newMsg;
                }
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
    let records = [];
    try {
        let sheet = getOrCreateSyncRecordSheet();
        if (!sheet) return records;
        
        let lastRow = 1;
        try {
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell) {
                let endCell = lastCell.End(-4162);
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}
        
        if (lastRow < 2) return records;
        
        for (let row = 2; row <= lastRow; row++) {
            let url = sheet.Range("D" + row).Value;
            let sid = sheet.Range("E" + row).Value;
            if (!url && !sid) continue;
            
            records.push({
                seq: sheet.Range("A" + row).Value,
                time: sheet.Range("B" + row).Value,
                name: sheet.Range("C" + row).Value,
                url: url,
                sid: sid,
                type: sheet.Range("F" + row).Value,     // F=类型
                count: sheet.Range("G" + row).Value,    // G=同步次数
                content: sheet.Range("H" + row).Value,  // H=同步内容
                status: sheet.Range("I" + row).Value,   // I=状态
                message: sheet.Range("J" + row).Value,  // J=备注
                row: row
            });
        }
    } catch (e) {
        console.error("getAllSyncRecords error:", e);
    }
    return records;
}

/**
 * 清除同步记录
 * @param {boolean} confirmIt - 是否需要确认
 */
function clearSyncRecords(confirmIt) {
    if (confirmIt !== false) {
        if (!confirm("确定要清除所有同步记录吗？")) {
            return false;
        }
    }
    
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
        
        if (lastRow < 2) {
            alert("没有同步记录可清除");
            return true;
        }
        
        // 删除数据行（保留表头）
        let range = sheet.Range("A2:J" + lastRow);
        range.Delete();
        
        alert("已清除 " + (lastRow - 1) + " 条同步记录");
        return true;
    } catch (e) {
        console.error("clearSyncRecords error:", e);
        alert("清除同步记录失败: " + e.message);
        return false;
    }
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
                content: contentSummary,
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
            let url = `${BGM_API_BASE}/v0/users/-/collections?subject_type=${subjectType}&limit=${limit}&offset=${(page - 1) * limit}`;
            
            xhr.open("GET", url, false);
            xhr.setRequestHeader("Authorization", "Bearer " + token);
            xhr.setRequestHeader("User-Agent", "BangumiWPS/1.0");
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
            dHeaderCell.Interior.Color = 0xD3D3D3;
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
                dataSheet.Range("D" + row).Interior.Color = 0xCCFFCC; // 绿色
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
