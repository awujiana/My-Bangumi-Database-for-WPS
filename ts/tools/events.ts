type Handler = (...args: any[]) => void;

class EventBus {
    private handlers = new Map<string, Handler[]>();

    on(event: string, handler: Handler): void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event)!.push(handler);
    }

    off(event: string, handler: Handler): void {
        const handlers = this.handlers.get(event);
        if (handlers) {
            this.handlers.set(event, handlers.filter(h => h !== handler));
        }
    }

    emit(event: string, ...args: any[]): void {
        const handlers = this.handlers.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(...args));
        }
    }
}

export const bus = new EventBus();