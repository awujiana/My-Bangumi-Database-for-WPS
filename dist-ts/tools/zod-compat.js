/**
 * @fileoverview Zod 兼容层
 * @module tools/zodCompat
 * @description 为 wpsjs debug 纯静态模式（浏览器原生 ES module，无打包器、无 importmap）
 *              提供 Zod 的降级兼容：优先使用 `window.z`（若通过 <script> 预加载真正的 zod），
 *              缺失时返回结构近似 + 运行时类型断言的最小 safeParse 实现，保证模块加载
 *              不卡死、核心功能不中断。
 *
 *              注意：降级版并非完整 Zod —— safeParse 只做保守校验（字符串最小长度、
 *              对象 shape、枚举、字面量、默认值、optional 等核心行为），链式调用
 *              （int/positive/min/max/url/passthrough 等）在降级版仅作为 fluent 接口
 *              存在，不在运行时增加额外限制；若需要精确校验请在 index.html 预加载
 *              真实 zod UMD 到 window.z。
 */
function ok(data) {
    return { success: true, data };
}
function fail(message, path) {
    // exactOptionalPropertyTypes: path 为 undefined 时不能把 undefined 赋值给 ? 属性，
    // 因此只有 path 真正有值时才附加该字段
    const issue = { message };
    if (path !== undefined && path.length > 0)
        issue.path = path;
    return { success: false, error: { issues: [issue] } };
}
// ============================================================
//  No-op Fluent 注入
// ============================================================
const NOOP_FLUENTS = [
    'int',
    'integer',
    'positive',
    'negative',
    'nonnegative',
    'nonpositive',
    'min',
    'max',
    'gt',
    'lt',
    'gte',
    'lte',
    'length',
    'email',
    'url',
    'uuid',
    'cuid',
    'regex',
    'startsWith',
    'endsWith',
    'trim',
    'datetime',
    'date',
    'time',
    'ip',
    'array',
    'passthrough',
    'strip',
    'strict',
    'safe',
    'brand',
    'transform',
    'pipe',
    'or',
    'and',
    'refine',
    'superRefine',
    'describe',
    'catch',
    'nullable',
    'nullish',
    'coerce',
    'finite',
    'nonempty',
    'nonmax',
    'nonmin',
];
/** 在 target 对象的同一实例上挂 noop fluent，返回原实例的精确类型 */
function flu(target) {
    const rec = target;
    for (const function_ of NOOP_FLUENTS) {
        if (typeof rec[function_] !== 'function') {
            rec[function_] = function noopFluent() {
                return flu(target);
            };
        }
    }
    return target;
}
// ============================================================
//  运行时实现（类字段均不加 private，避免 declaration 导出时报 private class 字段错）
// ============================================================
class LiteOptional {
    __isZodLite = true;
    /** @internal */
    _inner;
    constructor(inner) {
        this._inner = inner;
    }
    optional() {
        return this;
    }
    nullable() {
        return flu(new LiteNullable(this._inner, true, true));
    }
    nullish() {
        return flu(new LiteNullable(this._inner, true, true));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (input === undefined)
            return ok(undefined);
        return this._inner.safeParse(input);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteNullable {
    __isZodLite = true;
    /** @internal */
    _inner;
    /** @internal */ _allowNull;
    /** @internal */ _allowUndefined;
    constructor(inner, shouldAllowNull = true, shouldAllowUndefined = true) {
        this._inner = inner;
        this._allowNull = shouldAllowNull;
        this._allowUndefined = shouldAllowUndefined;
    }
    optional() {
        return flu(new LiteNullable(this._inner, this._allowNull, true));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        // 先判断简单条件（纯属性读取，无副作用，交换后短路语义不变）
        if (input === undefined && this._allowUndefined)
            return ok(undefined);
        if (input === null && this._allowNull)
            return ok(null);
        return this._inner.safeParse(input);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteWithDefault {
    __isZodLite = true;
    /** @internal */
    _inner;
    /** @internal */ _definition;
    constructor(inner, definition) {
        this._inner = inner;
        this._definition = definition;
    }
    optional() {
        return flu(new LiteOptional(this));
    }
    default(definition) {
        return flu(new LiteWithDefault(this, definition));
    }
    safeParse(input) {
        if (input === undefined)
            return ok(this._definition);
        const r = this._inner.safeParse(input);
        if (!r.success)
            return fail(r.error.issues[0]?.message ?? 'invalid');
        return r;
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteString {
    __isZodLite = true;
    /** @internal */ _min;
    /** @internal */ _max;
    constructor(min = 0, max = Infinity) {
        this._min = min;
        this._max = max;
    }
    min(n) {
        return flu(new LiteString(n, this._max));
    }
    max(n) {
        return flu(new LiteString(this._min, n));
    }
    length(n) {
        return flu(new LiteString(n, n));
    }
    optional() {
        return flu(new LiteOptional(this));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input !== 'string')
            return fail('expected string');
        if (input.length < this._min)
            return fail('string shorter than min');
        if (input.length > this._max)
            return fail('string longer than max');
        return ok(input);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteNumber {
    __isZodLite = true;
    /** @internal */ _min;
    /** @internal */ _max;
    /** @internal */ _int;
    /** @internal */ _sign;
    constructor(min = -Infinity, max = Infinity, isInt = false, sign) {
        this._min = min;
        this._max = max;
        this._int = isInt;
        this._sign = sign;
    }
    min(n) {
        return flu(new LiteNumber(Math.max(this._min, n), this._max, this._int, this._sign));
    }
    max(n) {
        return flu(new LiteNumber(this._min, Math.min(this._max, n), this._int, this._sign));
    }
    int() {
        return flu(new LiteNumber(this._min, this._max, true, this._sign));
    }
    positive() {
        return flu(new LiteNumber(this._min, this._max, this._int, 'positive'));
    }
    nonnegative() {
        return flu(new LiteNumber(this._min, this._max, this._int, 'nonnegative'));
    }
    negative() {
        return flu(new LiteNumber(this._min, this._max, this._int, 'negative'));
    }
    nonpositive() {
        return flu(new LiteNumber(this._min, this._max, this._int, 'nonpositive'));
    }
    optional() {
        return flu(new LiteOptional(this));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input === 'bigint')
            return fail('unexpected bigint');
        if (typeof input !== 'number' || !Number.isFinite(input))
            return fail('expected finite number');
        if (this._int && !Number.isSafeInteger(input))
            return fail('expected integer');
        if (this._sign === 'positive' && !(input > 0))
            return fail('expected positive number');
        if (this._sign === 'nonnegative' && input < 0)
            return fail('expected nonnegative number');
        if (this._sign === 'negative' && !(input < 0))
            return fail('expected negative number');
        if (this._sign === 'nonpositive' && input > 0)
            return fail('expected nonpositive number');
        if (input < this._min)
            return fail('number below min');
        if (input > this._max)
            return fail('number above max');
        return ok(input);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteBoolean {
    __isZodLite = true;
    optional() {
        return flu(new LiteOptional(this));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input === 'boolean')
            return ok(input);
        return fail('expected boolean');
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteLiteral {
    __isZodLite = true;
    /** @internal */ _value;
    constructor(value) {
        this._value = value;
    }
    optional() {
        return flu(new LiteOptional(this));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (input === this._value)
            return ok(this._value);
        return fail(`expected literal ${String(this._value)}`);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteEnum {
    __isZodLite = true;
    /** @internal */ _values;
    constructor(values) {
        this._values = values;
    }
    optional() {
        return flu(new LiteOptional(this));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input !== 'string')
            return fail('enum value must be string');
        if (!this._values.includes(input))
            return fail(`not in enum: ${input}`);
        return ok(input);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteArray {
    __isZodLite = true;
    /** @internal */
    _item;
    constructor(item) {
        this._item = item;
    }
    optional() {
        return flu(new LiteOptional(this));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (!Array.isArray(input))
            return fail('expected array');
        const out = [];
        for (const [index, item] of input.entries()) {
            const r = this._item.safeParse(item);
            if (!r.success) {
                const issue = r.error.issues[0];
                return fail(`[${String(index)}]: ${issue?.message ?? 'invalid'}`, [
                    index,
                    ...(issue?.path ?? []),
                ]);
            }
            out.push(r.data);
        }
        return ok(out);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
class LiteObject {
    __isZodLite = true;
    /** @internal */
    _shape;
    /** @internal */ _passthrough;
    constructor(shape, shouldPassthrough = false) {
        this._shape = shape;
        this._passthrough = shouldPassthrough;
    }
    passthrough() {
        return flu(new LiteObject(this._shape, true));
    }
    strict() {
        return flu(new LiteObject(this._shape, false));
    }
    optional() {
        return flu(new LiteOptional(this));
    }
    default(d) {
        return flu(new LiteWithDefault(this, d));
    }
    safeParse(input) {
        if (typeof input !== 'object' || input === null || Array.isArray(input))
            return fail('expected object');
        const source = input;
        const out = {};
        if (this._passthrough)
            for (const [k, value] of Object.entries(source))
                out[k] = value;
        for (const [key, schema] of Object.entries(this._shape)) {
            const isHas = Object.hasOwn(source, key);
            const rawValue = isHas ? source[key] : undefined;
            const r = schema.safeParse(rawValue);
            if (!r.success) {
                const issue = r.error.issues[0];
                return fail(`key "${key}": ${issue?.message ?? 'invalid'}`, [
                    key,
                    ...(issue?.path ?? []),
                ]);
            }
            if (isHas || r.data !== undefined)
                out[key] = r.data;
        }
        return ok(out);
    }
    parse(input) {
        const r = this.safeParse(input);
        if (!r.success)
            throw new Error(r.error.issues[0]?.message ?? 'parse failed');
        return r.data;
    }
}
const LiteZodImplementation = {
    string: () => flu(new LiteString()),
    number: () => flu(new LiteNumber()),
    boolean: () => flu(new LiteBoolean()),
    literal: (v) => flu(new LiteLiteral(v)),
    enum: (vs) => flu(new LiteEnum(vs)),
    object: (shape) => flu(new LiteObject(shape)),
    array: (item) => flu(new LiteArray(item)),
};
function resolveZod() {
    const w = globalThis;
    const cand = w.z;
    if (cand &&
        typeof cand === 'object' &&
        typeof cand.string === 'function' &&
        typeof cand.object === 'function') {
        return cand;
    }
    return LiteZodImplementation;
}
export const z = resolveZod();
