/**
 * 富化预览设置（设置页「🎨 富化预览」区块）的加载 / 保存 / 放弃修改。
 *
 * 配置键（与 ts/panel/enrich-page.ts 的 getEnrichPreviewConfig 读取口径一致）：
 *   - bgm_enrich_ep_single        「单集」阈值（默认 1，橙色徽章）
 *   - bgm_enrich_ep_full          「完结」阈值（默认 12；等于无色，大于绿色，之间黄色）
 *   - bgm_enrich_filter_keywords  自定义噪声关键词（换行/逗号分隔，子串匹配即过滤）
 *   - bgm_enrich_tags_color       TAGS 标签彩色化开关（默认开）
 *   - bgm_enrich_premiere_color   首播日期着色开关（默认开）
 *   - bgm_enrich_platform_color   播放平台着色开关（默认开）
 *   - bgm_enrich_auto_clean       富化后自动合并去重开关（默认开）
 *
 * 富化页在每次渲染预览前重读配置，因此设置页保存后无需跨页通知
 * （跨页 postMessage 只会发到 parent/top/self，推不到作为兄弟窗格的富化页）。
 *
 * @module ui/handlers/enrich-preview-settings
 */
/** 从配置读取并填充表单（页面加载 / 放弃修改共用） */
export declare function loadEnrichPreviewSettingsIntoForm(): void;
/** 保存表单到配置 */
export declare function saveEnrichPreviewSettings(): void;
/** 放弃修改：重新从配置读取并覆盖表单 */
export declare function reloadEnrichPreviewSettings(): void;
//# sourceMappingURL=enrich-preview-settings.d.ts.map