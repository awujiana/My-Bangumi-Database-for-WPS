/**
 * 轻量级 CDI 服务容器
 * @module core/container
 * @description 提供服务注册与解析机制，实现模块间的松耦合。
 *              支持懒加载（工厂函数）和实例绑定，避免初始化顺序问题。
 */
export class ServiceContainer {
    descriptors = new Map();
    register(key, factory) {
        this.descriptors.set(key, { factory });
    }
    resolve(key) {
        const desc = this.descriptors.get(key);
        if (!desc) {
            throw new Error(`[ServiceContainer] Service not found: ${key}`);
        }
        if (desc.instance === undefined) {
            desc.instance = desc.factory();
        }
        return desc.instance;
    }
    has(key) {
        return this.descriptors.has(key);
    }
    clear() {
        this.descriptors.clear();
    }
}
export const container = new ServiceContainer();
export const SERVICE_KEYS = {
    LOGGER: 'logger',
    APP: 'app',
    EVENT_BUS: 'eventBus',
    STATE: 'state',
    DIALOG: 'dialog',
    TOKEN: 'token',
    CONFIG: 'config',
};
