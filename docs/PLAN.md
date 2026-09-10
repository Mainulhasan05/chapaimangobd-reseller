# ChapaiMango Reseller — Order Management System

> Status: approved, not yet implemented. This document is the reference for the whole build.
> Decisions here came out of a requirements interview and a design review verified against
> the Next.js docs bundled in `frontend/node_modules/next/dist/docs/` and the MongoDB manual.
> Change it deliberately, with an ADR in `docs/adr/`, not by drifting during implementation.

## Context

A mango business in Chapainawabganj sells through a network of resellers. Today that runs on phone calls, WhatsApp and a notebook. The owner cannot see how much each reseller owes, resellers have no way to take orders except manually, and there is no record anyone can audit when a payment is disputed.

This project replaces that with a two-sided system. The owner runs a catalog and a fulfilment queue. Each reseller gets a branded public order form to share with their own customers, a wallet showing their exact position, and a dashboard to confirm and price incoming orders. Money lives in an append-only ledger, so every taka of movement has a record nobody can quietly edit.

Both halves are empty. `backend/` has no `package.json` at all and its two files are zero bytes. `frontend/` is an untouched `create-next-app` on Next.js 16.3.4, React 19.2.8, Tailwind v4, TypeScript strict, App Router, with `@/*` aliased to the project root. Everything below is new code.

---

## The money model

The wallet balance is the reseller's net position with the owner. Negative means they owe. It is stored in integer poisha and moved only by the ledger service.

Every order carries a **payment mode**, chosen per order, snapshotted at creation.

**Prepaid.** The customer pays the reseller directly before dispatch. On confirm the wallet is debited for cost price times quantity, plus the delivery charge, as two separate entries. Nothing else ever posts. The reseller's margin never enters the owner's books.

**Cash on delivery.** The courier collects the full customer payment and remits it to the owner. Confirm posts the identical two debits, so the confirm path is the same for both modes. When the order reaches **delivered**, a credit posts for the selling subtotal plus the delivery charge, the whole amount the courier collected. The net effect is that the reseller's margin lands in their wallet as credit.

Because cash on delivery accumulates positive balances, resellers need a way to take money out. **Withdrawal requests are therefore in scope** as the mirror of deposit requests: reseller requests, owner approves, a debit posts. Without this, reseller money is trapped in the system.

A refused or returned cash-on-delivery order never posts the credit. The cost debit is reversed. Whether the delivery charge is also reversed is an owner setting, defaulting to retained, because the courier was paid regardless.

### Worked example

Product costs 55 taka per kilo. Reseller sells at 62. Customer orders 10 kilos. Delivery charge 80 taka.

| Event | Prepaid | Cash on delivery |
|---|---|---|
| Confirm | cost debit 550, delivery debit 80 | cost debit 550, delivery debit 80 |
| Delivered | nothing | collection credit 700 |
| Net wallet change | minus 630 | plus 70 |

The reseller's 70 taka margin stays outside the system when prepaid, and arrives as wallet credit under cash on delivery.

---

## Settled decisions

Not open for reinterpretation during implementation.

| Area | Decision |
|---|---|
| Wallet debit on confirm | Cost price x qty, plus delivery charge, as two entries |
| Payment mode | Per order, prepaid or cash on delivery |
| Prepaid | Reseller collects from their customer, no further entries |
| Cash on delivery | Credit of sell subtotal plus delivery posts on delivered |
| Withdrawals | In scope, mirrors deposits |
| Debit timing | On reseller confirm |
| Reversals | New entry referencing the original; originals never edited |
| Partial returns | Order level at launch, schema carries line and partial-amount fields |
| Fulfilment | Owner ships direct to the end customer |
| Delivery charge | Owner-defined zones by district, owner can override per order |
| Customer data | Fully visible to the owner |
| Order states | pending, confirmed, accepted, packed, shipped, delivered, cancelled, returned |
| Order shape | Multiple line items |
| Price rules | Floor at owner cost, optional per-product owner maximum |
| Hide price | Stored but omitted from the public API response; prefills at confirm |
| Product rollout | Reseller activates by setting a price |
| KYC gate | Setup allowed while pending; public form inactive and confirm blocked until approved |
| Credit limit | Per reseller, default zero |
| Stock | Explicit `trackStock` flag plus quantity, and an availability toggle |
| Language | Bengali, typed dictionary, no locale routing |
| Backend | Express and Mongoose, JavaScript CommonJS, zod validation |
| Auth | JWT access and refresh in httpOnly cookies, roles owner and reseller |
| Uploads | Cloudflare R2, private bucket, all objects under one `R2_PREFIX`, KYC and deposit images via signed URLs |
| Form branding | Reseller's branding with a small powered-by line |
| Notifications | In-app record always, plus web push, Telegram and SMS |
| SMS | Automas gateway, owner-toggleable, resellers buy credits, built but hidden at launch |
| Manual orders | Reseller can create them, starting at confirmed |
| Reports | Operational counts plus receivables, with CSV export |

