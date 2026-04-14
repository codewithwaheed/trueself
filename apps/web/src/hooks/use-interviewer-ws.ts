'use client'

import { useEffect, useRef } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

interface UseInterviewerWSOptions {
  sessionId: string | null;
  /** Called when a session_status_update message arrives */
  onStatusUpdate?: (payload: { status: string; startedAt?: string; endedAt?: string }) => void;
  /** Called when agent_status message arrives */
  onAgentStatus?: (connected: boolean) => void;
}

function fireNotification(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // Notification API not available in this context — ignore
  }
}

export function useInterviewerWS({ sessionId, onStatusUpdate, onAgentStatus }: UseInterviewerWSOptions) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const url = `${WS_URL}?sessionId=${sessionId}&role=interviewer`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(event.data as string) as typeof msg;
      } catch {
        return;
      }

      switch (msg.type) {
        case "session_status_update": {
          const status = msg.status as string;
          const startedAt = msg.startedAt as string | undefined;
          const endedAt = msg.endedAt as string | undefined;
          onStatusUpdate?.({ status, startedAt, endedAt });
          if (status === "completed") {
            fireNotification("Interview ended", "The session has been marked as completed.");
          }
          break;
        }

        case "agent_status": {
          const connected = msg.connected as boolean;
          onAgentStatus?.(connected);
          if (!connected) {
            fireNotification(
              "Agent disconnected",
              "The candidate's TrueSelf agent has disconnected unexpectedly."
            );
          }
          break;
        }

        case "alert": {
          const data = msg.data as { type?: string; severity?: string; message?: string } | undefined;
          if (data?.severity === "critical") {
            fireNotification(
              "Critical alert",
              data.message ?? "A critical event was detected during the interview."
            );
          }
          break;
        }

        default:
          break;
      }
    };

    ws.onerror = () => {
      // Swallow — reconnect is handled by re-mounting
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);
}
