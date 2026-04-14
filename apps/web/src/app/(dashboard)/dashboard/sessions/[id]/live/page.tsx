'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { TrustUpdate, AgentStatusUpdate } from '@trueself/shared-types';

// ---- Types ----

interface SessionAlert {
  type: 'session_alert';
  severity: string;
  message: string;
  timestamp: string;
}

type LiveMessage = TrustUpdate | AgentStatusUpdate | SessionAlert;

interface TrustFactorDisplayItem {
  key: keyof TrustUpdate['factors'];
  label: string;
}

const TRUST_FACTOR_LABELS: TrustFactorDisplayItem[] = [
  { key: 'aiProcessDetected', label: 'AI process detected' },
  { key: 'suspiciousOverlay', label: 'Suspicious overlay' },
  { key: 'screenCountChanged', label: 'Multiple screens' },
  { key: 'clipboardAiContent', label: 'Clipboard AI content' },
  { key: 'agentDisconnected', label: 'Agent disconnected' },
];

// ---- Trust Gauge Component ----

function TrustGauge({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  let strokeColor = '#22c55e';
  let textColor = 'text-green-400';
  if (score < 80) {
    strokeColor = '#f59e0b';
    textColor = 'text-yellow-400';
  }
  if (score < 50) {
    strokeColor = '#ef4444';
    textColor = 'text-red-400';
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-36 h-36">
        <svg
          className="w-full h-full -rotate-90"
          viewBox="0 0 128 128"
        >
          {/* Track */}
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="10"
          />
          {/* Progress */}
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.5s ease' }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold tabular-nums ${textColor}`}>
            {score}
          </span>
          <span className="text-xs text-[var(--text-muted)] mt-0.5">trust</span>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-2">Trust Score</p>
    </div>
  );
}

// ---- Agent Status Component ----

function AgentStatusIndicator({ connected }: { connected: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
        connected
          ? 'bg-green-500/10 border-green-500/25 text-green-400'
          : 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400'
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          connected ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
        }`}
      />
      {connected ? 'Agent Connected' : 'Agent Disconnecting...'}
    </div>
  );
}

// ---- Critical Banner Component ----

function CriticalBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
      <div className="flex items-start gap-2 min-w-0">
        <svg
          className="w-4 h-4 mt-0.5 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{message}</span>
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-red-400/60 hover:text-red-400 transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ---- Event Timeline Component ----

function EventTimeline({ events }: { events: SessionAlert[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-xs text-[var(--text-muted)]">No events yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((e, i) => {
        const severityStyles: Record<string, string> = {
          critical: 'border-l-red-500 bg-red-500/5 text-red-300',
          warning: 'border-l-yellow-500 bg-yellow-500/5 text-yellow-300',
          info: 'border-l-[var(--border)] bg-white/[0.02] text-[var(--text-muted)]',
        };
        const style = severityStyles[e.severity] ?? severityStyles.info;
        const time = new Date(e.timestamp).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        return (
          <div
            key={i}
            className={`flex gap-3 p-2.5 rounded-lg border-l-2 text-xs ${style}`}
          >
            <span
              className="font-mono text-[10px] opacity-60 flex-shrink-0 mt-0.5"
            >
              {time}
            </span>
            <span className="flex-1 min-w-0">{e.message}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Trust Factor Flags ----

function TrustFactorFlags({ factors }: { factors: TrustUpdate['factors'] }) {
  const active = TRUST_FACTOR_LABELS.filter((f) => factors[f.key]);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {active.map((f) => (
        <span
          key={f.key}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-medium"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
          {f.label}
        </span>
      ))}
    </div>
  );
}

// ---- Web Audio Alert ----

function playAlert(ctx: AudioContext): void {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio context may be suspended or unavailable
  }
}

// ---- Main Page ----

const WS_BASE =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_WS_URL
    ? process.env.NEXT_PUBLIC_WS_URL
    : 'ws://localhost:3001';

const MAX_EVENTS = 20;
const MAX_BACKOFF_MS = 30_000;

export default function LiveSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [trustScore, setTrustScore] = useState(100);
  const [trustFactors, setTrustFactors] = useState<TrustUpdate['factors']>({
    aiProcessDetected: false,
    suspiciousOverlay: false,
    screenCountChanged: false,
    clipboardAiContent: false,
    agentDisconnected: false,
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [agentConnected, setAgentConnected] = useState(true);
  const [events, setEvents] = useState<SessionAlert[]>([]);
  const [criticalBanner, setCriticalBanner] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<number>(1_000);
  const unmountedRef = useRef(false);

  const getOrCreateAudioCtx = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }
    return audioCtxRef.current;
  }, []);

  const handleMessage = useCallback(
    (data: string) => {
      let msg: LiveMessage;
      try {
        msg = JSON.parse(data) as LiveMessage;
      } catch {
        return;
      }

      if (msg.type === 'trust_update') {
        const update = msg as TrustUpdate;
        setTrustScore(update.score);
        setTrustFactors(update.factors);
      } else if (msg.type === 'agent_status') {
        const status = msg as AgentStatusUpdate;
        setAgentConnected(status.connected);
      } else if (msg.type === 'session_alert') {
        const alert = msg as SessionAlert;
        setEvents((prev) => [alert, ...prev].slice(0, MAX_EVENTS));
        if (alert.severity === 'critical') {
          setCriticalBanner(alert.message);
          const ctx = getOrCreateAudioCtx();
          if (ctx) playAlert(ctx);
        }
      }
    },
    [getOrCreateAudioCtx]
  );

  const connect = useCallback(() => {
    if (unmountedRef.current || !id) return;

    const wsUrl = `${WS_BASE}?sessionId=${encodeURIComponent(id)}&role=dashboard`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        setWsConnected(true);
        backoffRef.current = 1_000;
      };

      ws.onmessage = (event) => {
        handleMessage(typeof event.data === 'string' ? event.data : '');
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setWsConnected(false);

        const backoff = Math.min(backoffRef.current, MAX_BACKOFF_MS);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        reconnectTimerRef.current = setTimeout(connect, backoff);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket constructor threw — schedule reconnect
      const backoff = Math.min(backoffRef.current, MAX_BACKOFF_MS);
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(connect, backoff);
    }
  }, [id, handleMessage]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [connect]);

  if (!id) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm text-[var(--text-muted)]">Session ID missing.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Session</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1 font-mono">{id}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* WS connection indicator */}
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
              wsConnected
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : 'bg-[var(--border-subtle)]/40 border-[var(--border-subtle)] text-[var(--text-muted)]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                wsConnected ? 'bg-green-400' : 'bg-[var(--text-muted)] animate-pulse'
              }`}
            />
            {wsConnected ? 'Live' : 'Connecting...'}
          </span>
          <button
            onClick={() => router.back()}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-default)]"
          >
            Back
          </button>
        </div>
      </div>

      {/* Critical banner */}
      {criticalBanner && (
        <div className="mb-4">
          <CriticalBanner
            message={criticalBanner}
            onDismiss={() => setCriticalBanner(null)}
          />
        </div>
      )}

      {/* Top row: gauge + agent status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {/* Trust gauge card */}
        <div className="card border border-[var(--border-subtle)] flex items-center justify-center py-6 sm:col-span-1">
          <TrustGauge score={trustScore} />
        </div>

        {/* Agent status + factors */}
        <div className="card border border-[var(--border-subtle)] flex flex-col gap-4 sm:col-span-2">
          <AgentStatusIndicator connected={agentConnected} />

          {/* Trust factor flags */}
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
              Active Flags
            </p>
            <TrustFactorFlags factors={trustFactors} />
            {!Object.values(trustFactors).some(Boolean) && (
              <p className="text-xs text-[var(--text-muted)]">No flags — all clear</p>
            )}
          </div>
        </div>
      </div>

      {/* Event timeline */}
      <div className="card border border-[var(--border-subtle)]">
        <h2
          className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          Event Timeline
        </h2>
        <EventTimeline events={events} />
      </div>
    </div>
  );
}
