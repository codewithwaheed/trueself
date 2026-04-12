import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { prisma } from "@trueself/db";
import authRoutes from "./routes/auth";
import sessionsRoutes from "./routes/sessions";
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
// ---- Sessions Routes (authenticated) ----
app.route("/api/sessions", sessionsRoutes);
// Agent: look up session by code (unauthenticated — agent uses this before auth)
app.get("/api/sessions/code/:code", async (c) => {
    const session = await prisma.interviewSession.findUnique({
        where: { sessionCode: c.req.param("code") },
    });
    if (!session)
        return c.json({ error: "Not found" }, 404);
    return c.json(session);
});
// Agent/dashboard: get session details + events (unauthenticated for now — agent uses this)
app.get("/api/sessions/:id", async (c) => {
    const session = await prisma.interviewSession.findUnique({
        where: { id: c.req.param("id") },
        include: { trustEvents: { orderBy: { timestamp: "asc" } } },
    });
    if (!session)
        return c.json({ error: "Not found" }, 404);
    return c.json(session);
});
// ---- WebSocket for real-time agent <-> dashboard ----
const server = createServer();
const wss = new WebSocketServer({ server });
// Track connections: sessionId -> { agent: ws, dashboards: ws[] }
const sessions = new Map();
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
        session.agent = ws;
        // Notify dashboards that agent connected
        session.dashboards.forEach((d) => d.send(JSON.stringify({ type: "agent_status", connected: true })));
    }
    else {
        session.dashboards.add(ws);
    }
    ws.on("message", async (raw) => {
        const msg = JSON.parse(raw.toString());
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
            session.dashboards.forEach((d) => d.send(JSON.stringify({ type: "agent_status", connected: false })));
        }
        else {
            session.dashboards.delete(ws);
        }
    });
});
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