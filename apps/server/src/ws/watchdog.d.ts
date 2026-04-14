import { WebSocket } from "ws";
export declare function recordHeartbeat(sessionId: string): void;
type SessionMap = Map<string, {
    agent?: WebSocket;
    dashboards: Set<WebSocket>;
}>;
export declare function onAgentReconnect(sessionId: string, getSessions: () => SessionMap): void;
export declare function startWatchdog(getSessions: () => SessionMap): void;
export {};
//# sourceMappingURL=watchdog.d.ts.map