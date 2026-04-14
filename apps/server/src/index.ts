import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import type { WSMessageFromAgent, UserEvent } from "@trueself/shared-types";
import { prisma, Prisma } from "@trueself/db";
import authRoutes from "./routes/auth";
import sessionsRoutes from "./routes/sessions";
import { requireAuth } from "./middleware/auth";

const app = new Hono();

app.use("*", cors({
  origin: process.env.WEB_URL || "http://localhost:3000",
  credentials: true,
}));

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// ---- Auth Routes ----
app.route("/api/auth", authRoutes);
// Team route is also on the auth router at /api/auth/team

// ---- REST API Routes ----

// Agent: unauthenticated stubs — must be registered BEFORE the authenticated sessions router
// so they are matched first and bypass the router's requireAuth middleware.
app.get("/api/sessions/code/:code", async (c) => {
  const session = await prisma.interviewSession.findUnique({
    where: { sessionCode: c.req.param("code") },
    include: {
      interviewer: { select: { name: true } },
      company: { select: { name: true } },
    },
  });
  if (!session) return c.json({ error: "Session not found. Please check your code and try again." }, 404);
  if (session.status === "CANCELLED") {
    return c.json({ error: "This session has been cancelled. Contact your interviewer." }, 410);
  }
  if (session.status === "COMPLETED") {
    return c.json({ error: "This session has already ended. Contact your interviewer." }, 410);
  }
  return c.json({
    id: session.id,
    sessionCode: session.sessionCode,
    candidateName: session.candidateName,
    interviewerName: session.interviewer.name,
    companyName: session.company.name,
    scheduledAt: session.scheduledAt.toISOString(),
    status: session.status.toLowerCase(),
    meetingLink: session.meetingLink,
  });
});

app.get("/api/sessions/:id", async (c) => {
  const session = await prisma.interviewSession.findUnique({
    where: { id: c.req.param("id") },
    include: { trustEvents: { orderBy: { timestamp: "asc" } } },
  });
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json(session);
});

// ---- Sessions Routes (authenticated) ----
app.route("/api/sessions", sessionsRoutes);

// ---- WebSocket for real-time agent <-> dashboard ----

const server = createServer();
const wss = new WebSocketServer({ server });

// Track connections: sessionId -> { agent?: ws, dashboards: Set<ws> }
const wsSessions = new Map<string, { agent?: WebSocket; dashboards: Set<WebSocket> }>();

// Helper: send a JSON message to the agent for a given session
function sendToAgent(sessionId: string, payload: object) {
  const entry = wsSessions.get(sessionId);
  if (entry?.agent && entry.agent.readyState === WebSocket.OPEN) {
    entry.agent.send(JSON.stringify(payload));
  }
}

// Helper: broadcast a JSON message to all dashboards watching a session
function broadcastToDashboards(sessionId: string, payload: object) {
  const entry = wsSessions.get(sessionId);
  if (!entry) return;
  const raw = JSON.stringify(payload);
  entry.dashboards.forEach((d) => {
    if (d.readyState === WebSocket.OPEN) d.send(raw);
  });
}

// ---- POST /api/sessions/:id/end (inline — needs access to wsSessions) ----
// Registered before the general sessions router so it matches first.
type AuthVars = { Variables: { userId: string; userRole: string; companyId: string } };
const endSessionRoute = new Hono<AuthVars>();
endSessionRoute.use("*", requireAuth);
endSessionRoute.post("/:id/end", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");
  const userRole = c.get("userRole");
  const companyId = c.get("companyId");

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.companyId !== companyId) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (session.interviewerId !== userId && userRole !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (session.status !== "ACTIVE") {
    return c.json({ error: "Only active sessions can be ended" }, 409);
  }

  const endedAt = new Date();
  const updated = await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", endedAt },
  });

  // Notify agent that session has ended
  sendToAgent(sessionId, { type: "session_end" });

  // Notify dashboards
  broadcastToDashboards(sessionId, {
    type: "session_status_update",
    sessionId,
    status: "completed",
    endedAt: endedAt.toISOString(),
  });

  return c.json({
    id: updated.id,
    status: updated.status.toLowerCase(),
    endedAt: updated.endedAt?.toISOString() ?? null,
  });
});

