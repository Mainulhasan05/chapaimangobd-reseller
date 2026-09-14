# ChapaiMango Reseller

Order management for a mango business that sells through resellers.

The owner runs a catalog and a fulfilment queue. Each reseller gets a branded
public order form to share with their own customers, a wallet showing their exact
position, and a dashboard to price and confirm incoming orders. Money lives in an
append-only ledger, so every taka of movement has a record nobody can edit.

- `docs/PLAN.md` is the design, in full.
- `CONTEXT.md` is the vocabulary. Use these words in code and in conversation.
- `docs/adr/` records the decisions worth not re-arguing.

## Getting it running

MongoDB **must be a replica set**, because the ledger runs in transactions and a
standalone `mongod` cannot. Either use MongoDB Atlas or start a single-node set
locally. `backend/README.md` has the exact commands; the API refuses to boot
against a standalone server rather than failing later, when money moves.

```bash
# API
cd backend
npm install
cp .env.example .env          # fill in the two JWT secrets and MONGODB_URI
npm run seed:owner            # creates the single owner account
npm run seed:demo             # optional catalog, zones and a demo reseller
npm run dev                   # http://localhost:4000

# Web
cd ../frontend
npm install
npm run dev                   # http://localhost:3000
```

Sign in at `/login`. The demo seed prints a reseller login and a shop URL.

## How the money works

The wallet balance is the reseller's net position with the owner. Negative means
they owe. Every order carries a payment mode, fixed when the reseller confirms it.

| | Prepaid | Cash on delivery |
|---|---|---|
| Who collects from the customer | The reseller, before dispatch | The courier, who remits to the owner |
| On confirm | Debit cost price × qty, and debit delivery | The same two debits |
| On delivered | Nothing | Credit the whole amount the courier collected |
| Net effect | Reseller owes cost plus delivery | Reseller ends up with their margin as credit |

Cost price times quantity is what leaves the wallet, never the selling price. A
10 kg order costing 55 with an 80 delivery charge debits 630, whatever the
reseller sold it for. Because cash on delivery accumulates positive balances,
resellers can request a withdrawal, which the owner approves like a deposit.

Three rules the code depends on:

1. **Money is integer poisha, quantity is integer milli-units.** Conversion
   happens only at the API boundary.
2. **Only the ledger service changes a balance**, always inside a transaction,
   and it never edits an existing entry. A correction is a new entry.
3. **No controller compares an order status by hand.** Every transition goes
   through one table that decides what may happen, what the ledger posts and
   whether stock comes back.

## Testing

```bash
cd backend
npm test        # 205 tests in 10 files, against an in-memory replica set
npm run smoke   # boots both real servers and walks the whole flow over HTTP

cd ../frontend
npm run lint
npx tsc --noEmit
npm run build   # needed by the smoke test and the end-to-end journeys
npm run test:e2e
```

`npm test` needs no local MongoDB. It covers the money invariants (the ledger
reconciles against the stored balance, concurrent confirms debit once, a
breached credit limit leaves nothing behind, repricing does not move history,
the ledger refuses to be edited), returns and restock, delivery adjustments,
withdrawals, deactivation, OTP and trusted devices, customer SMS, Telegram,
the outbox and job leases, and cursor paging.

`npm run smoke` is the end-to-end check over the real servers. It starts an
in-memory replica set, the Express API and the built Next app, and never reads
`backend/.env`. Through the Next rewrite it places and tracks a customer order,
registers a reseller with an OTP, confirms, signs the owner in from a new device
with an OTP, previews a customer SMS with no gateway (`available: false`), walks
an order to delivered, raises a delivery charge after confirm, returns a shipped
order with restock, approves a deposit twice and a withdrawal once, reconciles
the ledger, checks the Bengali CSV export and revokes a session. OTP codes are
read from the API log, where a development server without a gateway writes
them. Build the frontend first.

`npm run test:e2e` (frontend) walks the main journeys in a browser at 360×740.

## Configuration

`backend/README.md` has the complete environment reference. What changed with
OTP, customer SMS, Telegram and multi-instance work, in short:

| Variable | Why it matters |
|---|---|
| `OWNER_DEVICE_OTP` | Owner sign-in from an untrusted device needs an SMS code. Default `true`; **must be `true` in production** (boot refuses `false`). |
| `OTP_PEPPER` | Optional secret mixed into stored OTP hashes; falls back to the refresh secret. |
| `AUTOMAS_API_KEY`, `AUTOMAS_SENDER_ID` | The SMS gateway. In production, registration, password reset and new-device owner login cannot work without it. The older `SMS_API_KEY` / `SMS_SENDER_ID` names are still read. |
| `PUBLIC_APP_URL` | Where customers reach the site, for the tracking link in customer SMS. Unset, the link is left out. |
| `TELEGRAM_BOT_TOKEN` | Enables the Telegram channel. `TELEGRAM_BOT_USERNAME` is optional. |
| `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET` | Webhook instead of polling; the secret is required with the URL. |
| `RUN_JOBS` | Runs scheduled jobs and Telegram polling in this process. |
| `SMS_LOW_BALANCE` | Gateway balance, in messages, below which the daily digest warns. |
| `IMGBB_API_KEY` | Public images. KYC and deposit screenshots stay on private R2 (`R2_*`). |
| `COOKIE_SECURE` | Follows `NODE_ENV` when unset; `false` is refused in production. |
| `TRUST_PROXY` | Proxy hops in front of Express. See the deploy checklist. |