Folded in without being asked, because each costs almost nothing:

- Every order line snapshots cost price, sell price, unit and minimum quantity at confirm. Repricing must never move historical orders or their ledger entries.
- A public order status lookup by order code, guarded by the customer's phone number as a second factor.
- An audit log from day one, covering price changes, credit limit changes, KYC decisions, deposit and withdrawal approvals, and cancellations.

---

## Corrections applied from design review

These override the obvious first instinct in each case.

- **`middleware.ts` does not exist in Next 16.** The convention is `proxy.ts`, Node runtime only, and the runtime is not configurable. Next's own auth guide states proxy checks must be optimistic, cookie-only, with real authorization performed next to the data. Every authorization decision is therefore re-made in Express per route; `proxy.ts` only redirects unauthenticated traffic for user experience. A codemod exists: `npx @next/codemod@canary middleware-to-proxy .`
- **Money is integer poisha, quantity is integer milli-units.** Floats drift under repeated `$inc`. Decimal128 forces string conversion on every read. One rounding rule, written once: `lineTotal = Math.round(unitPrice * qtyMilli / 1000)`, order total is the sum of already-rounded lines.
- **`balanceAfter` must come from the same atomic operation as the balance change.** A read-then-write pair produces duplicate `balanceAfter` values under concurrency even inside a transaction.
- **Every ledger entry carries a unique `idempotencyKey`.** This makes double-credit structurally impossible regardless of bugs above it.
- **Transactions require a replica set.** Standalone `mongod` cannot run them.
- **One origin via Next `rewrites()`.** Server Components do not forward cookies to a separate origin and cannot set cookies, and a separate API subdomain forces `SameSite=None`. Proxying `/api/*` through Next makes every cookie first-party and removes CORS entirely.
- **Unlimited stock is a `trackStock: false` flag, not a null quantity.** `$inc` on null errors and null-or-missing filters do not use indexes.
- **Public forms live at `/r/[slug]`.** A root-level `[slug]` shadows every future top-level route.
- **`typedRoutes` is stable but off by default.** Turn it on and run `next typegen`.
- **`shadcn init` rewrites `globals.css`.** Run it before writing any UI, and resolve the resulting conflict between shadcn's `.dark` class strategy and the scaffold's `prefers-color-scheme` media query.

---

## Repository layout

The project root is not a git repository; `frontend/` is its own repo with one commit. Phase 0 consolidates to a single repo at the root.

```
chapaimango-reseller/
├─ docs/
│  ├─ PLAN.md              this file
│  └─ adr/                 decision records
├─ CONTEXT.md              domain vocabulary
├─ backend/
│  ├─ src/
│  │  ├─ server.js  app.js
│  │  ├─ config/           env, db, cloudinary, webpush, sms, telegram
│  │  ├─ models/           one file per collection
│  │  ├─ modules/<name>/   routes.js, controller.js, schema.js
│  │  ├─ services/         ledger, orderService, pricing, stock, notify, outbox
│  │  ├─ channels/         inapp, webpush, sms, telegram adapters
│  │  ├─ middleware/       auth, requireRole, requireKyc, validate, upload, rateLimit, error
│  │  ├─ domain/           orderStateMachine.js
│  │  ├─ utils/            money, quantity, orderCode, slug, dhakaTime, phone, csv
│  │  └─ seed/
│  └─ tests/
└─ frontend/
   ├─ app/
   │  ├─ (auth)/ (owner)/owner/... (reseller)/reseller/...
   │  ├─ r/[slug]/          public order form
   │  └─ track/[code]/      public status lookup
   ├─ components/ui/        shadcn primitives
   ├─ lib/                  api, i18n/bn, format, types
   └─ proxy.ts              optimistic role gate
```

---

