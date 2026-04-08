// ============================================
// Types shared between Agent, Web Dashboard, and Server
// ============================================

// Session created by interviewer
export interface InterviewSession {
  id: string;
  companyId: string;
  interviewerId: string;
  candidateEmail: string;
  sessionCode: string;          // 6-digit code candidate enters in agent
  meetingLink: string;           // their Zoom/Meet/Teams link
  scheduledAt: string;
  status: "pending" | "active" | "completed" | "cancelled";
  createdAt: string;
}

// Real-time data the agent sends via WebSocket
export interface AgentHeartbeat {
  sessionId: string;
  timestamp: number;
  screens: ScreenInfo[];
  processes: ProcessInfo[];
  suspiciousWindows: WindowInfo[];
  networkFlags: NetworkFlag[];
  clipboardEvents: ClipboardEvent[];
  trustScore: number;            // 0-100 computed on server
}

export interface ScreenInfo {
  id: number;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  isFlagged: boolean;           // matches known AI tool list
  flagReason?: string;
}

export interface WindowInfo {
  title: string;
  processName: string;
  isTransparent: boolean;
  isTopmost: boolean;
  opacity: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface NetworkFlag {
  destination: string;          // e.g., "api.openai.com"
  port: number;
  protocol: string;
  detectedAt: number;
}

export interface ClipboardEvent {
  type: "paste";
  contentLength: number;        // never store actual content for privacy
  source: string;               // which app was focused
  timestamp: number;
}

// Trust score breakdown shown to interviewer
export interface TrustReport {
  sessionId: string;
  overallScore: number;
  breakdown: {
    screenCount: { score: number; details: string };
    aiTools: { score: number; details: string };
    overlays: { score: number; details: string };
    network: { score: number; details: string };
    clipboard: { score: number; details: string };
  };
  timeline: TrustEvent[];
}

export interface TrustEvent {
  timestamp: number;
  type: "screen_change" | "ai_tool_detected" | "overlay_detected" | 
        "network_flag" | "clipboard_flag" | "focus_lost" | "agent_disconnected";
  severity: "info" | "warning" | "critical";
  message: string;
}

// WebSocket message types
export type WSMessageFromAgent = 
  | { type: "heartbeat"; data: AgentHeartbeat }
  | { type: "alert"; data: TrustEvent }
  | { type: "preflight_result"; data: PreflightResult };

export type WSMessageToAgent = 
  | { type: "session_start"; sessionId: string }
  | { type: "session_end" }
  | { type: "config_update"; config: AgentConfig };

export interface PreflightResult {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    details: string;
  }[];
}

export interface AgentConfig {
  heartbeatIntervalMs: number;   // how often to send data (default 3000)
  flaggedProcesses: string[];    // list of AI tool process names
  flaggedDomains: string[];      // list of AI API domains
  monitorClipboard: boolean;
  monitorNetwork: boolean;
}
