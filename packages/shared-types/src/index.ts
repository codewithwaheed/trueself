// ============================================
// Types shared between Agent, Web Dashboard, and Server
// ============================================

// ---- Auth & User Types ----

export type UserRole = "ADMIN" | "INTERVIEWER";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  companyName: string;
  emailVerified: boolean;
  onboardingComplete: boolean;
}

export interface SessionPayload {
  userId: string;
  role: UserRole;
  companyId: string;
  exp: number;
}

// ---- Auth API Request/Response Types ----

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  companyName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface InviteRequest {
  email: string;
  name: string;
}

export interface AcceptInviteRequest {
  token: string;
  name: string;
  password: string;
}

export interface InvitationInfo {
  id: string;
  email: string;
  name: string;
  companyName: string;
  role: UserRole;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

// ---- Agent Session Types ----

// Response from GET /api/sessions/code/:code (used by candidate agent)
export interface AgentSessionInfo {
  id: string;
  sessionCode: string;
  candidateName: string | null;
  interviewerName: string;
  companyName: string;
  scheduledAt: string;
  status: "pending" | "active" | "completed" | "cancelled";
  meetingLink: string;
}

// ---- Interview Session Types ----

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

export interface SessionInvitee {
  id: string;
  name: string;
  email: string;
}

export interface UpdateSessionRequest {
  scheduledAt?: string;  // ISO 8601
  meetingLink?: string;
  inviteeIds?: string[]; // full replacement list; server always re-adds creator
}

// ---- Session API Types ----

export interface CreateSessionRequest {
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string; // ISO 8601
  sendEmail?: boolean;
  inviteeIds?: string[];
}

export interface CreateSessionResponse {
  id: string;
  sessionCode: string;
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string;
  status: "pending" | "active" | "completed" | "cancelled";
  createdAt: string;
  invitees: SessionInvitee[];
}

export interface SessionListItem {
  id: string;
  sessionCode: string;
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string;
  status: "pending" | "active" | "completed" | "cancelled";
  overallScore: number | null;
  createdAt: string;
  invitees: SessionInvitee[];
  interviewerId: string;
}

export interface SessionDetail extends SessionListItem {
  // SessionListItem already includes invitees — no extra fields needed yet
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
  lockdownActive?: boolean;
  sessionElapsedSeconds?: number;
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
  | { type: "preflight_result"; data: PreflightResult }
  | { type: "session_start"; sessionId: string; timestamp: string };

export type WSMessageToAgent =
  | { type: "session_start"; sessionId: string }
  | { type: "session_end" }
  | { type: "config_update"; config: AgentConfig }
  | { type: "lockdown_command"; action: "start" | "stop" }
  | { type: "session_alert"; severity: "info" | "warning" | "critical"; message: string; timestamp: string };

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

// ---- Lockdown Types ----

// Lockdown status returned from Tauri
export interface LockdownStatus {
  phase: "inactive" | "processes_suspended" | "dns_active" | "fully_locked" | "cleaning_up";
  suspendedPids: number[];
  dnsActive: boolean;
  verificationResult?: "pending" | "blocked" | "failed";
}

// Agent session overlay data
export interface SessionOverlayData {
  sessionId: string;
  startedAt: string; // ISO timestamp
  elapsedSeconds: number;
  lockdownActive: boolean;
}

// ---- Server → Dashboard WebSocket Types ----

export interface TrustUpdate {
  type: "trust_update";
  sessionId: string;
  score: number;
  factors: {
    aiProcessDetected: boolean;
    suspiciousOverlay: boolean;
    screenCountChanged: boolean;
    clipboardAiContent: boolean;
    agentDisconnected: boolean;
  };
  timestamp: string;
}

export interface AgentStatusUpdate {
  type: "agent_status";
  sessionId: string;
  connected: boolean;
  disconnectedSince?: string;
}

export type WSMessageToDashboard =
  | TrustUpdate
  | AgentStatusUpdate
  | { type: "session_alert"; severity: string; message: string; timestamp: string };