## Data model

**User** — `name`, `phoneE164` (unique), `passwordHash`, `role`, `isActive`, `lastLoginAt`. Phone is normalised to E.164 before the uniqueness check; the raw input is never indexed. Exactly one owner, created by seed.

**ResellerProfile** — `user`, `shopName`, `slug`, `logoUrl`, `address`, `kycStatus`, `balancePoisha`, `creditLimitPoisha`, `ledgerSeq`, `smsCredits`, `formActive`, channel preferences.

**KycSubmission** — `reseller`, `documents[]` (`type`, `storageKey`), `status`, `reviewedBy`, `reviewedAt`, `note`. One document per attempt, preserving rejection history. Images live in a **private** R2 bucket and are served only through short-lived signed URLs generated for the owner role, so a stored key is not a usable link. The raw national ID number is never stored.

**Source** — `name`, `address`, `phone`, `note`, `isActive`.

**Product** — `nameBn`, `description`, `images[]`, `unit`, `qtyStepMilli`, `costPricePoisha`, `maxSellPricePoisha`, `minOrderQtyMilli`, `trackStock`, `stockQtyMilli`, `isAvailable`, `source`, `isArchived`, `sortOrder`.

**ResellerProduct** — `reseller`, `product`, `sellPricePoisha`, `hidePrice`, `isListed`, `sortOrder`. Separate collection, never embedded in Product.

**DeliveryZone** — `name`, `districts[]`, `chargePoisha`, `isActive`, `sortOrder`.

**Order** — `orderCode`, `reseller`, `origin`, `paymentMode`, `submissionId`, `businessDate`, `customer`, `items[]`, `deliveryChargePoisha`, `totals`, `status`, `statusHistory[]`, `courier`, timestamps per transition, `cancelReason`, `cancelledBy`.

Each item snapshots `productNameBn`, `unit`, `costPricePoisha`, `minOrderQtyMilli`, alongside the live `qtyMilli` and `sellPricePoisha`. Totals are computed server-side only. The client never sends a price or a total; the public form posts product ids and quantities and nothing more.

**LedgerEntry** — append-only. `reseller`, `seq`, `kind` (`ORDER_COST_DEBIT`, `DELIVERY_DEBIT`, `COD_COLLECTION_CREDIT`, `DEPOSIT_CREDIT`, `WITHDRAWAL_DEBIT`, `SMS_PURCHASE_DEBIT`, `MANUAL_CREDIT`, `MANUAL_DEBIT`, `REVERSAL`), `amountPoisha` (signed), `balanceAfterPoisha`, `idempotencyKey`, `refType`, `refId`, `reversalOf`, `reversedLineItemId`, `note`, `createdBy`. Mongoose pre-hooks on every update and delete operation throw.

**Deposit** — `reseller`, `amountPoisha`, `method`, `senderNumber`, `transactionId`, `screenshot`, `status`, review fields. Sparse unique index on `(method, transactionId)`.

**Withdrawal** — mirrors Deposit: requested amount, payout destination, status, review fields.

**Notification** — `user`, `eventType`, `title`, `body`, `data`, `readAt`. **OutboxMessage** — `eventType`, `user`, `payload`, `channels[]`, `attempts`, `sentAt`, `lastError`. **PushSubscription** — `user`, `endpoint` (unique), `keys`, `userAgent`. **TelegramLink** — `user`, `chatId`, `linkedAt`.

**Setting** — singleton: business name, support phone, default credit limit, aging threshold hours, powered-by text, `features.sms`, `features.telegram`, SMS price per credit, whether a return reverses the delivery charge.

**AuditLog** — `actor`, `action`, `targetType`, `targetId`, `before`, `after`, `at`.

### Indexes to create at model definition

```
orders:           { reseller:1, status:1, createdAt:-1 }
                  { reseller:1, businessDate:1 }
                  { status:1, confirmedAt:1 }              aging report
                  { orderCode:1 } unique
                  { reseller:1, submissionId:1 } unique sparse
                  { 'items.product':1, status:1 }          quantity sold report
                  { 'customer.phoneE164':1 }
ledgerentries:    { reseller:1, seq:1 } unique
                  { reseller:1, createdAt:-1 }
                  { idempotencyKey:1 } unique
                  { refType:1, refId:1 }
resellerprofiles: { slug:1 } unique, { kycStatus:1 }
users:            { phoneE164:1 } unique
resellerproducts: { reseller:1, product:1 } unique
                  { reseller:1, isListed:1 }               public form
deposits:         { status:1, createdAt:-1 }
                  { reseller:1, createdAt:-1 }
                  { method:1, transactionId:1 } unique sparse
withdrawals:      { status:1, createdAt:-1 }, { reseller:1, createdAt:-1 }
pushsubscriptions:{ endpoint:1 } unique, { user:1 }
notifications:    { user:1, readAt:1, createdAt:-1 }
outboxmessages:   { sentAt:1, attempts:1 }
```

