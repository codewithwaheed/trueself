# Architecture: Authentication & Authorization System

## Step 1: Product Vision Refinement

**Vision:** TrueSelf needs a role-based authentication system that enables company admins to sign up and create workspaces, invite interviewers to their team, and manage interview sessions -- while candidates join sessions via lightweight session codes without needing accounts. The auth system is the gateway to all platform functionality and must cleanly separate three distinct user experiences (admin, interviewer, candidate) behind a single login flow.

**Primary Users & Jobs-to-be-Done:**
- **Admin** -- Sign up, create a company workspace, invite interviewers, manage team and settings
- **Interviewer** -- Accept invite, log in, create/monitor interview sessions
- **Candidate** -- Join a session via 6-digit code in the desktop agent (no web auth needed)

**User Stories:**

1. *As an Admin, I want to sign up with my company name and email so that I get a workspace where I can manage my hiring integrity program.*
2. *As an Admin, I want to invite interviewers by email so that my team can start using TrueSelf without going through a separate signup flow.*
3. *As an Interviewer, I want to accept an email invitation and set my password so that I can access the dashboard and monitor sessions.*
4. *As an Admin or Interviewer, I want to log in with email and password so that I can access my role-appropriate dashboard.*
5. *As an Admin, I want to see an onboarding wizard after first signup so that I'm guided to invite my first interviewer and optionally create a session.*

**Acceptance Criteria:**
- Admin signup creates both a User (ADMIN role) and a Company in a single transaction
- Passwords are hashed with bcrypt before storage
- Sessions use stateless JWTs stored in httpOnly cookies (Next.js pattern)
- Server API uses JWT Bearer tokens for API auth (separate from cookie-based web auth)
- Invitation flow creates a User record with `INTERVIEWER` role and a pending invitation token
- Middleware protects `/dashboard/*` routes -- redirects unauthenticated users to `/login`
- Role-based routing: admins see team management, interviewers see session management
- Candidates do NOT use web auth -- they authenticate via session code in the agent

**PRD/Flow Gaps Identified:**
- No docs/PRD.md, docs/USER-FLOWS.md, or docs/TECHNICAL.md exist yet -- this architecture doc serves as the source of truth
- The existing Prisma schema has no password field on User -- we add it
- The existing Prisma schema has no invitation/verification model -- we add it
- The server has no auth middleware -- we build it

## Step 2: System Impact Analysis

| Package | Impact | Changes |
|---------|--------|---------|
| `packages/db` | HIGH | Add `passwordHash`, `emailVerified`, `onboardingComplete` to User; add `Invitation` model |
| `packages/shared-types` | HIGH | Add auth types, API request/response types, role enum, session payload |
| `apps/server` | HIGH | Add auth routes (signup, login, verify-email, invitations), JWT middleware, bcrypt hashing |
| `apps/web` | HIGH | Add auth pages (signup, login, verify), middleware, session management, onboarding wizard, role-aware dashboard |
| `apps/agent` | NONE | Agent auth uses session codes, unchanged |

## Step 3: Data Model Design

### Prisma Schema Changes

```prisma
model User {
  id                String       @id @default(cuid())
  email             String       @unique
  name              String
  passwordHash      String?      // null for invited users who haven't set password yet
  role              Role         @default(INTERVIEWER)
  companyId         String
  company           Company      @relation(fields: [companyId], references: [id])
  sessions          InterviewSession[]
  emailVerified     Boolean      @default(false)
  onboardingComplete Boolean     @default(false)
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
}

model Invitation {
  id        String           @id @default(cuid())
  email     String
  token     String           @unique
  companyId String
  company   Company          @relation(fields: [companyId], references: [id])
  role      Role             @default(INTERVIEWER)
  invitedBy String           // userId of inviter
  status    InvitationStatus @default(PENDING)
  expiresAt DateTime
  createdAt DateTime         @default(now())

  @@index([email])
  @@index([token])
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
}
```

### TypeScript Interfaces (shared-types)

```typescript
// Auth types
export type UserRole = "ADMIN" | "INTERVIEWER" | "CANDIDATE";

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

// API request/response types
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
```

## Step 4: API Design

### POST /api/auth/signup
```
Auth: none
Request: { name: string, email: string, password: string, companyName: string }
Response: { user: AuthUser, token: string }
Errors: 400 (validation), 409 (email exists)
```

### POST /api/auth/login
```
Auth: none
Request: { email: string, password: string }
Response: { user: AuthUser, token: string }
Errors: 400 (validation), 401 (invalid credentials)
```

### GET /api/auth/me
```
Auth: required (Bearer token)
Response: { user: AuthUser }
Errors: 401 (not authenticated)
```

