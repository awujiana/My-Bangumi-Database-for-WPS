/**
 * @fileoverview 多账号切换 UI（设置页列表 + 长按头像浮层）
 * @module ui/handlers/accounts
 * @description 账号档案的读写全在 `tools/accounts`，本文件只做两件呈现：
 *              1. 设置页「👤 账号」里的档案列表（切换 / 删除 / 把当前 Token 记进来）；
 *              2. 长按头像（顶栏头像或侧栏头像）弹出账号浮层，点一下即切换。
 *
 * 为什么用长按而不是点击：头像是「身份指示」，单击不该有破坏性行为；
 * 长按 550ms 是移动端与桌面都习惯的「更多操作」手势，误触率低。
 */
import { LOG_LEVELS, bgmLog, loadBgToken, showToast } from '../../index.js';
import { getActiveUserId, listAccounts, removeAccount, switchAccount, didUpsertAccount, } from '../../tools/accounts.js';
/** 长按判定时长（ms） */
const LONG_PRESS_MS = 550;
/** 浮层元素 id（同一时刻只允许一个） */
const MENU_ID = 'accountSwitcherMenu';
/** 当前生效账号的用户名（档案里没有时退回 userId） */
function displayName(account, activeId) {
    const name = account.username === '' ? account.userId : account.username;
    return account.userId === activeId ? `${name}（当前）` : name;
}
/** 切换成功后统一收尾：关浮层 + 重渲染列表 + 提示 */
function afterSwitch(account) {
    closeAccountMenu();
    renderAccountList();
    showToast(`已切换到「${account.username === '' ? account.userId : account.username}」`, 'success');
    bgmLog(LOG_LEVELS.INFO, `[accounts] 已切换账号: ${account.userId}`);
}
/** 渲染设置页的账号列表 */
export function renderAccountList() {
    const host = document.getElementById('accountList');
    if (!host)
        return;
    const activeId = getActiveUserId(true);
    const accounts = listAccounts(true);
    host.replaceChildren();
    if (accounts.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent =
            '还没有记录任何账号。先在上面填好 Token 并点「测试 Token」识别用户，再点下面的「记录当前账号」。';
        host.append(empty);
        return;
    }
    for (const account of accounts) {
        const row = document.createElement('div');
        row.className = 'account-row';
        if (account.userId === activeId)
            row.classList.add('is-active');
        const name = document.createElement('span');
        name.className = 'account-name';
        name.textContent = displayName(account, activeId);
        const meta = document.createElement('span');
        meta.className = 'account-meta';
        meta.textContent = `ID ${account.userId}`;
        const switchButton = document.createElement('button');
        switchButton.type = 'button';
        switchButton.className = 'bgm-btn small';
        switchButton.dataset.accountSwitch = account.userId;
        switchButton.textContent = account.userId === activeId ? '使用中' : '切换';
        switchButton.disabled = account.userId === activeId;
        const accountDeleteButton = document.createElement('button');
        accountDeleteButton.type = 'button';
        accountDeleteButton.className = 'bgm-btn small';
        accountDeleteButton.dataset.accountRemove = account.userId;
        accountDeleteButton.textContent = '🗑️';
        accountDeleteButton.title = '从列表移除（不影响当前 Token）';
        accountDeleteButton.setAttribute('aria-label', `移除账号 ${account.userId}`);
        row.append(name, meta, switchButton, accountDeleteButton);
        host.append(row);
    }
}
/** 关闭账号浮层（重复调用安全） */
export function closeAccountMenu() {
    document.getElementById(MENU_ID)?.remove();
}
/**
 * 长按头像后弹出的账号浮层
 * @param anchor - 触发元素（浮层贴它的右下角）
 */
