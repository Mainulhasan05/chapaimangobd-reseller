# 5. The browser sees one origin

Status: accepted

## Context
The API is a separate Express process. Server Components do not forward cookies to another
origin and cannot set cookies. A separate API subdomain makes browser calls cross-site,
requiring `SameSite=None`, which Safari already restricts.

## Decision
Next rewrites `/api/*` to the Express origin. The browser only ever talks to the Next
origin, so auth cookies are first-party `SameSite=Lax` and there is no CORS configuration.

Dashboards are Client Components using TanStack Query against `/api/*`. Public pages are
Server Components. Server Actions are not a parallel API; login and logout are the
exception, because setting a cookie requires a Route Handler or an action.

## Consequences
One extra hop inside our own infrastructure, in exchange for removing cookie forwarding,
CORS, and the mid-render token rotation problem entirely.
