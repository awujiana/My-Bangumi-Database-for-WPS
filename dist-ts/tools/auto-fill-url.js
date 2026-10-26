import { getDataSheet, getCellValue, setCellValue, getColumnMap, findHeaderRow, getLastRow, bgmLog, LOG_LEVELS, BGM, trim, } from '../index.js';
function _splitAliases(aliasValue) {
    if (!aliasValue)
        return [];
    return aliasValue
        .split(/[|｜/／]/)
        .map((a) => a.trim())
        .filter(Boolean);
}
function _buildNameUrlMap(worksheet, headerRow, lastRow, columnMap) {
    const nameUrlMap = {};
    const urlColumn = columnMap.get('Bangumi_URL');
    const nameColumn = columnMap.get('名称');
    if (!urlColumn || !nameColumn)
        return nameUrlMap;
    const aliasColumn = columnMap.get('别名');
    for (let row = headerRow + 1; row <= lastRow; row += 1) {
        const urlValue = trim(getCellValue(worksheet, row, urlColumn));
        if (urlValue) {
            const nameValue = trim(getCellValue(worksheet, row, nameColumn));
            if (nameValue && !Object.hasOwn(nameUrlMap, nameValue)) {
                nameUrlMap[nameValue] = urlValue;
            }
            if (aliasColumn) {
                const aliasValue = trim(getCellValue(worksheet, row, aliasColumn));
                const aliases = _splitAliases(aliasValue);
                for (const a of aliases) {
                    if (a && !Object.hasOwn(nameUrlMap, a)) {
                        nameUrlMap[a] = urlValue;
                    }
                }
            }
        }
    }
    return nameUrlMap;
}
export function autoFillUrls() {
    const result = { filled: 0, mappedNames: 0 };
    try {
        const worksheet = getDataSheet();
        if (!worksheet) {
            BGM.Dialog.alert('无法获取工作表', '提示');
            return result;
        }
        const headerRow = findHeaderRow(worksheet);
        if (!headerRow || headerRow < 1) {
            BGM.Dialog.alert('未找到表头行', '提示');
            return result;
        }
        const columnMap = getColumnMap(worksheet, headerRow);
        const urlColumn = columnMap.get('Bangumi_URL');
        const nameColumn = columnMap.get('名称');
        if (urlColumn === undefined || nameColumn === undefined) {
            BGM.Dialog.alert('未找到 "Bangumi_URL" 或 "名称" 列', '提示');
            return result;
        }
        const lastRow = getLastRow(worksheet);
        if (lastRow <= headerRow) {
            BGM.Dialog.alert('没有数据行需要补全', '提示');
            return result;
        }
        bgmLog(LOG_LEVELS.INFO, `[autoFillUrls] 表头行: ${String(headerRow)}, 最后数据行: ${String(lastRow)}, URL列: ${String(urlColumn)}, 名称列: ${String(nameColumn)}`);
        const nameUrlMap = _buildNameUrlMap(worksheet, headerRow, lastRow, columnMap);
        const mappedKeys = Object.keys(nameUrlMap).length;
        result.mappedNames = mappedKeys;
        if (mappedKeys === 0) {
            BGM.Dialog.alert('没有找到有效的 URL 映射，请先填写一些条目', '提示');
            return result;
        }
        bgmLog(LOG_LEVELS.INFO, `[autoFillUrls] 已建立 ${String(mappedKeys)} 个名称/别名 → URL 映射`);
        for (let row = headerRow + 1; row <= lastRow; row += 1) {
            const currentUrl = trim(getCellValue(worksheet, row, urlColumn));
            if (!currentUrl) {
                const nameValue = trim(getCellValue(worksheet, row, nameColumn));
                if (nameValue) {
                    const fillUrl = nameUrlMap[nameValue];
                    if (fillUrl) {
                        setCellValue(worksheet, row, urlColumn, fillUrl);
                        result.filled += 1;
                    }
                }
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[autoFillUrls] 补全完成: ${String(result.filled)} 行`);
    }
    catch (error) {
        BGM.handleError(error, { context: 'autoFillUrls', showAlert: true });
    }
    return result;
}
export function showAutoFillUrlDialog() {
    const worksheet = getDataSheet();
    if (!worksheet)
        return;
    const headerRow = findHeaderRow(worksheet);
    if (!headerRow || headerRow < 1) {
        BGM.Dialog.alert('未找到表头行', '提示');
        return;
    }
    const columnMap = getColumnMap(worksheet, headerRow);
    const nameCount = columnMap.has('名称') ? columnMap.get('名称') : '?';
    const urlCount = columnMap.has('Bangumi_URL') ? columnMap.get('Bangumi_URL') : '未找到';
    if (!columnMap.has('Bangumi_URL') || !columnMap.has('名称')) {
        BGM.Dialog.alert('未找到 "Bangumi_URL" 或 "名称" 列，无法执行', '提示');
        return;
    }
    BGM.Dialog.confirm(`名称列: 第 ${String(nameCount ?? '')} 列\nURL列: 第 ${String(urlCount ?? '')} 列\n\n将根据已有 URL 的同名条目补全缺失的 URL（也支持别名匹配）。\n确定要继续吗？`, (isConfirmed) => {
        if (!isConfirmed)
            return;
        const result = autoFillUrls();
        if (result.filled > 0) {
            BGM.Dialog.alert(`补全完成！\n已建立 ${String(result.mappedNames)} 个名称/别名映射\n补全了 ${String(result.filled)} 行的缺失 URL`, '结果');
        }
        else {
            BGM.Dialog.alert('没有需要补全的 URL', '提示');
        }
    }, 'URL 自动补全');
}
export { _buildNameUrlMap, _splitAliases };