function showAccountMenu(anchor) {
    closeAccountMenu();
    const accounts = listAccounts(true);
    const activeId = getActiveUserId(true);
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'account-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '切换账号');
    if (accounts.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'account-menu-hint';
        hint.textContent = '还没有记录账号。到「设置 → 账号」里记录当前 Token 后可在这里一键切换。';
        menu.append(hint);
    }
    for (const account of accounts) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'account-menu-item';
        item.setAttribute('role', 'menuitem');
        item.dataset.accountSwitch = account.userId;
        item.textContent = displayName(account, activeId);
        if (account.userId === activeId)
            item.classList.add('is-active');
        menu.append(item);
    }
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'account-menu-item account-menu-manage';
    manage.dataset.accountManage = '1';
    manage.textContent = '⚙️ 在设置页管理账号…';
    menu.append(manage);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${String(Math.round(rect.bottom + 6))}px`;
    menu.style.left = `${String(Math.round(Math.max(8, rect.right - 220)))}px`;
    document.body.append(menu);
}
/** 点击委托：切换 / 删除 / 记录当前 / 去设置页 */
function onAccountClick(event) {
    const { target } = event;
    if (!(target instanceof Element))
        return;
    const switchId = target.closest('[data-account-switch]')?.dataset.accountSwitch;
    if (switchId !== undefined && switchId !== '') {
        event.preventDefault();
        const account = switchAccount(switchId);
        if (account === null) {
            showToast('切换失败：该账号不在记录里', 'error');
            return;
        }
        afterSwitch(account);
        return;
    }
    const accountDeleteId = target.closest('[data-account-remove]')?.dataset.accountRemove;
    if (accountDeleteId !== undefined && accountDeleteId !== '') {
        event.preventDefault();
        if (removeAccount(accountDeleteId)) {
            renderAccountList();
            showToast('已从账号列表移除（当前 Token 未变）', 'info');
        }
        else {
            showToast('移除失败', 'error');
        }
        return;
    }
    if (target.closest('[data-account-add]') !== null) {
        event.preventDefault();
        const token = loadBgToken();
        if (!token) {
            showToast('当前还没有 Token，请先在上方填写并保存', 'warn');
            return;
        }
        const userId = getActiveUserId(true);
        if (userId === '') {
            showToast('还不知道用户 ID：先点「测试 Token」识别，再回来记录', 'warn');
            return;
        }
        const nameElement = document.getElementById('userNameDisplay');
        const username = nameElement === null ? '' : nameElement.textContent.trim();
        if (didUpsertAccount({ userId, token, username })) {
            renderAccountList();
            showToast('已记录当前账号，之后可长按头像一键切换', 'success');
        }
        else {
            showToast('记录失败', 'error');
        }
        return;
    }
    if (target.closest('[data-account-manage]') !== null) {
        closeAccountMenu();
        // 设置页由 ribbon / 面板的 openSettings 负责打开；这里只关浮层并提示
        showToast('请到「设置 → 👤 账号」管理账号', 'info');
    }
}
/** 给一个头像元素挂长按手势 */
function bindLongPress(element) {
    if (element === null || element.dataset.longPressBound === '1')
        return;
    element.dataset.longPressBound = '1';
    let timer = null;
    const clear = () => {
        if (timer === null)
            return;
        window.clearTimeout(timer);
        timer = null;
    };
    element.addEventListener('pointerdown', () => {
        clear();
        timer = window.setTimeout(() => {
            timer = null;
            showAccountMenu(element);
        }, LONG_PRESS_MS);
    });
    element.addEventListener('pointerup', clear);
    element.addEventListener('pointerleave', clear);
    element.addEventListener('pointercancel', clear);
}
/**
 * 初始化账号管理：设置页列表 + 长按头像浮层。
 * 设置页与主面板都会调用；各自缺元素时静默跳过对应部分。
 */
export function initializeAccountManager() {
    const panel = document.getElementById('accountPanel');
    if (panel !== null && panel.dataset.bound !== '1') {
        panel.dataset.bound = '1';
        panel.addEventListener('click', onAccountClick);
        renderAccountList();
    }
    bindLongPress(document.getElementById('topbarAvatar'));
    bindLongPress(document.getElementById('userAvatar'));
    // 浮层点外部关闭（只在首次绑定时注册）
    if (document.body.dataset.accountMenuBound !== '1') {
        document.body.dataset.accountMenuBound = '1';
        document.addEventListener('pointerdown', (event) => {
            const menu = document.getElementById(MENU_ID);
            if (menu === null)
                return;
            const { target } = event;
            if (target instanceof Node && menu.contains(target))
                return;
            menu.remove();
        });
    }
    bgmLog(LOG_LEVELS.INFO, '[accounts] 账号管理已初始化');
}
