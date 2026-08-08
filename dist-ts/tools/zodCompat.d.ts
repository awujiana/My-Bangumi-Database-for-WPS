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
type ZodLikeParseResult<T> = {
    success: true;
    data: T;
} | {
    success: false;
    error: {
        issues: Array<{
            message: string;
        }>;
    };
};
/** ZodSchema：项目里用的最小 API（optional/default/safeParse + z.infer） */
export interface ZodSchema<T> {
    optional(): ZodSchema<T | undefined>;
    default<D>(d: D): ZodSchema<T extends undefined ? D : T | D>;
    safeParse(input: unknown): ZodLikeParseResult<T>;
    readonly _output?: T;
    readonly _type?: T;
    /** 仅降级版 schema 需要的内部标记 */
    readonly __isZodLite?: true;
}
declare class SString implements ZodSchema<string> {
    private _minLen;
    private _maxLen;
    readonly __isZodLite: true;
    constructor(_minLen?: number, _maxLen?: number);
    min(n: number): SString;
    max(n: number): SString;
    length(n: number): SString;
    optional(): ZodSchema<string | undefined>;
    default<D>(d: D): ZodSchema<string | D>;
    safeParse(input: unknown): ZodLikeParseResult<string>;
}
declare class SNumber implements ZodSchema<number> {
    readonly __isZodLite: true;
    private _min;
    private _max;
    withBounds(min: number, max: number): SNumber;
    min(n: number): SNumber;
    max(n: number): SNumber;
    optional(): ZodSchema<number | undefined>;
    default<D>(d: D): ZodSchema<number | D>;
    safeParse(input: unknown): ZodLikeParseResult<number>;
}
declare class SBoolean implements ZodSchema<boolean> {
    readonly __isZodLite: true;
    optional(): ZodSchema<boolean | undefined>;
    default<D>(d: D): ZodSchema<boolean | D>;
    safeParse(input: unknown): ZodLikeParseResult<boolean>;
}
declare class SLiteral<V extends string | number | boolean> implements ZodSchema<V> {
    private _val;
    readonly __isZodLite: true;
    constructor(_val: V);
    optional(): ZodSchema<V | undefined>;
    default<D>(d: D): ZodSchema<V | D>;
    safeParse(input: unknown): ZodLikeParseResult<V>;
}
declare class SEnum<V extends string> implements ZodSchema<V> {
    private _vals;
    readonly __isZodLite: true;
    constructor(_vals: readonly string[]);
    optional(): ZodSchema<V | undefined>;
    default<D>(d: D): ZodSchema<V | D>;
    safeParse(input: unknown): ZodLikeParseResult<V>;
}
declare class SArraySchema<T> implements ZodSchema<T[]> {
    private _item;
    readonly __isZodLite: true;
    constructor(_item: ZodSchema<T>);
    optional(): ZodSchema<T[] | undefined>;
    default<D>(d: D): ZodSchema<T[] | D>;
    safeParse(input: unknown): ZodLikeParseResult<T[]>;
}
declare class SObject<T> implements ZodSchema<T> {
    private _shape;
    /** passthrough = 保留未知字段；默认 strip（与 zod 默认一致） */
    private _passthrough;
    readonly __isZodLite: true;
    constructor(_shape: Record<string, ZodSchema<unknown>>, 
    /** passthrough = 保留未知字段；默认 strip（与 zod 默认一致） */
    _passthrough?: boolean);
    passthrough(): SObject<T>;
    strict(): SObject<T>;
    optional(): ZodSchema<T | undefined>;
    default<D>(d: D): ZodSchema<T | D>;
    safeParse(input: unknown): ZodLikeParseResult<T>;
}
interface ZodLite {
    string(): SString;
    number(): SNumber;
    boolean(): SBoolean;
    literal<V extends string | number | boolean>(v: V): SLiteral<V>;
    enum<V extends readonly string[]>(vs: V): SEnum<V[number]>;
    object<Shape extends Record<string, ZodSchema<unknown>>>(shape: Shape): SObject<{
        [K in keyof Shape]: Shape[K] extends ZodSchema<infer U> ? U : never;
    }>;
    array<T>(item: ZodSchema<T>): SArraySchema<T>;
}
export declare const z: ZodLite;
/** z.infer<S> 类型推断：从 schema 的类型参数拿推断结果 */
export type infer<S> = S extends ZodSchema<infer U> ? U : never;
/** 给外部需要 `ZodSchema` 类型参数引用的工具（如 http.ts 的 type import）导一个别名 */
export type { ZodSchema };
//# sourceMappingURL=zodCompat.d.ts.map