`autoIndex` is off in production; `syncIndexes()` runs as an explicit deploy step.

---

## Conventions

**Money.** Integer poisha throughout. `utils/money.js` owns every conversion; no arithmetic on money happens elsewhere. Every money field validates with `Number.isSafeInteger`. The API accepts and returns taka as decimals, converting only at the boundary. `toPoisha` uses `Math.round`, never `Math.trunc`.

**Quantity.** Integer `qtyMilli` (2.5 kg is `2500`). Products with unit `pcs`, `dozen` or `box` require whole units; weight and volume units must be a multiple of the product's `qtyStepMilli`, so nobody orders 2.3333 kg.

**Response envelope.** `{ ok: true, data }` or `{ ok: false, error: { code, message, fields } }`, produced by one error middleware. zod field errors map into `fields`.

**Time.** Stored UTC, displayed and aggregated in Asia/Dhaka. Every order carries a denormalised `businessDate` string computed server-side, so "today's orders" is an index scan. Aggregations use `$dateTrunc` with an explicit timezone. Aging is a wall-clock delta against `confirmedAt`, a different notion from the calendar date, and the two are never mixed. Never call `setHours(0,0,0,0)` on a server date.

**Bengali output.** Two formatters, distinguished by name. One emits Bengali digits for display. One emits Latin digits for anything that will be parsed back: input values, CSV exports, order codes and phone numbers. A Bengali-digit string through `parseFloat` is `NaN`. The dictionary is `as const` with a derived key type, so a missing string is a compile error.

**Slugs.** ASCII lowercase only, `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$`, unique, checked against a reserved-word denylist (`api, admin, owner, r, s, track, login, register, dashboard, _next, static, public, assets, favicon.ico, robots.txt, sitemap.xml, manifest.json, sw.js, well-known`) plus profanity. No Bengali slugs; percent-encoded URLs break link previews in WhatsApp.

**Mongoose.** `strictQuery` on. With plain JavaScript there is no compile-time protection, and a mistyped field in a filter otherwise matches everything.

**Soft delete.** Products, sources, zones and resellers referenced by an order are never hard-deleted. `isArchived` plus partial unique indexes so an archived slug can be reused.

---

## The ledger service

`services/ledger.js` is the only code permitted to change a balance. One write function, which must be called inside a transaction session.

The balance change, the sequence number and the credit-limit check happen in a **single** `findOneAndUpdate` on the reseller profile, using an `$expr` predicate that compares the post-change balance against the negated credit limit. A null result means the limit would be breached. The returned document then supplies both `balanceAfterPoisha` and `seq` for the ledger entry, so they cannot disagree with reality. Putting the credit limit in the predicate rather than reading it into JavaScript also removes a time-of-check-to-time-of-use race with the owner editing the limit mid-flight.

The entry's `idempotencyKey` is deterministic (`order:<id>:cost:v1`, `deposit:<id>:credit:v1`, `reversal:<entryId>:<reason>`), so a retry throws a duplicate-key error which the service catches and resolves to the existing entry.

Unique index on `(reseller, seq)` makes the ledger verifiable: for consecutive entries, `balanceAfter` must equal the previous `balanceAfter` plus the amount.

**Reconciliation.** A nightly job and an owner-triggered button assert that the ledger sum equals the stored balance for every reseller and alert on drift. The receivables report computes from the ledger rather than the stored balance, so it doubles as a permanent check.

**Transactions need a replica set.** Local development uses a single-node replica set started with `--replSet rs0`, initiated to `127.0.0.1` explicitly, with `?replicaSet=rs0&directConnection=true` in the connection string. Tests use `MongoMemoryReplSet` with one member, and the test bootstrap must call `createCollection()` and `syncIndexes()` on every model, because implicit collection creation inside a transaction fails. This belongs at the top of the README; the failure mode appears exactly when the money code runs and the tempting fix is to delete the transaction.

