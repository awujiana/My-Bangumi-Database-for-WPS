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
export class RingBuffer {
    buffer;
    // 下一个写入位置
    head = 0;
    // 当前元素数
    _size = 0;
    capacity;
    constructor(capacity = 1000) {
        this.capacity = Math.max(1, capacity);
        this.buffer = Array.from({ length: this.capacity });
    }
    /** 写入一个元素 */
    push(item) {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this._size < this.capacity) {
            this._size += 1;
        }
    }
    /** 当前元素数 */
    size() {
        return this._size;
    }
    /** 是否为空 */
    isEmpty() {
        return this._size === 0;
    }
    /** 是否已满 */
    isFull() {
        return this._size === this.capacity;
    }
    /** 获取所有元素（按写入顺序） */
    toArray() {
        if (this._size < this.capacity) {
            return this.buffer.slice(0, this._size);
        }
        // 已满，head 之后是最旧的
        const result = [];
        for (let index = 0; index < this.capacity; index += 1) {
            const index_ = (this.head + index) % this.capacity;
            const item = this.buffer[index_];
            if (item !== undefined) {
                result.push(item);
            }
        }
        return result;
    }
    /** 获取最后 N 个元素 */
    last(n) {
        const all = this.toArray();
        return all.slice(-n);
    }
    /** 清空 */
    clear() {
        this.buffer = Array.from({ length: this.capacity });
        this.head = 0;
        this._size = 0;
    }
}
