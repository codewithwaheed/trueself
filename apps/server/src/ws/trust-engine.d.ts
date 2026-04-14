import type { AgentHeartbeat } from "@trueself/shared-types";
export interface TrustFactors {
    aiProcessDetected: boolean;
    suspiciousOverlay: boolean;
    screenCountChanged: boolean;
    clipboardAiContent: boolean;
    agentDisconnected: boolean;
}
export declare function computeTrustScore(factors: TrustFactors): number;
export declare function heartbeatToFactors(heartbeat: AgentHeartbeat, agentDisconnected: boolean): TrustFactors;
//# sourceMappingURL=trust-engine.d.ts.map