Transactions are also subject to a 60 second lifetime and a 5 millisecond lock-request timeout by default, so a contended wallet document gives up almost immediately. `session.withTransaction()` and its retry loop are mandatory, not optional.

---

## Order state machine

`domain/orderStateMachine.js` exports one transition table. Every status change validates against it, and no controller contains a bare status comparison. Each transition declares:

- which roles may perform it
- which ledger entries it posts, if any
- whether it restores stock

The cases that must be encoded rather than assumed: cancelling from **pending** posts nothing, because nothing was ever debited. Cancelling before packing restores stock; a return after shipping does not, because the mangoes are gone. Delivering a cash-on-delivery order posts the collection credit; delivering a prepaid order posts nothing.

### Confirm flow

One transaction, four operations, nothing else:

1. Claim the order with a status-guarded `findOneAndUpdate` on `{ _id, reseller, status: 'pending' }`. A null result means another tab won; return 409.
2. Validate lines against live product data: quantity meets the minimum and the step, sell price is at or above current cost and at or below any maximum. **The floor is re-checked here, not only when the preset was saved**, because the owner may have raised the cost since.
3. Decrement stock with a conditional `$inc` guarded by sufficient quantity, skipping products where `trackStock` is false.
4. Post the cost debit and the delivery debit through the ledger service.

The transaction callback is re-run automatically on write conflict, so it must be free of side effects. Notifications, uploads, SMS and anything else go to the outbox and are drained after commit.

### Concurrency guards

| Attack | Guard |
|---|---|
| Double-confirm from two tabs | Status-predicate `findOneAndUpdate`, done first in the transaction |
| Double-submit of the public form | Client-generated `submissionId`, sparse unique index, duplicate returns the existing order |
| Double-approve a deposit | Status guard plus the unique ledger idempotency key |
| Stock oversell | Conditional `$inc` guarded by `stockQtyMilli >= qtyMilli` |
| Two confirms on one wallet | Guaranteed write conflict, handled by the `withTransaction` retry loop |
| Duplicate order code | Random eight-character Crockford base32, unique index, retry on duplicate. Never a counter document, which would be a global hot spot |

---

## API surface

Prefixed `/api`, proxied through Next so the browser only ever sees one origin.

**Auth** — register, login, refresh, logout, me. Refresh tokens rotate with reuse detection: a hashed token id, a family id, and reuse revoking the whole family. Rotation is per family so a phone and a laptop coexist. The refresh cookie is scoped to the refresh path only. Logout revokes server-side, not just by clearing the cookie.

**Reseller** — profile and slug; KYC submit and status; catalog list and price upsert; orders list, manual create, confirm, cancel; wallet and ledger history; deposits; withdrawals; SMS credit purchase; notification list and preferences; push subscribe; Telegram link token.

**Owner** — CRUD for sources, products and zones; reseller list, detail, credit limit and active flag; KYC queue with approve and reject; order queue with filters and every lifecycle transition; delivery charge override; deposit and withdrawal queues; manual ledger entry; dashboard, receivables and product-sold reports; CSV exports; settings including feature flags.

**Public, unauthenticated** — shop by slug, order submission, order status by code plus customer phone, zone list. Prices for hidden-price products are **omitted from the response body**, not merely hidden in the UI. Submission carries a client-generated `submissionId` with a sparse unique index, so a retry on a flaky connection returns the existing order rather than creating a second one. Rate limited per IP and per slug, with `trust proxy` set to the exact hop count, a JSON body cap, a cap on line items and quantity per line, and the same limiter on the tracking lookup so it is not an order-code enumeration oracle.

---

## Notifications

`services/notify.js` takes a user and an event type, always writes a Notification record, then enqueues an outbox message naming the channels to attempt. Channel adapters live behind one interface so adding a channel touches no business logic.

- **In-app** is the source of truth. Dashboards poll the pending-orders query and show a badge. Nothing in the business flow may depend on an external channel arriving.
- **Web push** is best effort. VAPID keys are persisted in environment config, since regenerating them silently invalidates every subscription. Permission is requested from a button, never on load. Subscriptions are deleted on a 404 or 410 response, and the `pushsubscriptionchange` service worker event re-registers proactively. On iOS this only works from a home-screen install, so the UI feature-detects and shows install instructions instead of a permission prompt. Xiaomi, Realme, Oppo and Vivo battery savers will drop pushes regardless, which is precisely why in-app is authoritative.
- **Telegram** is the free reliable channel. The reseller links their chat through a bot deep link carrying a one-time token.
- **SMS** uses the Automas gateway.

