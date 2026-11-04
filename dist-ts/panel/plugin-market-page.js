/**
 * @fileoverview 插件市场页面逻辑
 * @module panel/pluginMarketPage
 * @description 来源填写 → 拉清单 → 展示功能与权限 → 确认安装 → 列表管理。
 *   所有网络/落盘动作都在 `plugins/pluginMarket`，本文件只负责渲染与交互。
 *
 *   渲染一律走 DOM API（不用 innerHTML）—— 插件清单来自外部仓库，字段内容不可信，
 *   `textContent` 是最省心的转义方式。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { tOr } from '../i18n/locale-store.js';
import { confirmAsync, showToast } from '../ui/dialog.js';
import { bgmLog, copyTextWithResult, getApp } from '../tools/util/index.js';
import { CURRENT_VERSION } from '../tools/update-check.js';
import { describeSignatureStatus, fetchPluginManifest, installPlugin, pluginDirectoryUrl, uninstallPlugin, } from '../plugins/plugin-market.js';
import { parsePluginSource, HOST_PLUGIN_API_VERSION } from '../plugins/plugin-manifest.js';
import { loadPluginIndex, patchPluginRecord } from '../plugins/plugin-store.js';
import { PLUGIN_PERMISSION_FALLBACK } from '../plugins/plugin-types.js';
import { activatePlugin, deactivatePlugin, createPluginLogger, manifestFromRecord, markPluginLoaded, } from '../plugins/plugin-runtime.js';
import { checkPluginUpdates, startPluginUpdateLoop } from '../plugins/plugin-updater.js';
/**
 * 签名状态 → 徽标文案。
 *
 * 这里只存 key 与源语言兜底，渲染时才 `tOr` —— 常量表不能在模块加载时定死译文
 * （切语言后不会重算，见 `文档/插件市场.md` §7）。
 */
