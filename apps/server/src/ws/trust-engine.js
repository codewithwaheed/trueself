const WEIGHTS = {
    aiProcessDetected: -40,
    suspiciousOverlay: -30,
    screenCountChanged: -15,
    clipboardAiContent: -20,
    agentDisconnected: -25,
};
export function computeTrustScore(factors) {
    let score = 100;
    for (const key of Object.keys(WEIGHTS)) {
        if (factors[key]) {
            score += WEIGHTS[key];
        }
    }
    return Math.max(0, Math.min(100, score));
}
export function heartbeatToFactors(heartbeat, agentDisconnected) {
    return {
        aiProcessDetected: (heartbeat.processes ?? []).some((p) => p.isFlagged),
        suspiciousOverlay: false, // TODO: windows monitor
        screenCountChanged: (heartbeat.screens ?? []).length > 1,
        clipboardAiContent: false, // TODO: clipboard content analysis
        agentDisconnected,
    };
}
//# sourceMappingURL=trust-engine.js.map