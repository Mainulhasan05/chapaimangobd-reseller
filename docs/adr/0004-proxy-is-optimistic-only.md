# 4. proxy.ts is an optimistic gate, never the authorization boundary

Status: accepted

## Context
Next.js 16 deprecated `middleware.ts` and renamed the convention to `proxy.ts`, which runs
only on the Node runtime. CVE-2025-29927 showed that a middleware-only auth gate can be
bypassed with a crafted header.

## Decision
`proxy.ts` reads the session cookie and redirects unauthenticated or wrong-role traffic.
That is a user-experience improvement and nothing more. Every authorization decision is
re-made in Express, next to the data, on every request. No header injected by the proxy is
ever trusted.

## Consequences
Next's own auth guide asks for exactly this. A proxy matcher that excludes a path also
skips Server Function calls on that path, which is another reason the proxy cannot be the
boundary.
