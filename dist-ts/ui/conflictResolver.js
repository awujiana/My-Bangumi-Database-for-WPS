/**
 * @fileoverview 冲突解决 UI 组件
 * @module ui/conflictResolver
 *
 * @description
 * 在 GitHub 仓库同步流程中，当远程条目与本地 Excel 行存在字段级差异时，
 * 弹出模态对话框让用户逐字段选择保留本地值或采用远程值。
 *
 * 设计要点：
 * - 纯 DOM API 构建，无第三方依赖，兼容 WPS 内嵌浏览器
 * - 所有动态文本均使用 textContent（防 XSS）
 * - 返回 Promise<ConflictResolution[] | null>：
 *   - 用户点击「确认」返回解决决策数组（可能为空数组，表示无冲突）
 *   - 用户点击「取消」返回 null，调用方应中止同步
 * - 模态框关闭后立即从 DOM 移除，避免残留监听器
 */
/** 「选择本地」按钮的 data-value 标记 */
const CHOICE_LOCAL = 'local';
/** 「选择远程」按钮的 data-value 标记 */
const CHOICE_REMOTE = 'remote';
/**
 * 显示冲突解决对话框
 *
 * @param conflicts 冲突列表（来自 detectGithubConflicts）
 * @returns 用户的解决决策；若用户取消则返回 null；空冲突列表直接返回空数组
 */
export function showConflictResolver(conflicts) {
    return new Promise((resolve) => {
        // 空冲突：直接返回空数组，不弹窗
        if (conflicts.length === 0) {
            resolve([]);
            return;
        }
        // 创建并挂载模态框
        const modal = createConflictModal(conflicts, (result) => {
            resolve(result);
        });
        document.body.appendChild(modal);
        // 焦点管理：将焦点移至「确认」按钮，便于键盘操作
        const confirmBtn = modal.querySelector('.conflict-btn-confirm');
        confirmBtn?.focus();
    });
}
/**
 * 创建冲突解决模态框 DOM
 *
 * @param conflicts 冲突列表
 * @param onComplete 完成回调（确认时传决策数组，取消时传 null）
 * @returns 模态框根元素（尚未挂载到 DOM）
 */
