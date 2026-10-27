/**
 * @fileoverview 通用环形缓冲区
 * @module tools/logBuffer
 * @description
 *   - 固定容量的 FIFO 环形缓冲区
 *   - 写入超出容量时覆盖最旧元素
 *   - 适用于日志收集、近期事件缓存等场景
 */
/**
 * 通用环形缓冲区
 *
 * @typeParam T - 缓冲元素类型
 */
export declare class RingBuffer<T> {
    private buffer;
    private head;
    private _size;
    private readonly capacity;
    constructor(capacity?: number);
    /** 写入一个元素 */
    push(item: T): void;
    /** 当前元素数 */
    size(): number;
    /** 是否为空 */
    isEmpty(): boolean;
    /** 是否已满 */
    isFull(): boolean;
    /** 获取所有元素（按写入顺序） */
    toArray(): T[];
    /** 获取最后 N 个元素 */
    last(n: number): T[];
    /** 清空 */
    clear(): void;
}
//# sourceMappingURL=log-buffer.d.ts.map