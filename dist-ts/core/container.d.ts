/**
 * 轻量级 CDI 服务容器
 * @module core/container
 * @description 提供服务注册与解析机制，实现模块间的松耦合。
 *              支持懒加载（工厂函数）和实例绑定，避免初始化顺序问题。
 */
type ServiceKey = string;
type Factory<T = unknown> = () => T;
export declare class ServiceContainer {
    private descriptors;
    register<T>(key: ServiceKey, factory: Factory<T>): void;
    resolve<T>(key: ServiceKey): T;
    has(key: ServiceKey): boolean;
    clear(): void;
}
export declare const container: ServiceContainer;
export declare const SERVICE_KEYS: {
    readonly LOGGER: "logger";
    readonly APP: "app";
    readonly EVENT_BUS: "eventBus";
    readonly STATE: "state";
    readonly DIALOG: "dialog";
    readonly TOKEN: "token";
    readonly CONFIG: "config";
};
export type ServiceKeyName = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS];
export {};
//# sourceMappingURL=container.d.ts.map