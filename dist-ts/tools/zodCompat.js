/**
 * @fileoverview Zod 兼容层
 * @module tools/zodCompat
 * @description 为 wpsjs debug 纯静态模式（浏览器原生 ES module，无打包器、无 importmap）
 *              提供 Zod 的降级兼容：优先使用 `window.z`（若通过 <script src="./libs/zod.umd.js">
 *              或 CDN 预先挂载真正的 zod），缺失时返回结构近似 + 运行时类型断言的
 *              最小 safeParse 实现，保证模块加载不卡死、核心功能不中断。
 *
 *              注意：降级版并非完整 Zod —— safeParse 只做保守校验（字符串最小长度、
 *              对象 shape、枚举、字面量、默认值、optional 等核心行为），链式调用
 *              （int/positive/min/max/url/array/passthrough 等）在降级版仅作为 fluent
 *              接口存在，不在运行时增加额外限制；若需要精确校验请在 index.html 预加载
 *              真实 zod UMD 到 window.z。
 *
 *              在 Vite 构建环境可通过 importmap 将此文件指向真正的 zod。
 */
// ---------- 辅助工具 ----------
function ok(data) {
    return { success: true, data };
}
function fail(msg) {
    return { success: false, error: { issues: [{ message: msg }] } };
}
/** 包装一个 schema 并在其之上叠加 no-op fluent 调用（int/positive/min/max/url 等），
 *  以便在降级模式下不报错（这些约束仅用真实 zod 才执行）。 */
