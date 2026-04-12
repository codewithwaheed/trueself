---
name: Next.js 16 Turbopack directive requirements
description: Use client/server directives must use specific syntax for Turbopack compatibility in Next.js 16
type: feedback
---

In Next.js 16 with Turbopack, `'use client'` and `'use server'` directives must use single quotes without semicolons: `'use client'` not `"use client";`.

Additionally, inline `'use server'` directives inside `'use client'` component files cause Turbopack build failures. Instead, import server actions from separate `'use server'` files and pass them as form actions.

**Why:** Turbopack's parser is stricter than webpack about directive syntax. The previous code used double quotes with semicolons which Turbopack rejected at build time.

**How to apply:** When creating or modifying client/server component files, always use `'use client'` or `'use server'` (single quotes, no semicolon) as the first line. Never define inline server actions within client components.