### Automas SMS contract

Endpoint `https://api.automas.com.bd/smsapiv3`, GET or POST.

| Parameter | Meaning |
|---|---|
| `apikey` | Authentication credential |
| `senderid` | Sender ID from the Automas panel |
| `msisdn` | Recipient, e.g. `01886888816`, comma-separated for bulk |
| `msg` | HTTP-encoded message body |
| `type` | `text` for standard SMS |
| `smsformat` | `8` for Unicode, required for Bengali |
| `scheduledDateTime` | Optional |

Response is `{ "response": [{ "status": 0, "id": 296334, "msisdn": "..." }] }`. Status `0` is success, `103` and `106` are authentication failures, `1000` is insufficient balance. Each needs distinct handling; insufficient balance must alert the owner rather than silently dropping messages. A balance endpoint exists at `https://api.automas.com.bd/` with an `api_key` parameter, returning `{ "response": "xxxx.xx" }`.

**Bengali text is Unicode**, capping a segment at 70 characters against 160 for ASCII, so templates are short and Latin-script where that reads acceptably, to keep cost down.

SMS is **fully implemented but not exposed** at launch. It sits behind the `features.sms` flag in settings, defaulting off, which hides the reseller-facing purchase and preference UI. Resellers buy SMS credits at an owner-set price, which posts a wallet debit and increments a credit counter; sending decrements it. The owner can enable SMS globally and per reseller.

---

## Frontend

Next.js 16 App Router. Route groups separate the audiences, with `r/[slug]` and `track/[code]` public.

**Data fetching splits by audience.** Owner and reseller dashboards are Client Components using TanStack Query against `/api/*`. They are auth-gated, mutation-heavy and need polling and optimistic updates, and Server Components buy nothing there while creating cookie-forwarding problems. Public pages are Server Components, because they need no auth and want fast first paint on a slow connection. Server Actions are not used as a parallel API; the login and logout handlers are the exception, because setting a cookie requires a Route Handler or an action.

Token refresh is a single global query-client error handler that calls refresh once on a 401 and retries, serialised behind one in-flight promise so parallel queries do not each burn a refresh token and trip reuse detection.

**Next 16 specifics that will bite.** `params`, `searchParams`, `cookies()` and `headers()` are Promises and synchronous access is removed, not merely warned about. `revalidateTag` requires a second cache-life argument. `next lint` is gone. Turbopack is the default for build, and a dependency injecting a webpack config fails the build rather than warning. `images.qualities` defaults to `[75]` and `images.domains` is deprecated, so the R2 public host needs `remotePatterns`. Every parallel-route slot requires an explicit `default.js`.

**Phase 0 setup order matters.** Run `shadcn init` before writing any component, since it rewrites `globals.css` wholesale. Then delete the scaffold's `prefers-color-scheme` block so it does not fight shadcn's `.dark` class strategy, remove the `body { font-family: Arial }` rule that currently overrides the font variable, and load a Bengali font with the `bengali` subset, since Bengali conjuncts render broken under system fallbacks on Windows and older Android. Set `typedRoutes: true`, add the R2 public host to `images.remotePatterns`, and add the `/api/*` rewrite.

---

## Build order

**Phase 0 — Foundation.** This plan into `docs/PLAN.md`, `CONTEXT.md` for vocabulary, `docs/adr/` for decisions. Single git repo at the root. Backend package, Express app, replica-set Mongo connection, env config, error middleware, response envelope, zod validation, money and quantity utilities, JWT cookie auth with refresh rotation, User model, owner seed. Frontend: shadcn init, Bengali font, dark-mode decision, `proxy.ts`, API rewrite, query client, login and register, empty shells. *Done when both roles log in and land on their own shell.*

**Phase 1 — Catalog.** Source, Product and DeliveryZone models and owner CRUD, R2 upload, archive rather than delete. *Done when the owner can create a source, a priced product with unit, minimum and stock, and a zone.*

**Phase 2 — Onboarding.** Reseller profile and slug with the reserved-word denylist, KYC submission with authenticated uploads, owner review queue, the `requireKyc` gate. *Done when a reseller can register, submit and be approved.*

