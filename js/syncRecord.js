// ========== 同步记录模块 ==========

/**
 * 设置同步记录工作表的表头
 * @param {object} sheet - 工作表对象
 */
function setSyncRecordHeaders(sheet) {
    let headers = ["序号", "同步时间", "名称", "URL", "SID", "同步次数", "同步内容", "状态", "备注"];
    
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
            let lastCell = sheet.Range("A" + sheet.Rows.Count);
            if (lastCell) {
                let endCell = lastCell.End(-4162); // xlUp
                lastRow = endCell.Row > 0 ? endCell.Row : 1;
            }
        } catch (e) {}
        
        let newRow = lastRow + 1;
        console.log("addSyncRecord - lastRow:", lastRow, "newRow:", newRow);
        
        // 生成序号
        let seqNum = newRow - 1;
        
        // 同步时间
        let now = new Date();
        let timeStr = now.getFullYear() + "-" + 
                      String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                      String(now.getDate()).padStart(2, '0') + " " + 
                      String(now.getHours()).padStart(2, '0') + ":" + 
                      String(now.getMinutes()).padStart(2, '0') + ":" + 
                      String(now.getSeconds()).padStart(2, '0');
        
        // 写入数据（列顺序：序号、时间、名称、URL、SID、同步次数、同步内容、状态、备注）
        sheet.Range("A" + newRow).Value = seqNum;
        sheet.Range("B" + newRow).Value = timeStr;
        sheet.Range("C" + newRow).Value = options.name || "";
        sheet.Range("D" + newRow).Value = options.url || "";
        sheet.Range("E" + newRow).Value = options.sid || "";
        sheet.Range("F" + newRow).Value = options.count || 1;
        sheet.Range("G" + newRow).Value = options.content || "";
        sheet.Range("H" + newRow).Value = options.status || "成功";
        sheet.Range("I" + newRow).Value = options.message || "";
        
        // 设置状态颜色
        let statusCell = sheet.Range("H" + newRow);
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
        
        console.log("addSyncRecord 成功 - 行:", newRow, "状态:", options.status);
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
                // 更新同步次数
                if (updates.count !== undefined) {
                    let currentCount = parseInt(sheet.Range("F" + row).Value) || 0;
                    sheet.Range("F" + row).Value = currentCount + updates.count;
                }
                // 更新时间
                if (updates.time) {
                    sheet.Range("B" + row).Value = updates.time;
                }
                // 更新状态
                if (updates.status) {
                    sheet.Range("H" + row).Value = updates.status;
                    let statusCell = sheet.Range("H" + row);
                    if (statusCell && statusCell.Interior) {
                        if (updates.status === "成功") {
                            statusCell.Interior.Color = 0xCCFFCC;
                        } else if (updates.status === "失败") {
                            statusCell.Interior.Color = 0xFFCCCC;
                        }
                    }
                }
                // 更新备注
                if (updates.message) {
                    let currentMsg = sheet.Range("I" + row).Value || "";
                    let newMsg = currentMsg ? currentMsg + "; " + updates.message : updates.message;
                    sheet.Range("I" + row).Value = newMsg;
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
                count: sheet.Range("F" + row).Value,
                content: sheet.Range("G" + row).Value,
                status: sheet.Range("H" + row).Value,
                message: sheet.Range("I" + row).Value,
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
        let range = sheet.Range("A2:I" + lastRow);
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
