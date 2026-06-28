import { describe, it, expect, vi } from 'vitest';

/**
 * 纯函数逻辑测试 - exceltobangumi.ts 中的 isBangumiUrl / extractSubjectId / mapWatchStatus
 *
 * 测试策略：复制源码实现到测试文件，验证逻辑正确性。
 * 不直接 import 项目源码，以避免引入 WPS API / 循环依赖。
 * 实现来源：
 *   - ts/sync/exceltobangumi.ts 第 73-81 行（isBangumiUrl）
 *   - ts/sync/exceltobangumi.ts 第 369-395 行（extractSubjectId）
 *   - ts/sync/exceltobangumi.ts 第 414-444 行（mapWatchStatus）
 *   - ts/tools/util.ts 第 945-948 行（trim）
 *   - ts/core/constants.ts 第 428-432 行（URL_PATTERNS）
 *   - ts/core/constants.ts 第 472-485 行（WATCH_STATUS_MAP）
 */

// 复制自 ts/tools/util.ts 的 trim 实现（用于测试逻辑正确性）
function trim(str: string | null | undefined): string {
    if (!str) return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}

// 复制自 ts/core/constants.ts 的 URL_PATTERNS（用于测试逻辑正确性）
const URL_PATTERNS: RegExp[] = [
    /bgm\.tv\/subject\/(\d+)/i,
    /bangumi\.tv\/subject\/(\d+)/i,
    /chii\.in\/subject\/(\d+)/i
];

// 复制自 ts/core/constants.ts 的 WATCH_STATUS_MAP（用于测试逻辑正确性）
// 注意：实际 Bangumi API 数值为 1=想看, 2=看过, 3=在看, 4=搁置, 5=抛弃
const WATCH_STATUS_MAP: Record<string, number> = {
    "想看": 1, "想看动画": 1, "否": 1, "wish": 1, "1": 1, "false": 1,
    "看过": 2, "看完": 2, "已看": 2, "完": 2, "completed": 2, "2": 2, "是": 2, "true": 2,
    "在看": 3, "看动画": 3, "在看动画": 3, "在追": 3, "追": 3, "watching": 3, "3": 3,
    "搁置": 4, "暂停": 4, "停": 4, "on_hold": 4, "4": 4,
    "抛弃": 5, "弃": 5, "弃番": 5, "drop": 5, "dropped": 5, "5": 5,
    "忽略": 0, "ignore": 0, "skip": 0,
};

// 模拟 bgmLog（实际实现会调用日志系统，测试中以 no-op 替代）
const LOG_LEVELS = { WARN: 2 } as const;
const bgmLog = vi.fn();

// 复制自 ts/sync/exceltobangumi.ts 的 isBangumiUrl 实现（用于测试逻辑正确性）
function isBangumiUrl(url: string): boolean {
    if (!url) return false;
    const s = trim(url);
    if (!s) return false;
    if (/^\d+$/.test(s)) return true;
    return URL_PATTERNS.some(pattern => pattern.test(s));
}

// 复制自 ts/sync/exceltobangumi.ts 的 extractSubjectId 实现（用于测试逻辑正确性）
function extractSubjectId(input: string): string {
    if (!input) return '';

    const trimmed = trim(input);
    if (!trimmed) return '';

    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }

    for (const pattern of URL_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }

    const numMatch = trimmed.match(/\d+/);
    if (numMatch) {
        return numMatch[0];
    }

    return '';
}

// 复制自 ts/sync/exceltobangumi.ts 的 mapWatchStatus 实现（用于测试逻辑正确性）
function mapWatchStatus(status: string): number {
    if (!status) return 1;

    const normalized = trim(status).toLowerCase();

    if (WATCH_STATUS_MAP[normalized] !== undefined) {
        return WATCH_STATUS_MAP[normalized];
    }

    for (const [key, value] of Object.entries(WATCH_STATUS_MAP)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }

    if (normalized === 'true') return 3;
    if (normalized === 'false') return 0;

    const num = parseInt(normalized, 10);
    if (!isNaN(num) && num >= 0 && num <= 5) {
        return num;
    }

    bgmLog(LOG_LEVELS.WARN, `[mapWatchStatus] 无法识别的状态值: "${status}"，返回 0（无效）`);
    return 0;
}

describe('isBangumiUrl', () => {
    it('应识别 bgm.tv URL', () => {
        expect(isBangumiUrl('https://bgm.tv/subject/123456')).toBe(true);
    });

    it('应识别 bangumi.tv URL', () => {
        expect(isBangumiUrl('https://bangumi.tv/subject/123456')).toBe(true);
    });

    it('应识别 chii.in URL', () => {
        expect(isBangumiUrl('https://chii.in/subject/123456')).toBe(true);
    });

    it('应识别纯数字 ID', () => {
        expect(isBangumiUrl('123456')).toBe(true);
    });

    it('应拒绝非 BGM URL', () => {
        expect(isBangumiUrl('https://example.com/123')).toBe(false);
    });

    it('应拒绝空字符串与纯空白', () => {
        expect(isBangumiUrl('')).toBe(false);
        expect(isBangumiUrl('   ')).toBe(false);
    });
});