### POST /api/auth/invitations
```
Auth: required (ADMIN only)
Request: { email: string, name: string }
Response: { invitation: { id, email, token, status } }
Errors: 400 (validation), 403 (not admin), 409 (already invited/exists)
```

### POST /api/auth/invitations/accept
```
Auth: none
Request: { token: string, name: string, password: string }
Response: { user: AuthUser, token: string }
Errors: 400 (validation), 404 (invalid token), 410 (expired)
```

### GET /api/auth/invitations (list for company)
```
Auth: required (ADMIN only)
Response: { invitations: Invitation[] }
Errors: 401, 403
```

### GET /api/team (list team members)
```
Auth: required (ADMIN only)
Response: { members: AuthUser[] }
Errors: 401, 403
```

### PATCH /api/auth/onboarding-complete
```
Auth: required (ADMIN only)
Response: { success: true }
```

## Step 5: WebSocket Protocol

No changes to WebSocket protocol. Auth for WebSocket connections will be added later (session tokens as query params). Current flow uses sessionId which is sufficient for MVP.

## Step 6: Agent Monitor Design

Not applicable -- agent authenticates via session codes, not user accounts.

## Step 7: Trust Score Impact

Not applicable -- auth does not affect trust scoring.

## Step 8: Frontend Architecture

### Page Structure

```
apps/web/src/
  app/
    (auth)/              # Auth group layout (centered, no nav)
      login/page.tsx
      signup/page.tsx
      verify/page.tsx    # Email verification placeholder
      invite/[token]/page.tsx  # Accept invitation
      layout.tsx
    (dashboard)/         # Dashboard group layout (with sidebar nav)
      dashboard/
        page.tsx         # Role-aware home
        team/page.tsx    # Admin: manage interviewers
        sessions/page.tsx # List sessions
        settings/page.tsx # Company settings
      layout.tsx
    layout.tsx           # Root layout
    page.tsx             # Landing -> redirect to dashboard or login
  lib/
    session.ts           # JWT encrypt/decrypt, cookie management
    auth.ts              # getSession() helper for server components
    definitions.ts       # Zod schemas for forms
  actions/
    auth.ts              # Server Actions for signup, login, logout
  components/
    onboarding-wizard.tsx
    sidebar.tsx
    auth-form.tsx        # Shared form styling
  middleware.ts          # Route protection
```

### State Management
- Server components fetch user via `getSession()` (reads JWT cookie)
- No client-side auth state needed -- server components handle auth checks
- Forms use `useActionState` with Server Actions
- Onboarding wizard state tracked via `onboardingComplete` field on User

### Middleware Logic
```
/dashboard/* -> check session cookie, redirect to /login if missing
/login, /signup -> check session cookie, redirect to /dashboard if present
/invite/* -> allow always (public)
```

## Step 9: Implementation Roadmap

| # | Task | Complexity | Description |
|---|------|-----------|-------------|
| 1 | Schema migration | S | Add password, invitation models to Prisma |
| 2 | Shared types | S | Add auth types to shared-types |
| 3 | Server auth routes | L | Signup, login, me, invitations with JWT + bcrypt |
| 4 | Server auth middleware | M | JWT verification middleware for Hono |
| 5 | Web session management | M | JWT cookie encrypt/decrypt with jose |
| 6 | Web server actions | M | Signup, login, logout actions calling server API |
| 7 | Web middleware | S | Route protection middleware |
| 8 | Auth pages (login, signup) | M | Forms with validation and error states |
| 9 | Invitation accept page | M | Token-based invitation acceptance |
| 10 | Dashboard layout + sidebar | M | Role-aware navigation |
| 11 | Dashboard home page | M | Role-specific content |
| 12 | Team management page | M | Admin invite/list interviewers |
| 13 | Onboarding wizard | M | Post-signup guided setup |
| 14 | Integration testing | L | End-to-end auth flow verification |

## Step 10: Risk Register

| Risk | Type | Mitigation |
|------|------|------------|
| JWT secret not set in production | Security | Fail fast if SESSION_SECRET env var missing |
| Password brute force | Security | Add rate limiting to login endpoint (future) |
| Invitation token guessing | Security | Use crypto.randomUUID for tokens, 24h expiry |
| Email verification not implemented | Product | Stub the verify page, mark users as verified on signup for MVP |
| No password reset flow | Product | Out of scope for v1, document as follow-up |
| bcrypt in Edge Runtime | Technical | Use bcrypt only in server actions/API, not middleware |

**Assumptions:**
- Email sending is stubbed for MVP (console.log the invitation link)
- Email verification is auto-approved at signup for MVP
- Candidates do not have web accounts
- Single company per admin (no multi-tenant switching)
- Server and web share the same JWT secret for token verification