const SIGNATURE_LABELS = {
    verified: { key: 'plugin.signature.verified', fallback: '作者已验证' },
    unsigned: { key: 'plugin.signature.unsigned', fallback: '未签名' },
    'untrusted-key': { key: 'plugin.signature.untrustedKey', fallback: '未知签名者' },
    invalid: { key: 'plugin.signature.invalid', fallback: '签名无效' },
    unsupported: { key: 'plugin.signature.unsupported', fallback: '无法验证' },
};
const state = {
    rootUrl: new URL('../', window.location.href),
    devMode: false,
    pendingManifest: null,
    stopUpdateLoop: null,
};
/** 取元素（找不到直接返回 null，避免非空断言） */
function byId(id) {
    return document.getElementById(id);
}
/** 往日志区追加一行 */
function appendLog(message, level = 'info') {
    const target = byId('pluginLog');
    if (target === null)
        return;
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = `[${stamp}] ${level.toUpperCase()} ${message}\n`;
    target.append(line);
    target.scrollTop = target.scrollHeight;
}
/** 页面级提示 */
function setSourceMessage(message, level) {
    const target = byId('pluginSourceMessage');
    if (target === null)
        return;
    target.textContent = message;
    target.dataset.level = level;
}
/** 权限的中文/译文名称 */
function permissionName(permission) {
    return tOr(`plugin.permission.${permission}.name`, PLUGIN_PERMISSION_FALLBACK[permission].name);
}
/** 权限的风险说明 */
function permissionRisk(permission) {
    return tOr(`plugin.permission.${permission}.risk`, PLUGIN_PERMISSION_FALLBACK[permission].risk);
}
/** 造一个元素 */
function element(tag, cssClass, text) {
    const node = document.createElement(tag);
    if (cssClass !== undefined)
        node.className = cssClass;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
/** 会触发「高风险」样式与二次确认的权限 */
const RISKY_PERMISSIONS = new Set([
    'sheet.read',
    'sheet.write',
    'data.write',
    'net.fetch',
]);
/** 渲染权限标签 */
function renderPermissions(permissions) {
    const wrap = element('div', 'plugin-permissions');
    for (const permission of permissions) {
        const tag = element('span', 'plugin-permission', permissionName(permission));
        tag.title = permissionRisk(permission);
        tag.dataset.risky = String(RISKY_PERMISSIONS.has(permission));
        wrap.append(tag);
    }
    return wrap;
}
/** 渲染签名徽标 */
function renderSignatureBadge(status) {
    const label = SIGNATURE_LABELS[status];
    const badge = element('span', 'plugin-signature-badge', tOr(label.key, label.fallback));
    badge.dataset.status = status;
    return badge;
}
/**
 * 三项版本信息：插件版本 / 数据源版本 / 支持的 MBD 最低版本。
 *
 * 待确认与已安装两张卡片共用这一行，保证「装之前看到的」和「装完之后看到的」口径一致。
 * 纯工具型插件没有数据源，用不带数据源的模板；旧索引缺 minHostVersion 时显示破折号。
 * 文案走 `tOr` 且变量交给第三参插值 —— 兜底原文同样是模板，写死中文会露出 `{version}`。
 */
function renderVersionInfo(pluginVersion, minHostVersion, dataSourceVersion) {
    const values = {
        pluginVersion,
        minHostVersion: minHostVersion === '' ? '—' : minHostVersion,
    };
    const text = dataSourceVersion === undefined
        ? tOr('plugin.meta.versionInfoNoData', '插件 v{pluginVersion} · 支持 MBD ≥ {minHostVersion}', values)
        : tOr('plugin.meta.versionInfo', '插件 v{pluginVersion} · 数据源 v{dataSourceVersion} · 支持 MBD ≥ {minHostVersion}', { ...values, dataSourceVersion });
    return element('p', 'plugin-item-meta plugin-version-line', text);
}
/** 渲染「待确认」卡片 */
function renderPending() {
    const list = byId('pluginPendingList');
    const empty = byId('pluginPendingEmpty');
    if (list === null || empty === null)
        return;
    list.replaceChildren();
    const pending = state.pendingManifest;
    if (pending === null) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;
    const { manifest, source, signatureStatus } = pending;
    const item = element('div', 'plugin-item');
    const head = element('div', 'plugin-item-head');
    head.append(element('span', 'plugin-item-name', manifest.name), renderSignatureBadge(signatureStatus));
    item.append(head, element('p', 'plugin-item-desc', manifest.description));
    item.append(renderVersionInfo(manifest.version, manifest.minHostVersion, manifest.dataSourceVersion));
    item.append(element('p', 'plugin-item-meta', `${manifest.author} · ${source.value} · apiVersion ${manifest.apiVersion}`));
    item.append(renderPermissions(manifest.permissions));
    if (manifest.features !== undefined) {
        const features = element('div', 'plugin-item-meta');
        for (const feature of manifest.features) {
            features.append(element('div', '', `· ${feature.name}：${feature.description}`));
        }
        item.append(features);
    }
    const actions = element('div', 'plugin-item-actions');
    const isVerified = signatureStatus === 'verified';
    const confirm = element('button', isVerified ? 'bgm-btn small primary' : 'bgm-btn small danger', isVerified
        ? tOr('plugin.action.confirmInstall', '确认安装')
        : tOr('plugin.action.installAnyway', '无视风险安装'));
    confirm.addEventListener('click', () => {
        void runInstall();
    });
    const cancel = element('button', 'bgm-btn small', tOr('plugin.action.cancel', '取消'));
    cancel.addEventListener('click', () => {
        state.pendingManifest = null;
        renderPending();
    });
    actions.append(confirm, cancel);
    item.append(actions);
    list.append(item);
}
/** 渲染已安装列表 */
function renderInstalled() {
    const list = byId('pluginInstalledList');
    const empty = byId('pluginInstalledEmpty');
    if (list === null || empty === null)
        return;
    const count = byId('pluginInstalledCount');
    const index = loadPluginIndex();
    list.replaceChildren();
    if (count !== null)
        count.textContent = String(index.plugins.length);
    empty.hidden = index.plugins.length > 0;
    for (const record of index.plugins) {
        list.append(renderInstalledItem(record));
    }
}
/** 渲染一条已安装记录 */
function renderInstalledItem(record) {
    const item = element('div', 'plugin-item');
    const head = element('div', 'plugin-item-head');
    head.append(element('span', 'plugin-item-name', record.name));
    if (record.pendingReload === true) {
        head.append(element('span', 'plugin-item-badge', tOr('plugin.badge.pendingReload', '待重载生效')));
    }
    if (record.signatureStatus !== undefined) {
        head.append(renderSignatureBadge(record.signatureStatus));
    }
    if (!record.enabled) {
        head.append(element('span', 'plugin-item-version', tOr('plugin.badge.disabled', '已禁用')));
    }
    item.append(head);
    item.append(renderVersionInfo(record.version, record.minHostVersion ?? '', record.dataSourceVersion));
    item.append(element('p', 'plugin-item-meta', `${record.author} · ${record.source.value}`));
    if (record.permissions !== undefined)
        item.append(renderPermissions(record.permissions));
    const actions = element('div', 'plugin-item-actions');
    const toggle = element('button', 'bgm-btn small', record.enabled ? tOr('plugin.action.disable', '禁用') : tOr('plugin.action.enable', '启用'));
    toggle.addEventListener('click', () => {
        void togglePlugin(record);
    });
    const update = element('button', 'bgm-btn small', tOr('plugin.action.checkOne', '检查更新'));
    update.addEventListener('click', () => {
        void checkOne(record);
    });
    const uninstall = element('button', 'bgm-btn small', tOr('plugin.action.uninstall', '卸载'));
    uninstall.addEventListener('click', () => {
        void runUninstall(record);
    });
    actions.append(toggle, update, uninstall);
    item.append(actions);
    return item;
}
/** 日志级别 → 页面日志区的样式级别 */
function toLogStyle(level) {
    if (level === 'ERROR')
        return 'error';
    if (level === 'WARN')
        return 'warn';
    return 'info';
}
/** 构造宿主依赖（页面侧实现） */
function createHostDependencies() {
    return {
        hostVersion: CURRENT_VERSION,
        apiVersion: HOST_PLUGIN_API_VERSION,
        locale: () => document.documentElement.lang || 'zh-CN',
        toast: (message, level) => {
            showToast(message, level);
        },
        confirm: (message) => confirmAsync(message),
        openPane: (pageId) => {
            appendLog(`插件请求打开页面：${pageId}`);
        },
        registerCommand: (command) => {
            appendLog(`插件注册命令：${command.title}`);
        },
        translate: (key, fallback, parameters) => tOr(key, fallback, parameters),
        log: createPluginLogger('host', (level, message) => {
            appendLog(message, toLogStyle(level));
        }),
    };
}
/** 步骤 1：拉清单并展示待确认卡片 */
async function runFetch() {
    const input = byId('pluginSourceInput');
    const text = input?.value ?? '';
    const source = parsePluginSource(text);
    if (source === null) {
        setSourceMessage(tOr('plugin.error.emptySource', '请先填写仓库地址'), 'error');
        return;
    }
    if (source.kind === 'local' && !state.devMode) {
        setSourceMessage(tOr('plugin.error.localNeedsDevMode', '本地目录来源需要先勾选「开发者模式」'), 'error');
        return;
    }
    setSourceMessage(tOr('plugin.status.fetching', '正在获取插件清单…'), 'info');
    const fetched = await fetchPluginManifest(source, CURRENT_VERSION);
    if (!fetched.ok) {
        setSourceMessage(fetched.reason, 'error');
        appendLog(`清单校验失败：${fetched.reason}`, 'error');
        return;
    }
    state.pendingManifest = {
        manifest: fetched.manifest,
        source,
        signatureStatus: fetched.signatureStatus,
    };
    renderPending();
    setSourceMessage(tOr('plugin.status.fetched', '清单已获取：{name}，确认权限后安装', {
        name: fetched.manifest.name,
    }), 'success');
    appendLog(`清单通过校验：${fetched.manifest.id} v${fetched.manifest.version}（${describeSignatureStatus(fetched.signatureStatus)}）`);
}
/** 步骤 2：确认后安装 */
async function runInstall() {
    const pending = state.pendingManifest;
    if (pending === null)
        return;
    const { manifest, source, signatureStatus } = pending;
    const permissionList = manifest.permissions.map((permission) => permissionName(permission));
    const isConfirmed = await confirmAsync(tOr('plugin.confirm.install', '安装 {name} v{version}？\n\n它会用到这些权限：{permissions}\n\n插件与 MBD 运行在同一个环境里，不是沙箱，请只安装你信任的作者的插件。', {
        name: manifest.name,
        version: manifest.version,
        permissions: permissionList.join('、'),
    }));
    if (!isConfirmed)
        return;
    const isTrusted = signatureStatus === 'verified';
    if (!isTrusted) {
        const isRiskAccepted = await confirmAsync(tOr('plugin.confirm.untrusted', '这个插件的签名没通过验证：{status}。\n\n签名未通过意味着「没人能证明这份代码是谁写的」，它可能在你不知情时被替换。\n\n确定要无视风险安装吗？', { status: describeSignatureStatus(signatureStatus) }));
        if (!isRiskAccepted) {
            appendLog(`已放弃安装 ${manifest.id}（${describeSignatureStatus(signatureStatus)}）`, 'warn');
            return;
        }
    }
    setSourceMessage(tOr('plugin.status.installing', '正在下载并校验…'), 'info');
    const result = await installPlugin(state.rootUrl, source, CURRENT_VERSION, {
        allowUntrusted: !isTrusted,
    });
    if (!result.ok) {
        setSourceMessage(result.reason, 'error');
        appendLog(`安装失败：${result.reason}`, 'error');
        return;
    }
    appendLog(`已安装 ${result.manifest.id} v${result.manifest.version}`);
    if (result.pendingPermissions.length > 0) {
        appendLog(`新增权限：${result.pendingPermissions.map((item) => permissionName(item)).join('、')}`, 'warn');
    }
    state.pendingManifest = null;
    renderPending();
    renderInstalled();
    setSourceMessage(tOr('plugin.status.installed', '已安装 {name}，重新打开页面后生效', {
        name: result.manifest.name,
    }), 'success');
}
/** 启用 / 禁用 */
async function togglePlugin(record) {
    const isNextEnabled = !record.enabled;
    patchPluginRecord(record.id, { enabled: isNextEnabled });
    if (isNextEnabled) {
        const manifest = manifestFromRecord({ ...record, enabled: true });
        const activated = await activatePlugin(state.rootUrl, { ...record, enabled: true }, manifest, createHostDependencies());
        appendLog(activated.ok ? `已启用 ${record.id}` : `启用失败：${activated.reason}`, activated.ok ? 'info' : 'error');
        if (activated.ok)
            markPluginLoaded(record.id, record.version);
    }
    else {
        await deactivatePlugin(record.id);
        appendLog(`已禁用 ${record.id}`);
    }
    renderInstalled();
}
/** 单个插件检查更新 */
async function checkOne(record) {
    appendLog(`检查 ${record.id} 的更新…`);
    const outcomes = await checkPluginUpdates(state.rootUrl, CURRENT_VERSION, record.id);
    for (const outcome of outcomes) {
        if (outcome.status === 'needs-trust')
            await resolveTrust(record, outcome);
        describeOutcome(outcome);
    }
    renderInstalled();
}
/**
 * 手动接受签名变化并强制更新。
 *
 * 自动更新遇到签名变化会停下（`plugin-updater` 的 `needs-trust`），
 * 这里是唯一的放行入口 —— 必须由用户看着「具体哪里变了」点确认。
 */
async function resolveTrust(record, outcome) {
    const isAccepted = await confirmAsync(tOr('plugin.confirm.updateUntrusted', '{name} 的新版本 {version} 签名没通过验证：{reason}。\n\n自动更新已暂停。确定要无视风险、强制更新吗？', {
        name: record.name,
        version: outcome.to ?? '',
        reason: outcome.reason ?? '',
    }));
    if (!isAccepted)
        return;
    const installed = await installPlugin(state.rootUrl, record.source, CURRENT_VERSION, {
        allowUntrusted: true,
    });
    appendLog(installed.ok
        ? `${record.name} 已强制更新到 ${installed.manifest.version}（已无视签名风险，重开页面生效）`
        : `强制更新失败：${installed.reason}`, installed.ok ? 'warn' : 'error');
}
/** 卸载 */
async function runUninstall(record) {
    const isConfirmed = await confirmAsync(tOr('plugin.confirm.uninstall', '卸载 {name}？插件的本地数据会一起删除。', {
        name: record.name,
    }));
    if (!isConfirmed)
        return;
    await deactivatePlugin(record.id);
    const result = uninstallPlugin(state.rootUrl, record.id);
    appendLog(result.ok ? `已卸载 ${record.id}` : `卸载未完全成功：${result.reason ?? ''}`, result.ok ? 'info' : 'warn');
    renderInstalled();
}
/** 把一次更新结果写进日志 */
function describeOutcome(outcome) {
    if (outcome.status === 'updated') {
        appendLog(`${outcome.name} 已更新 ${outcome.from} → ${outcome.to ?? ''}（重开页面生效）`);
        return;
    }
    if (outcome.status === 'failed') {
        appendLog(`${outcome.name} 检查失败：${outcome.reason ?? ''}`, 'warn');
        return;
    }
    if (outcome.status === 'needs-permission') {
        appendLog(`${outcome.name} 需要重新授权：${outcome.reason ?? ''}`, 'warn');
        return;
    }
    if (outcome.status === 'needs-trust') {
        appendLog(`${outcome.name} 签名状态变化，已暂停更新：${outcome.reason ?? ''}`, 'warn');
        return;
    }
    if (outcome.status === 'up-to-date') {
        appendLog(`${outcome.name} 已是最新版本`);
    }
}
/** 检查全部更新 */
async function runCheckAll() {
    appendLog('检查全部插件更新…');
    const outcomes = await checkPluginUpdates(state.rootUrl, CURRENT_VERSION);
    if (outcomes.length === 0) {
        appendLog('没有已安装的插件');
        return;
    }
    for (const outcome of outcomes)
        describeOutcome(outcome);
    renderInstalled();
}
/**
 * 打开插件开发规范文档。
 *
 * WPS 任务窗格会拦掉 `<a>` 导航（赞赏页实测 `target="_blank"` / `mailto:` 都拉不起
 * 外部程序），所以优先交给宿主 `OAAssist.ShellExecute` 唤起系统浏览器；宿主没给这个
 * 接口时退回 `window.open`。不管走哪条路都把地址复制一份到剪贴板：宿主真的静默拦掉
 * 导航时，用户至少能直接粘贴到浏览器，不会遇到「点了没反应」。
 */
function openPluginSpec(link) {
    const url = link.href;
    const app = getApp();
    if (app?.OAAssist?.ShellExecute) {
        app.OAAssist.ShellExecute(url);
    }
    else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
    const copied = copyTextWithResult(url);
    if (copied.ok) {
        showToast(tOr('plugin.status.specLinkCopied', '规范链接已复制；浏览器没打开时请手动粘贴访问'), 'success');
    }
    else {
        appendLog(`插件开发规范：${url}`);
    }
}
/** 初始化页面 */
export function initializePluginMarketPage() {
    const installButton = byId('pluginInstallButton');
    installButton?.addEventListener('click', () => {
        void runFetch();
    });
    byId('pluginCheckUpdatesButton')?.addEventListener('click', () => {
        void runCheckAll();
    });
    byId('pluginRefreshButton')?.addEventListener('click', () => {
        renderInstalled();
        appendLog('列表已刷新');
    });
    byId('pluginLogClearButton')?.addEventListener('click', () => {
        const target = byId('pluginLog');
        if (target !== null)
            target.textContent = '';
    });
    const specLink = byId('pluginSpecLink');
    specLink?.addEventListener('click', (event) => {
        event.preventDefault();
        openPluginSpec(specLink);
    });
    const developmentModeToggle = byId('pluginDevModeToggle');
    developmentModeToggle?.addEventListener('change', () => {
        state.devMode = developmentModeToggle.checked;
        appendLog(`开发者模式：${state.devMode ? '开' : '关'}`);
    });
    renderPending();
    renderInstalled();
    state.stopUpdateLoop = startPluginUpdateLoop(state.rootUrl, CURRENT_VERSION, (outcomes) => {
        for (const outcome of outcomes)
            describeOutcome(outcome);
        renderInstalled();
    }, { initialDelay: 30_000, interval: 6 * 60 * 60 * 1000 });
    window.addEventListener('beforeunload', () => {
        state.stopUpdateLoop?.();
    });
    bgmLog(LOG_LEVELS.INFO, '[plugin-market] 页面已初始化');
    appendLog(`插件目录：${pluginDirectoryUrl(state.rootUrl, '<id>').pathname}`);
}
