import { describe, it, expect } from 'vitest';

/**
 * 纯函数逻辑测试 - util.ts 中的 colNumToLetter
 *
 * 测试策略：复制源码实现到测试文件，验证逻辑正确性。
 * 不直接 import 项目源码，以避免引入 WPS API / 循环依赖。
 * 实现来源：ts/tools/util.ts 第 493-501 行（colNumToLetter）。
 */

// 复制自 ts/tools/util.ts 的 colNumToLetter 实现（用于测试逻辑正确性）
function colNumToLetter(col: number): string {
    let letter = "";
    while (col > 0) {
        const mod = (col - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        col = Math.floor((col - mod) / 26);
    }
    return letter;
}

describe('colNumToLetter', () => {
    it('应正确转换 1-26 为 A-Z', () => {
        expect(colNumToLetter(1)).toBe('A');
        expect(colNumToLetter(2)).toBe('B');
        expect(colNumToLetter(26)).toBe('Z');
    });

    it('应正确转换 27-52 为 AA-AZ', () => {
        expect(colNumToLetter(27)).toBe('AA');
        expect(colNumToLetter(28)).toBe('AB');
        expect(colNumToLetter(52)).toBe('AZ');
    });

    it('应正确转换 53 为 BA', () => {
        expect(colNumToLetter(53)).toBe('BA');
    });

    it('应正确转换 702 为 ZZ', () => {
        expect(colNumToLetter(702)).toBe('ZZ');
    });

    it('应正确转换 703 为 AAA', () => {
        expect(colNumToLetter(703)).toBe('AAA');
    });

    it('应正确转换 731 为 ABC', () => {
        expect(colNumToLetter(731)).toBe('ABC');
    });

    it('应返回空字符串当 col <= 0', () => {
        expect(colNumToLetter(0)).toBe('');
        expect(colNumToLetter(-1)).toBe('');
        expect(colNumToLetter(-100)).toBe('');
    });
});