function withNoopFluent(base) {
    const NOOP_FLUENTS = [
        'int', 'positive', 'negative', 'nonnegative', 'nonpositive',
        'min', 'max', 'gt', 'lt', 'gte', 'lte',
        'length', 'email', 'url', 'uuid', 'cuid', 'regex', 'startsWith', 'endsWith',
        'trim', 'datetime', 'date', 'time', 'ip',
        'array', 'passthrough', 'strip', 'strict',
        'safe', 'brand', 'transform', 'pipe', 'or', 'and', 'refine', 'superRefine',
        'describe', 'catch', 'nullable', 'nullish',
    ];
    const proxy = base;
    for (const fn of NOOP_FLUENTS) {
        if (typeof proxy[fn] !== 'function') {
            proxy[fn] = function () {
                return withNoopFluent(this);
            };
        }
    }
    return proxy;
}
// ---------- 核心实现 ----------
class SString {
    _minLen;
    _maxLen;
    __isZodLite = true;
    constructor(_minLen = 0, _maxLen = Infinity) {
        this._minLen = _minLen;
        this._maxLen = _maxLen;
    }
    min(n) {
        return withNoopFluent(new SString(n, this._maxLen));
    }
    max(n) {
        return withNoopFluent(new SString(this._minLen, n));
    }
    length(n) {
        return withNoopFluent(new SString(n, n));
    }
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input !== 'string')
            return fail('expected string');
        if (input.length < this._minLen)
            return fail('string shorter than min');
        if (input.length > this._maxLen)
            return fail('string longer than max');
        return ok(input);
    }
}
class SNumber {
    __isZodLite = true;
    _min = -Infinity;
    _max = Infinity;
    withBounds(min, max) {
        const n = new SNumber();
        n._min = min;
        n._max = max;
        return withNoopFluent(n);
    }
    min(n) {
        return this.withBounds(Math.max(this._min, n), this._max);
    }
    max(n) {
        return this.withBounds(this._min, Math.min(this._max, n));
    }
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input === 'bigint')
            return fail('unexpected bigint');
        if (typeof input !== 'number' || !Number.isFinite(input))
            return fail('expected finite number');
        if (input < this._min)
            return fail('number below min');
        if (input > this._max)
            return fail('number above max');
        return ok(input);
    }
}
class SBoolean {
    __isZodLite = true;
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input === 'boolean')
            return ok(input);
        return fail('expected boolean');
    }
}
class SLiteral {
    _val;
    __isZodLite = true;
    constructor(_val) {
        this._val = _val;
    }
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (input === this._val)
            return ok(this._val);
        return fail(`expected literal ${String(this._val)}`);
    }
}
class SEnum {
    _vals;
    __isZodLite = true;
    constructor(_vals) {
        this._vals = _vals;
    }
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input !== 'string')
            return fail('enum value must be string');
        if (!this._vals.includes(input))
            return fail(`not in enum: ${input}`);
        return ok(input);
    }
}
class SArraySchema {
    _item;
    __isZodLite = true;
    constructor(_item) {
        this._item = _item;
    }
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (!Array.isArray(input))
            return fail('expected array');
        const out = [];
        for (let i = 0; i < input.length; i++) {
            const r = this._item.safeParse(input[i]);
            if (!r.success)
                return fail(`[${i}]: ${r.error.issues[0]?.message ?? 'invalid'}`);
            out.push(r.data);
        }
        return ok(out);
    }
}
class SObject {
    _shape;
    _passthrough;
    __isZodLite = true;
    constructor(_shape, 
    /** passthrough = 保留未知字段；默认 strip（与 zod 默认一致） */
    _passthrough = false) {
        this._shape = _shape;
        this._passthrough = _passthrough;
    }
    passthrough() {
        return withNoopFluent(new SObject(this._shape, true));
    }
    strict() {
        return withNoopFluent(new SObject(this._shape, false));
    }
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
            return fail('expected object');
        }
        const src = input;
        const out = {};
        // 先 passthrough：若启用，拷贝所有字段（然后覆盖 shape 中对应 key）
        if (this._passthrough) {
            for (const k of Object.keys(src))
                out[k] = src[k];
        }
        // 处理已知 shape
        for (const key of Object.keys(this._shape)) {
            const schema = this._shape[key];
            const has = Object.prototype.hasOwnProperty.call(src, key);
            const rawVal = has ? src[key] : undefined;
            const r = schema.safeParse(rawVal);
            if (!r.success) {
                return fail(`key "${key}": ${r.error.issues[0]?.message ?? 'invalid'}`);
            }
            if (r.data !== undefined || has) {
                out[key] = r.data;
            }
        }
        return ok(out);
    }
}
class SOptional {
    _inner;
    __isZodLite = true;
    constructor(_inner) {
        this._inner = _inner;
    }
    optional() {
        return this;
    }
    nullable() {
        return withNoopFluent(new SNullable(this._inner, true, true));
    }
    nullish() {
        return withNoopFluent(new SNullable(this._inner, true, true));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (input === undefined)
            return ok(undefined);
        return this._inner.safeParse(input);
    }
}
class SNullable {
    _inner;
    _allowNull;
    _allowUndefined;
    __isZodLite = true;
    constructor(_inner, _allowNull = true, _allowUndefined = true) {
        this._inner = _inner;
        this._allowNull = _allowNull;
        this._allowUndefined = _allowUndefined;
    }
    optional() {
        return withNoopFluent(new SNullable(this._inner, this._allowNull, true));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (this._allowUndefined && input === undefined)
            return ok(undefined);
        if (this._allowNull && input === null)
            return ok(null);
        return this._inner.safeParse(input);
    }
}
class SWithDefault {
    _inner;
    _def;
    __isZodLite = true;
    constructor(_inner, _def) {
        this._inner = _inner;
        this._def = _def;
    }
    optional() {
        return withNoopFluent(new SOptional(this));
    }
    default(d) {
        return withNoopFluent(new SWithDefault(this, d));
    }
    safeParse(input) {
        if (input === undefined)
            return ok(this._def);
        const r = this._inner.safeParse(input);
        if (!r.success)
            return fail((r.error.issues[0]?.message ?? 'invalid'));
        return ok(r.data);
    }
}
const LiteZod = {
    string: () => withNoopFluent(new SString()),
    number: () => withNoopFluent(new SNumber()),
    boolean: () => withNoopFluent(new SBoolean()),
    literal: (v) => withNoopFluent(new SLiteral(v)),
    enum: (vs) => withNoopFluent(new SEnum(vs)),
    object: (shape) => withNoopFluent(new SObject(shape)),
    array: (item) => withNoopFluent(new SArraySchema(item)),
};
function resolveZod() {
    const w = globalThis;
    const cand = w.z;
    if (cand &&
        typeof cand === 'object' &&
        typeof cand.string === 'function' &&
        typeof cand.object === 'function') {
        // 真实 zod 也应支持 z.enum/z.literal/z.array/z.number/z.string
        return cand;
    }
    return LiteZod;
}
export const z = resolveZod();
