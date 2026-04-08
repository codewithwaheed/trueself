import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import type { AgentHeartbeat, WSMessageFromAgent, TrustEvent } from "@trueself/shared-types";
import { prisma } from "@trueself/db";

const app = new Hono();

app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// ---- REST API Routes ----

// Create interview session
app.post("/api/sessions", async (c) => {
  const body = await c.req.json();
  // TODO: auth middleware, validate with zod
  const session = await prisma.interviewSession.create({
    data: {
      sessionCode: Math.random().toString().slice(2, 8), // 6 digits
      companyId: body.companyId,
      interviewerId: body.interviewerId,
      candidateEmail: body.candidateEmail,
      candidateName: body.candidateName,
      meetingLink: body.meetingLink,
      scheduledAt: new Date(body.scheduledAt),
    },
  });
  return c.json(session);
});

// Get session by code (agent uses this)
app.get("/api/sessions/code/:code", async (c) => {
  const session = await prisma.interviewSession.findUnique({
    where: { sessionCode: c.req.param("code") },
  });
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json(session);
});

// Get session details + events (dashboard uses this)
app.get("/api/sessions/:id", async (c) => {
  const session = await prisma.interviewSession.findUnique({
    where: { id: c.req.param("id") },
    include: { trustEvents: { orderBy: { timestamp: "asc" } } },
  });
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json(session);
});

// ---- WebSocket for real-time agent <-> dashboard ----

const server = createServer();
const wss = new WebSocketServer({ server });

// Track connections: sessionId -> { agent: ws, dashboards: ws[] }
const sessions = new Map<string, { agent?: WebSocket; dashboards: Set<WebSocket> }>();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");
  const role = url.searchParams.get("role"); // "agent" or "dashboard"

  if (!sessionId || !role) {
    ws.close(1008, "Missing sessionId or role");
    return;
  }

  // Initialize session tracking
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { dashboards: new Set() });
  }
  const session = sessions.get(sessionId)!;

  if (role === "agent") {
    session.agent = ws;
    // Notify dashboards that agent connected
    session.dashboards.forEach((d) =>
      d.send(JSON.stringify({ type: "agent_status", connected: true }))
    );
  } else {
    session.dashboards.add(ws);
  }

  ws.on("message", async (raw) => {
    const msg: WSMessageFromAgent = JSON.parse(raw.toString());

    if (role === "agent") {
      // Forward agent data to all dashboard viewers
      session.dashboards.forEach((d) => {
        if (d.readyState === WebSocket.OPEN) {
          d.send(raw.toString());
        }
      });

      // Persist critical events to DB
      if (msg.type === "alert") {
        await prisma.trustEvent.create({
          data: {
            sessionId,
            type: msg.data.type,
            severity: msg.data.severity,
            message: msg.data.message,
            timestamp: new Date(msg.data.timestamp),
          },
        });
      }
    }
  });

  ws.on("close", () => {
    if (role === "agent") {
      session.agent = undefined;
      session.dashboards.forEach((d) =>
        d.send(JSON.stringify({ type: "agent_status", connected: false }))
      );
    } else {
      session.dashboards.delete(ws);
    }
  });
});

// Mount Hono on the HTTP server
server.on("request", (req, res) => {
  // Let Hono handle HTTP, WebSocketServer handles upgrades
  app.fetch(
    new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([, v]) => v !== undefined) as [string, string][]
      ),
    })
  ).then((response) => {
    res.writeHead(response.status, Object.fromEntries(response.headers));
    response.text().then((body) => res.end(body));
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`TrueSelf server running on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}`);
});
