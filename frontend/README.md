# ChapaiMango web

Next.js 16 App Router, TypeScript, Tailwind v4. Bengali interface.

```bash
npm install
npm run dev     # http://localhost:3000
```

The API must be running. `API_ORIGIN` in `.env.local` says where it is.

## The rewrite is evaluated at build time

`next.config.ts` rewrites `/api/*` to the Express origin, so the browser only
ever talks to one origin and the auth cookies stay first-party `SameSite=Lax`.
There is no CORS configuration anywhere as a result.

The catch: **Next evaluates `rewrites()` during `next build`** and bakes the
result into `.next/routes-manifest.json`. `API_ORIGIN` must therefore be set when
building, not only when starting. Setting it only at boot leaves the built app
pointing at the default and every API call fails with a connection refused that
looks like the API being down.

```bash
API_ORIGIN=https://api.example.com npm run build
```

## Where things live

```
app/(auth)/       login and register
app/(owner)/      the owner panel
app/(reseller)/   the reseller dashboard
app/r/[slug]/     the public order form, server rendered
app/track/        public order status lookup
components/ui/    hand-rolled primitives
lib/i18n/bn.ts    every user-facing string
lib/format.ts     the two number formatters
proxy.ts          the optimistic route gate
```

## Things worth knowing before editing

**Dashboards are client rendered, public pages are server rendered.** The
dashboards are auth gated and mutation heavy, so they use TanStack Query against
`/api/*`. Server Components would buy nothing there and would introduce the
cookie-forwarding problem. The shop and tracking pages are the opposite case: no
auth, and they need to paint fast on a slow connection.

**`proxy.ts` is not the authorization boundary.** It only redirects a visitor
with no session cookie, so a dashboard does not flash before the redirect. It
never decodes a role. Express re-checks everything on every request. Next 16
renamed this convention from `middleware.ts`, and it runs on the Node runtime
only.

**Two number formatters, and mixing them corrupts data.** `formatMoney` emits
Bengali digits and is for display. `formatMoneyPlain` emits Latin digits and is
for anything parsed back: input values, exports, copied text. A Bengali-digit
string through `parseFloat` is `NaN`.

**Every string goes through `t()`.** The dictionary is `as const`, so a typo is a
compile error rather than `undefined` on screen. Adding English later means a
second file, not a restructure.

**Light theme only, deliberately.** This is a business tool used on cheap Android
phones in daylight. Committing to one scheme removes a class of contrast bugs.
The scaffold's `prefers-color-scheme` block and the `.dark` block that
`shadcn init` added were both removed.

**`components/ui/` is hand-written.** Token names follow the shadcn convention so
their components can be added later, but the button and form primitives here are
ours. Running `shadcn add button` would overwrite `button.tsx`; it has happened
once already.
