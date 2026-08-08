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
type _ZodIssue = {
    message: string;
    path?: Array<string | number>;
};
type _ZodLikeParseResult<T> = {
    success: true;
    data: T;
} | {
    success: false;
    error: {
        issues: _ZodIssue[];
    };
};
type ParseResult<T> = _ZodLikeParseResult<T>;
/** schema 链式返回类型：足够松，避免 exactOptionalPropertyTypes 下自引用条件类型爆炸 */
type AnySchema = any;
export interface ZodSchema<T> {
    safeParse(input: unknown): ParseResult<T>;
    parse(input: unknown): T;
    optional(): AnySchema;
    default(d: any): AnySchema;
    readonly _type?: T;
    readonly _output?: T;
    readonly __isZodLite?: true;
    [k: string]: any;
}
declare class LiteString implements ZodSchema<string> {
    [k: string]: any;
    readonly __isZodLite: true;
    /** @internal */ readonly _min: number;
    /** @internal */ readonly _max: number;
    constructor(min?: number, max?: number);
    min(n: number): LiteString;
    max(n: number): LiteString;
    length(n: number): LiteString;
    optional(): ZodSchema<string | undefined>;
    default(d: any): AnySchema;
    safeParse(input: unknown): ParseResult<string>;
    parse(input: unknown): string;
}
declare class LiteNumber implements ZodSchema<number> {
    [k: string]: any;
    readonly __isZodLite: true;
    /** @internal */ readonly _min: number;
    /** @internal */ readonly _max: number;
    constructor(min?: number, max?: number);
    min(n: number): LiteNumber;
    max(n: number): LiteNumber;
    optional(): ZodSchema<number | undefined>;
    default(d: any): AnySchema;
    safeParse(input: unknown): ParseResult<number>;
    parse(input: unknown): number;
}
declare class LiteBoolean implements ZodSchema<boolean> {
    [k: string]: any;
    readonly __isZodLite: true;
    optional(): ZodSchema<boolean | undefined>;
    default(d: any): AnySchema;
    safeParse(input: unknown): ParseResult<boolean>;
    parse(input: unknown): boolean;
}
declare class LiteLiteral<V extends string | number | boolean> implements ZodSchema<V> {
    [k: string]: any;
    readonly __isZodLite: true;
    /** @internal */ readonly _val: V;
    constructor(val: V);
    optional(): ZodSchema<V | undefined>;
    default(d: any): AnySchema;
    safeParse(input: unknown): ParseResult<V>;
    parse(input: unknown): V;
}
declare class LiteEnum<V extends string> implements ZodSchema<V> {
    [k: string]: any;
    readonly __isZodLite: true;
    /** @internal */ readonly _vals: readonly string[];
    constructor(vals: readonly string[]);
    optional(): ZodSchema<V | undefined>;
    default(d: any): AnySchema;
    safeParse(input: unknown): ParseResult<V>;
    parse(input: unknown): V;
}
declare class LiteArray<T = any> implements ZodSchema<T[]> {
    [k: string]: any;
    readonly __isZodLite: true;
    /** @internal */
    readonly _item: ZodSchema<any>;
    constructor(item: ZodSchema<any>);
    optional(): ZodSchema<T[] | undefined>;
    default(d: any): AnySchema;
    safeParse(input: unknown): ParseResult<T[]>;
    parse(input: unknown): T[];
}
declare class LiteObject<T = any> implements ZodSchema<T> {
    [k: string]: any;
    readonly __isZodLite: true;
    /** @internal */
    readonly _shape: Record<string, ZodSchema<any>>;
    /** @internal */ readonly _passthrough: boolean;
    constructor(shape: Record<string, ZodSchema<any>>, passthrough?: boolean);
    passthrough(): LiteObject<T>;
    strict(): LiteObject<T>;
    optional(): ZodSchema<T | undefined>;
    default(d: any): AnySchema;
    safeParse(input: unknown): ParseResult<T>;
    parse(input: unknown): T;
}
interface LiteZod {
    string(): LiteString;
    number(): LiteNumber;
    boolean(): LiteBoolean;
    literal<V extends string | number | boolean>(v: V): LiteLiteral<V>;
    enum<V extends readonly string[]>(vs: V): LiteEnum<V[number]>;
    object<Shape extends Record<string, ZodSchema<any>>>(shape: Shape): LiteObject<{
        [K in keyof Shape]: Shape[K] extends ZodSchema<infer U> ? U : never;
    }>;
    array<T>(item: ZodSchema<T>): LiteArray<T>;
}
export declare const z: LiteZod;
/** z.infer<S>：从 schema 取推断结果 */
export type infer<S> = S extends ZodSchema<infer U> ? U : never;
export {};
//# sourceMappingURL=zodCompat.d.ts.map