class EventBus {
    handlers = new Map();
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event).push(handler);
    }
    off(event, handler) {
        const handlers = this.handlers.get(event);
        if (handlers) {
            this.handlers.set(event, handlers.filter(h => h !== handler));
        }
    }
    emit(event, ...args) {
        const handlers = this.handlers.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(...args));
        }
    }
}
export const bus = new EventBus();