app.route("/api/sessions", endSessionRoute);

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");
  const role = url.searchParams.get("role"); // "agent" or "dashboard" (or "interviewer")

  if (!sessionId || !role) {
    ws.close(1008, "Missing sessionId or role");
    return;
  }

  // Reject if session is CANCELLED or COMPLETED
  const dbSession = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, startedAt: true },
  });

  if (!dbSession) {
    ws.close(1008, "Session not found");
    return;
  }

  if (dbSession.status === "CANCELLED" || dbSession.status === "COMPLETED") {
    ws.close(1008, `Session is ${dbSession.status.toLowerCase()}`);
    return;
  }

  // Initialize session tracking
  if (!wsSessions.has(sessionId)) {
    wsSessions.set(sessionId, { dashboards: new Set() });
  }
  const wsEntry = wsSessions.get(sessionId)!;

  if (role === "agent") {
    wsEntry.agent = ws;

    // Transition PENDING -> ACTIVE and set startedAt (Task 2)
    if (dbSession.status === "PENDING") {
      const startedAt = new Date();
      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: { status: "ACTIVE", startedAt },
      });

      // Notify any already-connected dashboards
      broadcastToDashboards(sessionId, {
        type: "session_status_update",
        sessionId,
        status: "active",
        startedAt: startedAt.toISOString(),
      });
    }

    // Notify dashboards that agent connected (covers re-connections to already-ACTIVE session)
    broadcastToDashboards(sessionId, { type: "agent_status", connected: true });
  } else {
    // role === "dashboard" or "interviewer"
    wsEntry.dashboards.add(ws);
  }

  ws.on("message", async (raw) => {
    let msg: WSMessageFromAgent;
    try {
      msg = JSON.parse(raw.toString()) as WSMessageFromAgent;
    } catch {
      return; // ignore malformed messages
    }

    if (role === "agent") {
      // Forward agent data to all dashboard viewers
      const rawStr = raw.toString();
      wsEntry.dashboards.forEach((d) => {
        if (d.readyState === WebSocket.OPEN) {
          d.send(rawStr);
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

      // Persist user events from heartbeat (Task 7C)
      if (msg.type === "heartbeat") {
        const events: UserEvent[] = (msg.data as { userEvents?: UserEvent[] }).userEvents ?? [];
        if (events.length > 0) {
          await prisma.sessionEvent.createMany({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: events.map((e) => ({
              sessionId,
              timestamp: new Date(e.timestamp),
              type: e.type as string,
              metadata: (e.metadata ?? null) as Prisma.InputJsonValue | null,
            })) as any,
            skipDuplicates: true,
          });
        }
      }
    }
  });

  ws.on("close", async () => {
    if (role === "agent") {
      wsEntry.agent = undefined;
      broadcastToDashboards(sessionId, { type: "agent_status", connected: false });
    } else {
      wsEntry.dashboards.delete(ws);

      // Task 5: notify agent when interviewer disconnects during an active session
      const current = await prisma.interviewSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      if (current?.status === "ACTIVE") {
        sendToAgent(sessionId, { type: "interviewer_disconnected", sessionId });
      }
    }
  });
});

// Mount Hono on the HTTP server
server.on("request", (req, res) => {
  // Collect body for POST/PATCH/PUT requests
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && body && body.length > 0;

    const fetchResponse = app.fetch(
      new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(([, v]) => v !== undefined) as [string, string][]
        ),
        ...(hasBody ? { body } : {}),
      })
    );

    Promise.resolve(fetchResponse).then((response: Response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      response.arrayBuffer().then((buf: ArrayBuffer) => res.end(Buffer.from(buf)));
    }).catch((err: unknown) => {
      console.error("Request handling error:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`TrueSelf server running on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}`);
});