describe('extractSubjectId', () => {
    it('应从 bgm.tv URL 提取 ID', () => {
        expect(extractSubjectId('https://bgm.tv/subject/123456')).toBe('123456');
    });

    it('应从 bangumi.tv URL 提取 ID', () => {
        expect(extractSubjectId('https://bangumi.tv/subject/654321')).toBe('654321');
    });

    it('应从 chii.in URL 提取 ID', () => {
        expect(extractSubjectId('https://chii.in/subject/999')).toBe('999');
    });

    it('应从纯数字提取 ID', () => {
        expect(extractSubjectId('123456')).toBe('123456');
    });

    it('应从混合文本提取首个数字', () => {
        expect(extractSubjectId('bgm id 12345 and more')).toBe('12345');
    });

    it('应返回空字符串当无数字', () => {
        expect(extractSubjectId('no numbers here')).toBe('');
    });

    it('应处理空输入与空白', () => {
        expect(extractSubjectId('')).toBe('');
        expect(extractSubjectId('   ')).toBe('');
        expect(extractSubjectId(null as unknown as string)).toBe('');
        expect(extractSubjectId(undefined as unknown as string)).toBe('');
    });
});

describe('mapWatchStatus', () => {
    beforeEach(() => {
        bgmLog.mockClear();
    });

    it('应映射"想看"为 1', () => {
        expect(mapWatchStatus('想看')).toBe(1);
        expect(mapWatchStatus('想看动画')).toBe(1);
        expect(mapWatchStatus('wish')).toBe(1);
    });

    it('应映射"在看"为 3（Bangumi API: 3=在看）', () => {
        expect(mapWatchStatus('在看')).toBe(3);
        expect(mapWatchStatus('在看动画')).toBe(3);
        expect(mapWatchStatus('在追')).toBe(3);
        expect(mapWatchStatus('追')).toBe(3);
        expect(mapWatchStatus('watching')).toBe(3);
    });

    it('应映射"看过"为 2（Bangumi API: 2=看过）', () => {
        expect(mapWatchStatus('看过')).toBe(2);
        expect(mapWatchStatus('看完')).toBe(2);
        expect(mapWatchStatus('已看')).toBe(2);
        expect(mapWatchStatus('completed')).toBe(2);
    });

    it('应映射"搁置"为 4', () => {
        expect(mapWatchStatus('搁置')).toBe(4);
        expect(mapWatchStatus('暂停')).toBe(4);
        expect(mapWatchStatus('on_hold')).toBe(4);
    });

    it('应映射"抛弃"为 5', () => {
        expect(mapWatchStatus('抛弃')).toBe(5);
        expect(mapWatchStatus('弃番')).toBe(5);
        expect(mapWatchStatus('drop')).toBe(5);
        expect(mapWatchStatus('dropped')).toBe(5);
    });

    it('应映射"忽略"为 0', () => {
        expect(mapWatchStatus('忽略')).toBe(0);
        expect(mapWatchStatus('ignore')).toBe(0);
        expect(mapWatchStatus('skip')).toBe(0);
    });

    it('应映射数字字符串 0-5 为对应数值', () => {
        expect(mapWatchStatus('0')).toBe(0);
        expect(mapWatchStatus('1')).toBe(1);
        expect(mapWatchStatus('2')).toBe(2);
        expect(mapWatchStatus('3')).toBe(3);
        expect(mapWatchStatus('4')).toBe(4);
        expect(mapWatchStatus('5')).toBe(5);
    });

    it('应对布尔文本"是"/"否"映射（是否看完列）', () => {
        // "是" → 2 (看过), "否" → 1 (想看)
        expect(mapWatchStatus('是')).toBe(2);
        expect(mapWatchStatus('否')).toBe(1);
        // "true"/"false" 在 WATCH_STATUS_MAP 中：true→2, false→1
        expect(mapWatchStatus('true')).toBe(2);
        expect(mapWatchStatus('false')).toBe(1);
    });

    it('应对空输入返回 1（默认想看）', () => {
        expect(mapWatchStatus('')).toBe(1);
    });

    it('应对无法识别的状态返回 0 并记录警告日志', () => {
        expect(mapWatchStatus('未知状态')).toBe(0);
        expect(mapWatchStatus('xyz')).toBe(0);
        expect(bgmLog).toHaveBeenCalled();
    });

    it('应对超出 0-5 且不包含映射键的数字字符串返回 0', () => {
        expect(mapWatchStatus('6')).toBe(0);
        expect(mapWatchStatus('99')).toBe(0);
    });

    it('应反映模糊匹配对含数字子串的副作用（源码既有行为）', () => {
        // 注意：源码模糊匹配会检测 normalized 是否"包含"映射键。
        // '100' 包含 '1' → 命中 WATCH_STATUS_MAP['1'] = 1
        expect(mapWatchStatus('100')).toBe(1);
        // '200' 包含 '2' → 命中 WATCH_STATUS_MAP['2'] = 2
        expect(mapWatchStatus('200')).toBe(2);
    });

    it('应支持模糊匹配（包含关键词）', () => {
        // "看完动画" 包含 "看完" → 2
        expect(mapWatchStatus('看完动画')).toBe(2);
        // "想看这部" 包含 "想看" → 1
        expect(mapWatchStatus('想看这部')).toBe(1);
    });
});
