/**
 * @fileoverview 翻译原语（纯函数，不碰 DOM、不碰 IO）
 * @module i18n/translate
 * @description 只放「语言代码集合 + 占位符替换 + 覆盖率」这类无副作用的东西，
 *   方便单测；真正的状态机在 {@link module:i18n/localeStore}。
 */
/**
 * 支持的语言代码（BCP 47）
 *
 * 用 BCP 47 而不是 `cn` / `tw` 简写：与 WPS / Office / `navigator.language`
 * 同一套词表，将来接系统语言判断时不用再翻译一次。
 */
export const LOCALE_CODES = ['zh-CN', 'zh-TW', 'en'];
/**
 * 源语言：所有 key 以它为准
 *
 * 其余语言的 key 集合必须是它的**子集**（允许半翻译），多出来的 key 视为脏数据。
 */
export const SOURCE_LOCALE = 'zh-CN';
/** 判断字符串是不是受支持的语言代码 */
export function isLocaleCode(value) {
    return LOCALE_CODES.includes(value);
}
/**
 * 语言在设置页里的显示名（**用母语写**，不随界面语言变）
 *
 * 语言列表要让人「一眼找到自己的语言」，所以「繁體中文」在英文界面下也写
 * 「繁體中文」，不写 "Traditional Chinese"。语言包加载成功后可以再读
 * `nativeName` 覆盖（允许语言包自己定名）。
 */
export const LOCALE_LABELS = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    en: 'English',
};
/** 占位符：`{name}`，name 只允许字母数字下划线 */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/gu;
/**
 * 替换占位符
 *
 * 找不到的占位符**原样保留**（`{count}`），而不是替换成空串：漏传变量时
 * 界面上会露出 `{count}`，一眼能看出是代码漏了参数；替换成空串则会变成
 * 「已关闭  个页面」，没人查得出来。
 */
export function interpolate(template, variables) {
    if (variables === undefined)
        return template;
    return template.replace(PLACEHOLDER_PATTERN, (match, name) => {
        const value = variables[name];
        return value === undefined ? match : String(value);
    });
}
/** 取出文案里所有占位符名字（去重、升序），供语言包一致性门禁比对 */
export function extractPlaceholders(template) {
    const names = new Set();
    for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
        const name = match[1];
        if (name !== undefined)
            names.add(name);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
}
/** 算覆盖率：`total` 取源语言 key 数，`translated` 只数「有非空译文」的 key */
export function computeCoverage(source, target) {
    const total = Object.keys(source).length;
    if (total === 0)
        return { translated: 0, total: 0, percent: 100 };
    if (target === undefined)
        return { translated: 0, total, percent: 0 };
    let translated = 0;
    for (const key of Object.keys(source)) {
        const value = target[key];
        if (value !== undefined && value.trim() !== '')
            translated += 1;
    }
    return { translated, total, percent: Math.floor((translated / total) * 100) };
}
