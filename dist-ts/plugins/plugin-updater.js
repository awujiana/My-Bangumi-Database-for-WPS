/**
 * @fileoverview 插件的无感更新
 * @module plugins/pluginUpdater
 * @description 定时读各插件来源的 `plugin.json`，版本更高就在后台下载、校验、替换。
 *   **替换后不热重载** —— ESM 按 URL 缓存模块，没有可靠的热替换办法（语言包安装同样
 *   遇到并接受了这个限制），所以只标 `pendingReload`，由市场页提示「重开页面生效」。
 *
 *   失败一律静默：网络抖动不该弹窗打扰用户，原因记在 `lastCheckedAt` 与市场页卡片上。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { bgmLog } from '../tools/util/index.js';
import { compareVersions } from '../tools/update-check.js';
import { fetchPluginManifest, installPlugin, describeSignatureStatus } from './plugin-market.js';
import { loadPluginIndex, patchPluginRecord } from './plugin-store.js';
import { verifyPluginSignature } from './plugin-signature.js';
/**
 * 检查并执行一轮更新。
 *
 * @param rootUrl 加载项目录 URL
 * @param hostVersion 宿主版本（判 `minHostVersion`）
 * @param onlyId 只检查某一个插件（详情页用）
 */
export async function checkPluginUpdates(rootUrl, hostVersion, onlyId) {
    const index = loadPluginIndex();
    const targets = index.plugins.filter((record) => onlyId === undefined || record.id === onlyId);
    const outcomes = [];
    for (const record of targets) {
        if (record.enabled) {
            outcomes.push(await checkOne(rootUrl, hostVersion, record));
        }
        else {
            outcomes.push({
                id: record.id,
                name: record.name,
                from: record.version,
                status: 'skipped',
                reason: '已禁用',
            });
        }
    }
    return outcomes;
}
/** 检查单个插件 */
async function checkOne(rootUrl, hostVersion, record) {
    const fetched = await fetchPluginManifest(record.source, hostVersion);
    if (!fetched.ok) {
        patchPluginRecord(record.id, { lastCheckedAt: new Date().toISOString() });
        bgmLog(LOG_LEVELS.WARN, `[plugins] 检查更新失败 ${record.id}：${fetched.reason}`);
        return {
            id: record.id,
            name: record.name,
            from: record.version,
            status: 'failed',
            reason: fetched.reason,
        };
    }
    const remote = fetched.manifest;
    if (compareVersions(remote.version, record.version) <= 0) {
        patchPluginRecord(record.id, { lastCheckedAt: new Date().toISOString() });
        return { id: record.id, name: record.name, from: record.version, status: 'up-to-date' };
    }
    const installedPermissions = new Set(record.permissions);
    const added = remote.permissions.filter((permission) => !installedPermissions.has(permission));
    if (added.length > 0) {
        patchPluginRecord(record.id, {
            lastCheckedAt: new Date().toISOString(),
            pendingPermissions: added,
        });
        bgmLog(LOG_LEVELS.WARN, `[plugins] ${record.id} 新版本要求更多权限：${added.join(', ')}`);
        return {
            id: record.id,
            name: record.name,
            from: record.version,
            to: remote.version,
            status: 'needs-permission',
            reason: `新版本要求额外权限：${added.join('、')}`,
        };
    }
    // 签名只允许「变好」或「维持原样」：原本已验证的作者突然变成未签名/验签失败，
    // 说明仓库可能被接管或清单被改，自动更新必须停下来等用户确认。
    const signatureStatus = await verifyPluginSignature(remote);
    if (signatureStatus !== 'verified' && record.signatureStatus !== signatureStatus) {
        patchPluginRecord(record.id, { lastCheckedAt: new Date().toISOString() });
        bgmLog(LOG_LEVELS.WARN, `[plugins] ${record.id} 新版本签名状态变化（${describeSignatureStatus(signatureStatus)}），暂停更新`);
        return {
            id: record.id,
            name: record.name,
            from: record.version,
            to: remote.version,
            status: 'needs-trust',
            reason: describeSignatureStatus(signatureStatus),
        };
    }
    const installed = await installPlugin(rootUrl, record.source, hostVersion, {
        allowUntrusted: signatureStatus !== 'verified',
    });
    if (!installed.ok) {
        patchPluginRecord(record.id, { lastCheckedAt: new Date().toISOString() });
        bgmLog(LOG_LEVELS.WARN, `[plugins] 更新失败 ${record.id}：${installed.reason}`);
        return {
            id: record.id,
            name: record.name,
            from: record.version,
            to: remote.version,
            status: 'failed',
            reason: installed.reason,
        };
    }
    patchPluginRecord(record.id, {
        version: remote.version,
        lastCheckedAt: new Date().toISOString(),
        pendingReload: true,
    });
    bgmLog(LOG_LEVELS.INFO, `[plugins] ${record.id} 已更新 ${record.version} → ${remote.version}（重开页面生效）`);
    return {
        id: record.id,
        name: record.name,
        from: record.version,
        to: remote.version,
        status: 'updated',
    };
}
/**
 * 启动定时检查。
 *
 * @returns 停止函数（页面卸载时调用，避免定时器泄漏）
 */
export function startPluginUpdateLoop(rootUrl, hostVersion, onOutcome, options = {}) {
    const initialDelay = options.initialDelay ?? 30_000;
    const interval = options.interval ?? 6 * 60 * 60 * 1000;
    let isStopped = false;
    const runCheck = async () => {
        try {
            const outcomes = await checkPluginUpdates(rootUrl, hostVersion);
            if (!isStopped && outcomes.length > 0)
                onOutcome(outcomes);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            bgmLog(LOG_LEVELS.WARN, `[plugins] 定时检查更新异常：${message}`);
        }
    };
    const run = () => {
        if (isStopped)
            return;
        void runCheck();
    };
    const initialTimer = setTimeout(run, initialDelay);
    const intervalTimer = setInterval(run, interval);
    return () => {
        isStopped = true;
        clearTimeout(initialTimer);
        clearInterval(intervalTimer);
    };
}
