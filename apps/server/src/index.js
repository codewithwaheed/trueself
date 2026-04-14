import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { prisma } from "@trueself/db";
import authRoutes from "./routes/auth";
import sessionsRoutes from "./routes/sessions";
import { recordHeartbeat, startWatchdog, onAgentReconnect } from "./ws/watchdog";
import { computeTrustScore, heartbeatToFactors } from "./ws/trust-engine";
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
    if (!session)
        return c.json({ error: "Session not found. Please check your code and try again." }, 404);
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
    if (!session)
        return c.json({ error: "Not found" }, 404);
    return c.json(session);
});
// ---- Sessions Routes (authenticated) ----
app.route("/api/sessions", sessionsRoutes);
// ---- WebSocket for real-time agent <-> dashboard ----
const server = createServer();
const wss = new WebSocketServer({ server });
// Track connections: sessionId -> { agent: ws, dashboards: ws[] }
const sessions = new Map();
// Track which agents were previously connected (for reconnect detection)
const agentEverConnected = new Set();
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
    const session = sessions.get(sessionId);
    if (role === "agent") {
        const wasConnected = agentEverConnected.has(sessionId);
        session.agent = ws;
        agentEverConnected.add(sessionId);
        if (wasConnected) {
            // Reconnect: clear watchdog disconnect state and notify dashboards
            onAgentReconnect(sessionId, () => sessions);
        }
        else {
            // First connection
            recordHeartbeat(sessionId);
            session.dashboards.forEach((d) => d.send(JSON.stringify({ type: "agent_status", sessionId, connected: true })));
        }
    }
    else {
        session.dashboards.add(ws);
    }
    ws.on("message", async (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        }
        catch {
            return;
        }
        if (role === "agent") {
            // Forward raw agent data to dashboards (backwards compat)
            session.dashboards.forEach((d) => {
                if (d.readyState === WebSocket.OPEN) {
                    d.send(raw.toString());
                }
            });
            if (msg.type === "heartbeat") {
                const heartbeat = msg.data;
                // Record heartbeat time for watchdog
                recordHeartbeat(sessionId);
                // Compute trust score and broadcast trust_update to dashboards
                const factors = heartbeatToFactors(heartbeat, false);
                const score = computeTrustScore(factors);
                const trustUpdate = {
                    type: "trust_update",
                    sessionId,
                    score,
                    factors,
                    timestamp: new Date().toISOString(),
                };
                const trustPayload = JSON.stringify(trustUpdate);
                session.dashboards.forEach((d) => {
                    if (d.readyState === WebSocket.OPEN) {
                        d.send(trustPayload);
                    }
                });
            }
            // Persist critical events to DB
            if (msg.type === "alert") {
                const event = msg.data;
                await prisma.trustEvent.create({
                    data: {
                        sessionId,
                        type: event.type,
                        severity: event.severity,
                        message: event.message,
                        timestamp: new Date(event.timestamp),
                    },
                });
            }
        }
    });
    ws.on("close", () => {
        if (role === "agent") {
            session.agent = undefined;
            // Don't immediately broadcast disconnect — watchdog handles the 10s gap check
            // and will send agent_status { connected: false } after the gap threshold.
        }
        else {
            session.dashboards.delete(ws);
        }
    });
});
// Start heartbeat watchdog — checks every 5 seconds for stale agents
startWatchdog(() => sessions);
// Mount Hono on the HTTP server
server.on("request", (req, res) => {
    // Collect body for POST/PATCH/PUT requests
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
        const hasBody = req.method !== "GET" && req.method !== "HEAD" && body && body.length > 0;
        const fetchResponse = app.fetch(new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => v !== undefined)),
            ...(hasBody ? { body } : {}),
        }));
        Promise.resolve(fetchResponse).then((response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            response.arrayBuffer().then((buf) => res.end(Buffer.from(buf)));
        }).catch((err) => {
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
//# sourceMappingURL=index.js.map