function createConflictModal(conflicts, onComplete) {
    const modal = document.createElement('div');
    modal.className = 'modal conflict-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'conflictModalTitle');
    const content = document.createElement('div');
    content.className = 'modal-content conflict-modal-content';
    // ========== 标题栏 ==========
    const header = document.createElement('div');
    header.className = 'modal-header conflict-modal-header';
    const title = document.createElement('h3');
    title.id = 'conflictModalTitle';
    title.textContent = '⚠️ 冲突解决';
    header.appendChild(title);
    const toolbar = document.createElement('div');
    toolbar.className = 'conflict-toolbar';
    const count = document.createElement('span');
    count.className = 'conflict-count';
    count.textContent = `${conflicts.length} 个冲突`;
    toolbar.appendChild(count);
    const allLocalBtn = document.createElement('button');
    allLocalBtn.type = 'button';
    allLocalBtn.className = 'btn small';
    allLocalBtn.textContent = '全部使用本地';
    toolbar.appendChild(allLocalBtn);
    const allRemoteBtn = document.createElement('button');
    allRemoteBtn.type = 'button';
    allRemoteBtn.className = 'btn small';
    allRemoteBtn.textContent = '全部使用远程';
    toolbar.appendChild(allRemoteBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn small';
    cancelBtn.textContent = '取消';
    toolbar.appendChild(cancelBtn);
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn small primary conflict-btn-confirm';
    confirmBtn.textContent = '确认';
    toolbar.appendChild(confirmBtn);
    header.appendChild(toolbar);
    content.appendChild(header);
    // ========== 冲突列表（表格） ==========
    const body = document.createElement('div');
    body.className = 'modal-body conflict-modal-body';
    const table = document.createElement('table');
    table.className = 'conflict-table';
    const thead = document.createElement('thead');
    const headTr = document.createElement('tr');
    const thSid = document.createElement('th');
    thSid.scope = 'col';
    thSid.textContent = 'SID';
    headTr.appendChild(thSid);
    const thField = document.createElement('th');
    thField.scope = 'col';
    thField.textContent = '字段';
    headTr.appendChild(thField);
    const thLocal = document.createElement('th');
    thLocal.scope = 'col';
    thLocal.textContent = '本地值';
    headTr.appendChild(thLocal);
    const thRemote = document.createElement('th');
    thRemote.scope = 'col';
    thRemote.textContent = '远程值';
    headTr.appendChild(thRemote);
    const thSelect = document.createElement('th');
    thSelect.scope = 'col';
    thSelect.textContent = '选择';
    headTr.appendChild(thSelect);
    thead.appendChild(headTr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    /** 每个 conflict 对应的「本地」radio 引用（与 conflicts 索引一一对应） */
    const localRadios = [];
    /** 每个 conflict 对应的「远程」radio 引用 */
    const remoteRadios = [];
    conflicts.forEach((conflict, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'conflict-row';
        const sidTd = document.createElement('td');
        sidTd.textContent = conflict.sid;
        tr.appendChild(sidTd);
        const fieldTd = document.createElement('td');
        fieldTd.textContent = conflict.field;
        tr.appendChild(fieldTd);
        const localTd = document.createElement('td');
        localTd.className = 'conflict-col-local';
        localTd.textContent = conflict.localValue;
        tr.appendChild(localTd);
        const remoteTd = document.createElement('td');
        remoteTd.className = 'conflict-col-remote';
        remoteTd.textContent = conflict.remoteValue;
        tr.appendChild(remoteTd);
        const selectTd = document.createElement('td');
        selectTd.className = 'conflict-col-select';
        const radioName = `conflict-${idx}`;
        const localRadio = document.createElement('input');
        localRadio.type = 'radio';
        localRadio.name = radioName;
        localRadio.value = CHOICE_LOCAL;
        localRadio.checked = true; // 默认保留本地
        localRadio.id = `${radioName}-local`;
        localRadios.push(localRadio);
        const localLabel = document.createElement('label');
        localLabel.htmlFor = localRadio.id;
        localLabel.textContent = '本地';
        const remoteRadio = document.createElement('input');
        remoteRadio.type = 'radio';
        remoteRadio.name = radioName;
        remoteRadio.value = CHOICE_REMOTE;
        remoteRadio.id = `${radioName}-remote`;
        remoteRadios.push(remoteRadio);
        const remoteLabel = document.createElement('label');
        remoteLabel.htmlFor = remoteRadio.id;
        remoteLabel.textContent = '远程';
        selectTd.appendChild(localRadio);
        selectTd.appendChild(localLabel);
        selectTd.appendChild(remoteRadio);
        selectTd.appendChild(remoteLabel);
        tr.appendChild(selectTd);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
    content.appendChild(body);
    modal.appendChild(content);
    // ========== 事件绑定 ==========
    /** 安全移除模态框：先解绑事件，再从 DOM 移除 */
    const closeModal = () => {
        // 移除事件监听器，避免内存泄漏
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        allLocalBtn.onclick = null;
        allRemoteBtn.onclick = null;
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    };
    /** 收集当前所有冲突的解决决策 */
    const collectResolutions = () => {
        return conflicts.map((conflict, idx) => {
            const localRadio = localRadios[idx];
            const chosenValue = localRadio?.checked ? 'local' : 'remote';
            return {
                sid: conflict.sid,
                field: conflict.field,
                chosenValue,
            };
        });
    };
    confirmBtn.onclick = () => {
        closeModal();
        onComplete(collectResolutions());
    };
    cancelBtn.onclick = () => {
        closeModal();
        onComplete(null);
    };
    allLocalBtn.onclick = () => {
        for (const radio of localRadios) {
            radio.checked = true;
        }
        // 单选互斥：远程 radio 由浏览器自动取消
    };
    allRemoteBtn.onclick = () => {
        for (const radio of remoteRadios) {
            radio.checked = true;
        }
    };
    return modal;
}