**Phase 3 — Pricing.** ResellerProduct, catalog screen, floor and ceiling validation, hide-price, listing toggle. *Done when a reseller prices a product and it becomes listed.*

**Phase 4 — Public form.** Shop page with reseller branding, multi-item submission with district-driven charge and payment mode, `submissionId` idempotency, rate limiting, order code, pending queue, tracking page. *Done when a customer order appears as pending.*

**Phase 5 — Ledger and confirm.** LedgerEntry with append-only enforcement and idempotency keys, the atomic balance operation, credit limit, the state machine, transactional confirm, stock decrement, manual orders, cancel with reversal, reconciliation job. *Done when confirming debits correctly, cancelling reverses, and the reconciliation check passes on a randomised sequence.*

**Phase 6 — Deposits and withdrawals.** Both request flows with owner approval and ledger posting. *Done when an approved deposit raises a balance and an approved withdrawal lowers it.*

**Phase 7 — Fulfilment.** Owner queue and the accept, pack, ship, deliver, cancel and return transitions with courier fields, charge override, and the cash-on-delivery collection credit on delivered. *Done when both payment modes settle correctly end to end.*

**Phase 8 — Monitoring and channels.** Outbox, notification records, web push, Telegram bot, the complete SMS integration behind its flag, SMS credit purchase, dashboard metrics, receivables, aging alert, streaming CSV exports with a byte-order mark, audit log. *Done when the owner dashboard answers who owes what and what is going stale.*

---

## Verification

**Automated**, using the Node test runner, supertest and `MongoMemoryReplSet` so transactions genuinely run. The money invariants are the tests that matter:

- Ledger sum equals stored balance after a randomised sequence of confirms, cancels, deposits and withdrawals.
- `balanceAfter` is consistent across every consecutive pair of entries, and `seq` has no gaps.
- Two concurrent confirms of one order produce exactly one debit pair.
- A confirm breaching the credit limit leaves no ledger entry and no stock change.
- Approving one deposit twice credits once, proven by the idempotency key rather than the status guard.
- A cash-on-delivery order reaching delivered leaves the reseller's net position up by exactly the margin.
- A returned cash-on-delivery order posts no collection credit and reverses the cost debit only.
- Repricing a product changes no existing order total and no ledger entry.
- Double form submission with the same `submissionId` yields one order.

**Manual end to end**, run after Phase 5 and again after Phase 8:

1. Owner creates a source, a product at 55 taka per kilo with a 5 kilo minimum, and a zone.
2. Reseller registers, submits KYC, owner approves.
3. Reseller prices at 60 and lists it.
4. In a private window, open the reseller's public URL and place a 10 kilo prepaid order.
5. Confirm it at 62. The wallet drops by 550 plus delivery, not 620.
6. Place a second order as cash on delivery, walk it to delivered, and check the credit lands and the net position rose by the margin.
7. Attempt a confirm past the credit limit and confirm it is blocked.
8. Submit a deposit, approve it, then request a withdrawal and approve it.
9. Cancel one order and a different one after shipping, and inspect both reversals.
10. Check receivables against the ledger, and open the CSV export to confirm Bengali text survives.

**Easy to forget.** Tracking lookup needs the customer phone. Date boundaries at midnight Dhaka time. A colliding slug and a slug matching a reserved route. Bengali digits must not appear in any input field or export. CSV needs a byte-order mark or Excel renders Bengali as mojibake, and long numbers need quoting or Excel mangles them.

---

## Risks

- **Replica set requirement** breaks local setup on day one if undocumented.
- **National ID images** are the largest compliance exposure. A private R2 bucket, signed short-lived URLs, owner-only access, and a retention job that actually deletes after a defined period. The bucket must never be made public.
- **Cash on delivery introduces a payout obligation.** Withdrawals must ship alongside it, not later, or reseller money is trapped.
- **The owner sees every reseller's customer list.** Unavoidable when the owner ships. Better stated in the reseller terms than discovered.
- **The public order endpoint is unauthenticated.** Rate limit per IP and per slug, cap items and quantities, and compute every price server-side.
- **SMS costs real money per message** and Bengali halves the characters per segment. Keep it flagged off until the credit purchase flow has been tested against the live gateway.
- **Perishable stock.** Confirmed orders aging past the threshold are a business risk, not a vanity metric.
