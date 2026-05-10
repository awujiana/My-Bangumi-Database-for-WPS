type Handler = (...args: any[]) => void;
declare class EventBus {
    private handlers;
    on(event: string, handler: Handler): void;
    off(event: string, handler: Handler): void;
    emit(event: string, ...args: any[]): void;
}
export declare const bus: EventBus;
export {};
//# sourceMappingURL=events.d.ts.map