The frontend has one variable, `API_ORIGIN`, which Next bakes into the build.

## Deploy checklist

1. **Install exactly what is locked:** `npm ci` in `backend/` and in `frontend/`.
2. **Environment.** Set the backend variables above and in `backend/README.md`,
   with `NODE_ENV=production`. Set `API_ORIGIN` for the frontend **before**
   `npm run build`, because the rewrite is baked in at build time.
3. **Sync indexes, every deploy, before the new release serves traffic:**
   `cd backend && npm run db:sync-indexes`. This is mandatory: production runs
   with `autoIndex` off, and the unique indexes that stop a double ledger post or
   a duplicated order exist only once this has run. On an existing database this
   release also changes indexes, so read these first:
   - **KYC:** a new partial unique index allows one pending submission per
     reseller. It **fails to build if any reseller already has two pending
     submissions**; reject the extras first (`backend/README.md` has the query).
   - **AuditLog:** the old indexes are dropped and replaced with
     `(…, createdAt, _id)` indexes for cursor paging; a large log takes a while.
   - **TelegramLink:** a unique index on `user`, one link per account; it fails
     if an account has two link documents.
   - **Notification:** a new `(user, createdAt, _id)` index for the paged inbox.
4. **`RUN_JOBS=true` on one or more instances.** Each job run takes a MongoDB
   lock and Telegram polling takes a lease, so enabling it everywhere is safe;
   leaving it off everywhere means reconciliation, the digest, the KYC purge and
   Telegram polling never run.
5. **`OWNER_DEVICE_OTP` must be `true`** (or unset) and the SMS gateway
   configured, or the owner cannot sign in from a new device.
6. **`COOKIE_SECURE`:** leave unset or `true`, and serve over HTTPS.
7. **`PUBLIC_APP_URL`:** the public `https://` origin, for customer SMS links.
8. **`TELEGRAM_*`:** a token to enable it. With a webhook, set both
   `TELEGRAM_WEBHOOK_URL` (this API's public base URL) and
   `TELEGRAM_WEBHOOK_SECRET`, and make sure `/api/telegram/webhook/*` reaches the
   API. Without a webhook, one `RUN_JOBS` instance polls.
9. **`TRUST_PROXY` must equal the proxy hops in front of Express,** or rate
   limits either lump every client together or trust a forged address. The
   browser talks to Next, and Next's `/api` rewrite forwards to Express. That
   rewrite **passes `X-Forwarded-For` through unchanged and adds no entry of its
   own** (checked against this Next version), while Express sees the Next server
   as its direct peer. So:
   - Next exposed directly, no proxy in front: `X-Forwarded-For` is whatever the
     client sent, so it cannot be trusted. Leave `TRUST_PROXY=0`; every request
     then shares the Next server's address for rate limiting. Put a proxy in
     front instead.
   - One proxy in front of Next (nginx, Caddy, a load balancer) that appends the
     client address: `TRUST_PROXY=1`.
   - Two, such as Cloudflare in front of nginx in front of Next: `TRUST_PROXY=2`.

   Count the proxies before Next; Next itself adds none. After deploying, check
   that the address in the API's request logs is the client's.
10. **Verify:** `GET /api/health` answers `db: "up"`; signed in as the owner,
    `/api/owner/system/health` lists the integrations you expect;
    `npm run check:storage` passes for R2.

## Layout

```
backend/     Express and Mongoose API, plain JavaScript
frontend/    Next.js 16 App Router, TypeScript, Bengali UI
docs/        the plan and the decision records
```

## Known gaps

- **The SMS gateway is part of sign-in.** OTP covers registration, password
  reset, phone changes and new-device owner login. If Automas is down, those
  wait; the owner's reset of a reseller's password is the fallback for
  resellers (docs/adr/0014).
- **Reseller-paid SMS defaults to off.** The owner's master switch at
  `/owner/sms` governs it; owner-paid SMS (OTP, owner alerts, customer SMS) does
  not depend on it. Every attempt is recorded in `SmsLog` with its payer and the
  gateway's reply, including suppressed ones.
- **Customer SMS only on accept, ship and cancel,** in English (GSM-7) so a
  message bills at the single-segment rate. Other transitions send nothing.
- **Public images on ImgBB cannot be deleted by the app.** Removing a product
  photo leaves its URL reachable. Private files (KYC scans, deposit
  screenshots) never go there: they live in the private R2 bucket behind signed
  URLs, and KYC scans are purged on a schedule (docs/adr/0015, 0016). Without R2,
  KYC and deposit screenshot uploads fail and everything else works.
- **Returns are whole-order,** and only from shipped. Partial returns, item or
  quantity edits by the owner, and courier API integrations are deferred.
- **Web push needs a VAPID keypair** and is best effort regardless: aggressive
  Android battery savers drop it. The in-app inbox is the source of truth.
- **Telegram needs a bot token.** It is the free channel that actually arrives.
- **Shared state is MongoDB only** (docs/adr/0012). Fine for hundreds to low
  thousands of orders a day; Redis is deferred.

# chapaimangobd-reseller
