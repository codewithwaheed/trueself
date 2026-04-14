import { WebSocket } from "ws";
import { prisma } from "@trueself/db";

interface SessionTracker {
  lastHeartbeat: Date;
  disconnectedSince?: Date;
  disconnectAlertSent: boolean;
}

// sessionId -> tracker
const trackers = new Map<string, SessionTracker>();

export function recordHeartbeat(sessionId: string): void {
  const existing = trackers.get(sessionId);
  if (existing) {
    existing.lastHeartbeat = new Date();
  } else {
    trackers.set(sessionId, {
      lastHeartbeat: new Date(),
      disconnectAlertSent: false,
    });
  }
}

type SessionMap = Map<string, { agent?: WebSocket; dashboards: Set<WebSocket> }>;

export function onAgentReconnect(sessionId: string, getSessions: () => SessionMap): void {
  const tracker = trackers.get(sessionId);
  if (tracker?.disconnectedSince) {
    tracker.disconnectedSince = undefined;
    tracker.disconnectAlertSent = false;
    broadcastToSession(
      sessionId,
      {
        type: "agent_status",
        sessionId,
        connected: true,
      },
      getSessions()
    );
  }
  recordHeartbeat(sessionId);
}

export function startWatchdog(getSessions: () => SessionMap): void {
  setInterval(async () => {
    const now = new Date();
    for (const [sessionId, tracker] of trackers.entries()) {
      const gapMs = now.getTime() - tracker.lastHeartbeat.getTime();

      if (gapMs > 10_000 && !tracker.disconnectedSince) {
        // Just disconnected — broadcast immediately
        tracker.disconnectedSince = now;
        tracker.disconnectAlertSent = false;
        broadcastToSession(
          sessionId,
          {
            type: "agent_status",
            sessionId,
            connected: false,
            disconnectedSince: now.toISOString(),
          },
          getSessions()
        );
      }

      if (
        tracker.disconnectedSince &&
        gapMs > 30_000 &&
        !tracker.disconnectAlertSent
      ) {
        // Disconnected for more than 30 seconds — persist and alert
        tracker.disconnectAlertSent = true;
        try {
          await prisma.trustEvent.create({
            data: {
              sessionId,
              type: "agent_disconnected",
              severity: "critical",
              message: "Agent disconnected for more than 30 seconds",
              timestamp: now,
            },
          });
        } catch (err) {
          console.error("[watchdog] Failed to persist disconnect event:", err);
        }
      }
    }
  }, 5_000);
}

function broadcastToSession(
  sessionId: string,
  msg: object,
  sessions: SessionMap
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const payload = JSON.stringify(msg);
  session.dashboards.forEach((d) => {
    if (d.readyState === WebSocket.OPEN) {
      d.send(payload);
    }
  });
}
