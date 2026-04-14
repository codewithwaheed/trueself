import type { AgentHeartbeat } from "@trueself/shared-types";

export interface TrustFactors {
  aiProcessDetected: boolean;
  suspiciousOverlay: boolean;
  screenCountChanged: boolean;
  clipboardAiContent: boolean;
  agentDisconnected: boolean;
}

const WEIGHTS: Record<keyof TrustFactors, number> = {
  aiProcessDetected: -40,
  suspiciousOverlay: -30,
  screenCountChanged: -15,
  clipboardAiContent: -20,
  agentDisconnected: -25,
};

export function computeTrustScore(factors: TrustFactors): number {
  let score = 100;
  for (const key of Object.keys(WEIGHTS) as (keyof TrustFactors)[]) {
    if (factors[key]) {
      score += WEIGHTS[key];
    }
  }
  return Math.max(0, Math.min(100, score));
}

export function heartbeatToFactors(
  heartbeat: AgentHeartbeat,
  agentDisconnected: boolean
): TrustFactors {
  return {
    aiProcessDetected: (heartbeat.processes ?? []).some((p) => p.isFlagged),
    suspiciousOverlay: false, // TODO: windows monitor
    screenCountChanged: (heartbeat.screens ?? []).length > 1,
    clipboardAiContent: false, // TODO: clipboard content analysis
    agentDisconnected,
  };
}
