# CLAUDE.md — Project Context for Claude Code

## What is TrueSelf?

An anti-AI cheating platform for remote interviews. A lightweight desktop agent (Tauri) runs on the candidate's machine during interviews, monitoring for AI tools, screen overlays, and suspicious activity. The interviewer sees a live trust score dashboard (Next.js) in their browser alongside their normal Zoom/Meet/Teams call.

## Architecture

Monorepo with 3 apps + 2 shared packages:

- `apps/web` — Next.js 14+ dashboard (interviewer + admin)
- `apps/agent` — Tauri 2 desktop agent (candidate installs)
- `apps/server` — Hono API + WebSocket server + PostgreSQL
- `packages/shared-types` — TypeScript interfaces used everywhere
- `packages/db` — Prisma schema and client

## Key Documentation

Read these before implementing features:
- `docs/PRD.md` — Full product requirements with feature specs and acceptance criteria
- `docs/USER-FLOWS.md` — Step-by-step user journeys for all actors
- `docs/TECHNICAL.md` — Architecture, API endpoints, WebSocket protocol, trust scoring algorithm

## Tech Stack

- **Agent:** Tauri 2 (Rust backend + HTML/TS frontend), sysinfo, tokio, tokio-tungstenite
- **Web:** Next.js 14+ App Router, Tailwind CSS, NextAuth.js
- **Server:** Hono, ws (WebSocket), Zod validation
- **DB:** PostgreSQL via Prisma ORM
- **Monorepo:** Turborepo + pnpm workspaces

## Conventions

- All shared types live in `packages/shared-types/src/index.ts` — import as `@trueself/shared-types`
- Database access via `packages/db` — import as `@trueself/db`
- API validation uses Zod schemas
- Server routes are in `apps/server/src/routes/`
- WebSocket logic is in `apps/server/src/ws/`
- Agent monitors are in `apps/agent/src-tauri/src/monitors/`

## Running Locally

```bash
docker compose up -d        # PostgreSQL
pnpm install
pnpm db:push                # Create tables
pnpm dev:server             # API + WebSocket on :3001
pnpm dev:web                # Dashboard on :3000
cd apps/agent && pnpm tauri dev  # Agent
```

## Common Tasks

- Add a new API endpoint: create route in `apps/server/src/routes/`, add types to `packages/shared-types`
- Add a new monitor: create file in `apps/agent/src-tauri/src/monitors/`, add to heartbeat in `heartbeat.rs`
- Add a dashboard page: create in `apps/web/src/app/dashboard/`
- Change DB schema: edit `packages/db/prisma/schema.prisma`, run `pnpm db:migrate`
