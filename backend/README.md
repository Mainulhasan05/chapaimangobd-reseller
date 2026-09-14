# ChapaiMango backend

Express and Mongoose API for the reseller order management system.
Design and decisions live in `../docs/PLAN.md`, vocabulary in `../CONTEXT.md`.

## MongoDB must be a replica set

Read this before anything else. The ledger is built on multi-document
transactions, and **a standalone `mongod` cannot run them**. The failure appears
at the exact moment money moves, and the tempting fix at that point is to delete
the transaction. The app refuses to boot against a standalone server instead.

Either point `MONGODB_URI` at MongoDB Atlas, which is already a replica set, or
run a single-node replica set locally:

```bash
mongod --replSet rs0 --dbpath ./data --bind_ip 127.0.0.1
mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
```

The connection string then needs both parameters:

```
MONGODB_URI=mongodb://127.0.0.1:27017/chapaimango?replicaSet=rs0&directConnection=true
```

Without `directConnection=true` the driver tries to resolve the replica set
member by the hostname `rs.initiate()` recorded, which is usually the machine
name and usually does not resolve on Windows.

Tests need none of this: they start an in-memory single-node replica set.

## Running it

```bash
npm install
cp .env.example .env      # then fill in the secrets
npm run seed:owner        # creates the single owner account
npm run seed:demo         # optional: catalog, zones and a demo reseller
npm run dev
```

`npm test` runs the whole suite against an in-memory replica set. No local
MongoDB required.

## Deploying: sync indexes first (mandatory)

Every deploy, **before** the new release starts serving:

```bash
npm run db:sync-indexes
```

Production connects with `autoIndex` off, because building an index on boot
blocks a large collection. The consequence is that nothing else creates them.
Skip this step and the unique indexes that stop a double ledger post or a
duplicated public order simply do not exist, and the duplicates get written.

The script creates any missing collection (a transaction cannot), builds every
index a schema declares, drops indexes no schema declares any more, prints what
changed per model and exits non-zero on failure, so a deploy pipeline stops
there. It is safe to run repeatedly; a second run reports everything up to date.

Before the first deploy of this release on an existing database, know what it
will change:

- **KYC** gains a partial unique index, `one_pending_per_reseller`: at most one
  pending submission per reseller. It **fails to build** if any reseller already
  has two pending submissions. Find them first and reject the older ones:

  ```js
  db.kycsubmissions.aggregate([
    { $match: { status: 'pending' } },
    { $group: { _id: '$reseller', n: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { n: { $gt: 1 } } },
  ])
  ```

- **AuditLog** indexes are replaced by `(…, createdAt, _id)` compound indexes
  for cursor paging. The old ones are dropped and the new ones built, which on a
  large audit log takes a while.
- **TelegramLink** gets a unique index on `user`: one Telegram link per account.
  It fails to build if an account has two link documents; delete the extra.
- **Notification** gets `(user, createdAt, _id)` for the paged inbox.

## Health, shutdown and logs

- `GET /api/health` is public and answers only `{ "ok": true, "db": "up" }`, or
  `503` with `{ "ok": false, "db": "down" }` when the database does not answer a
  ping. Point the load balancer at it.
- `GET /api/owner/system/health` (owner login) additionally reports the
  environment and which integrations are configured.
- `SIGTERM` / `SIGINT` stop accepting connections, stop the outbox worker and
  the job scheduler (waiting for a send or job already in progress), close
  MongoDB and exit, with a 10 second hard limit.
- Logs are one JSON line per event (pino). Every request gets an id, taken from
  an incoming `X-Request-Id` or generated, and echoed back in the `X-Request-Id`
  response header; quote it when reporting a problem. Cookies and the
  `Authorization` header are redacted. `LOG_LEVEL` sets verbosity; tests are
  silent. Pipe through `npx pino-pretty` locally for readable output.

## Environment

Validated at boot by `src/config/env.js`; an invalid value stops the process
with a list of what is wrong. A blank line in `.env` (`KEY=`) counts as unset.
Only `MONGODB_URI` and the two JWT secrets are required to boot, plus
`OWNER_PHONE` / `OWNER_PASSWORD` for the seed. Everything else has a working
default or is an optional integration, and `/api/owner/system/health` (owner
login) reports which integrations are live.

### Reference

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production turns on secure cookies and refuses the unsafe settings listed below. |
| `PORT` | `4000` | Port the API listens on. |
| `APP_URL` | `http://localhost:3000` | The one origin CORS allows outside production, for the Next dev server. Unused in production, where the browser only talks to the Next origin (docs/adr/0005). |
| `MONGODB_URI` | **required** | A replica set. See the top of this file. |
| `JWT_ACCESS_SECRET` | **required** | At least 32 characters. |
| `JWT_REFRESH_SECRET` | **required** | At least 32 characters, and different from the access secret. |
| `ACCESS_TOKEN_TTL` | `15m` | Access token lifetime, in `jsonwebtoken` notation. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime in days. |
| `OTP_PEPPER` | the refresh secret | Mixed into every stored OTP hash. At least 32 characters when set. Changing it voids codes already sent, nothing else. |
| `OWNER_DEVICE_OTP` | `true` | The owner's new-device code (docs/adr/0014). `false` is for local development and tests only; **refused in production**. |
| `COOKIE_SECURE` | follows `NODE_ENV` | Unset means secure in production, plain elsewhere. **`false` is refused in production.** |
| `COOKIE_DOMAIN` | unset | Sets the cookies' `Domain`. Leave unset for a single-origin deployment. |
| `TRUST_PROXY` | `0` | How many proxies in front of the Next server append `X-Forwarded-For`. Next's `/api` rewrite passes the header through and adds no hop of its own. Wrong values lump every client into one rate-limit bucket or trust a forged address; see the deploy checklist in the root `README.md`. |
| `LOG_LEVEL` | `info` | `fatal` `error` `warn` `info` `debug` `trace`. Ignored under `NODE_ENV=test`, which is silent. |
| `RUN_JOBS` | `false` | Runs the scheduled jobs and may hold the Telegram polling lease in this process. Safe on every instance; see below. |
| `SMS_LOW_BALANCE` | `200` | The daily digest warns when the gateway balance falls below this many **messages** (Automas reports a count, not taka). |
| `IMGBB_API_KEY` | unset | Public images (product photos, shop logos, brand assets) go to ImgBB when set. |
| `IMGBB_UPLOAD_URL` | `https://api.imgbb.com/1/upload` | ImgBB upload endpoint. |
| `IMGBB_TIMEOUT_MS` | `20000` | Upload timeout, so a slow host cannot hold a request open. |
| `R2_ACCOUNT_ID` | unset | Cloudflare R2 account. With the next three, enables private storage. |
| `R2_ACCESS_KEY_ID` | unset | R2 API token key id. |
| `R2_SECRET_ACCESS_KEY` | unset | R2 API token secret. |
| `R2_BUCKET` | unset | The **private** bucket: KYC scans and deposit screenshots, signed URLs only. |
| `R2_PREFIX` | `chapaimango` | Every object key starts with this, so a shared bucket stays legible. |
| `R2_PUBLIC_BUCKET` | unset | Legacy fallback for public images when ImgBB is not configured. Must differ from `R2_BUCKET`. |
| `R2_PUBLIC_BASE_URL` | unset | Where the public bucket is served (`r2.dev` or a custom domain), for that fallback. Not the S3 API endpoint. |
| `VAPID_PUBLIC_KEY` | unset | Web push keypair, public half. |
| `VAPID_PRIVATE_KEY` | unset | Web push keypair, private half. |
| `VAPID_SUBJECT` | `mailto:support@example.com` | Contact the push services see. Set a real address. |
| `AUTOMAS_API_KEY` | unset | Automas SMS gateway key. With the sender id, the gateway is configured. |
| `AUTOMAS_SENDER_ID` | unset | Automas sender id. |
| `SMS_API_KEY` | unset | Older name for `AUTOMAS_API_KEY`, still read; the `AUTOMAS_` name wins. |
| `SMS_SENDER_ID` | unset | Older name for `AUTOMAS_SENDER_ID`, still read. |
| `SMS_API_URL` | `https://api.automas.com.bd/smsapiv3` | Gateway send endpoint. |
| `SMS_BALANCE_URL` | `https://api.automas.com.bd/getbalance` | Gateway balance endpoint (lowercase, not under `smsapiv3`). |
| `PUBLIC_APP_URL` | unset | Where customers reach the site. `{trackUrl}` in customer SMS becomes `${PUBLIC_APP_URL}/track?code=<code>`; unset, that clause is left out. |
| `TELEGRAM_BOT_TOKEN` | unset | Enables the Telegram channel and bot. |
| `TELEGRAM_BOT_USERNAME` | from `getMe` | The bot's name without the @, for deep links. |
| `TELEGRAM_WEBHOOK_URL` | unset | This API's public base URL. Set to use a webhook instead of polling. |
| `TELEGRAM_WEBHOOK_SECRET` | unset | 16-256 of `A-Z a-z 0-9 _ -`. **Required when `TELEGRAM_WEBHOOK_URL` is set.** |
| `SKIP_DOTENV` | unset | `true` stops `.env` being read at all, for a process whose environment is already complete. The smoke test sets it. |

Read only by the seed scripts, not validated at boot:

| Variable | Default | What it does |
|---|---|---|
| `OWNER_PHONE` | **required by the seed** | The single owner account's phone. |
| `OWNER_PASSWORD` | **required by the seed** | Its password. |
| `OWNER_NAME` | `Owner` | Its display name. |

Boot refuses these combinations: the two JWT secrets equal; `COOKIE_SECURE=false`
or `OWNER_DEVICE_OTP=false` with `NODE_ENV=production`; `TELEGRAM_WEBHOOK_URL`
without `TELEGRAM_WEBHOOK_SECRET`.

### Integrations

- **Storage is split by who may see a file** (docs/adr/0015).
  - **ImgBB** hosts every public image: product photos, shop logos, brand
    assets. It needs only `IMGBB_API_KEY`. An ImgBB link is readable by anyone
    who has it and cannot be deleted by the app, which is fine for a catalog
    photo and never acceptable for an identity document.
  - **Cloudflare R2**, the private bucket `R2_BUCKET`, holds KYC scans and
    deposit screenshots, reachable only through signed URLs with a ten minute
    expiry. Nothing private ever goes to ImgBB. Without R2, KYC and deposit
    screenshot uploads fail with a clear message and everything else works.
    Scans are deleted on a schedule (docs/adr/0016).
  - Without `IMGBB_API_KEY`, public images fall back to a **separate** public R2
    bucket (`R2_PUBLIC_BUCKET` plus `R2_PUBLIC_BASE_URL`). It must be separate:
    R2 public access is bucket wide, so one bucket cannot hold both. The app
    refuses to start public delivery if the two names match.

  Keys are written under `R2_PREFIX`:

  ```
  chapaimango/kyc/<uuid>.jpg        private bucket, signed URLs only
  chapaimango/deposits/<uuid>.jpg   private bucket, signed URLs only
  chapaimango/products/<uuid>.jpg   public bucket, only when ImgBB is not set
  chapaimango/logos/<uuid>.png      public bucket, only when ImgBB is not set
  ```

  Run `npm run check:storage` to verify R2 end to end. It uploads a throwaway
  object, reads it back through a signed URL, checks it is **not** readable
  without one, and deletes it.

- **Web push** needs a VAPID keypair. Generate once with
  `node -e "console.log(require('web-push').generateVAPIDKeys())"` and keep it.
  Regenerating silently invalidates every existing subscription.
- **SMS** uses the Automas gateway. Who pays decides which switch governs a
  message (docs/adr/0013). Reseller-paid SMS needs the owner's master switch,
  the reseller's own flag and credits, and stays dark until the owner turns it
  on. Owner-paid SMS (OTP codes, owner alerts, customer SMS) bypasses the master
  switch and needs only the gateway. Outside production with no gateway, an OTP
  is written to the log instead of sent; in production a missing gateway makes
  registration, password reset and new-device owner login answer
  `SMS_UNAVAILABLE`, so **configure the gateway before going live**.
- **Customer SMS** is the owner's optional message on accept, ship and cancel,
  rendered from the GSM-7 templates in Settings. See `PUBLIC_APP_URL`. The
  substitution rules for Bengali names are at the top of
  `src/domain/customerSms.js`.
- **Telegram** needs `TELEGRAM_BOT_TOKEN`. The client is a small fetch wrapper
  over the Bot API in `src/services/telegramClient.js`. Owner and resellers link
  from their notification settings with a one-time token valid for 15 minutes;
  the bot redeems `/start <token>` and `/stop` unlinks.
  - **Polling** is the default. Only one process may poll: one with
    `RUN_JOBS=true` that holds the `telegramPolling` MongoDB lease, renewed every
    20 seconds. Other processes still send.
  - **Webhook** when `TELEGRAM_WEBHOOK_URL` is set to the public base URL of this
    API. The bot registers `POST /api/telegram/webhook/<secret>` with the same
    value as Telegram's secret token, and both are checked in constant time.
    Make sure your proxy forwards that path to the API.

Background work: `RUN_JOBS=true` enables the scheduled jobs in this process. Set
it on at least one instance in production, or reconciliation, the digest and
the KYC purge never run. It is safe on every instance, because each run takes a
lock.

## Running more than one instance

Every piece of shared state lives in MongoDB (docs/adr/0012), so any number of
API processes can run behind a load balancer with no extra infrastructure:

- **Rate limits** are counted in the `ratelimithits` collection
  (`services/rateLimitStore.js`), one atomic update per request, with a TTL
  index that removes a window once it ends. Every limiter is built through
  `createLimiter`, so none falls back to a per-process memory store. Limits:
  login and register 20 per 15 minutes per IP; refresh 60 per 15 minutes per
  IP; anything that sends an OTP 10 per 15 minutes per IP (on top of three
  codes an hour per phone); signed-in account changes 10 per 15 minutes per
  account; public order 10 per 10 minutes per IP and shop, **and** 60 per 10 minutes
  per shop whatever the IP; tracking 30 per 10 minutes; shop browsing 120 a
  minute; uploads 30 an hour per reseller and 200 an hour for the owner.
- **The outbox** (`services/outbox.js`) claims each message with an atomic
  lease, so two workers never send the same one. Each channel records its own
  outcome, so a failed Telegram is retried without resending the web push.
  Retries back off exponentially; after 5 attempts a message is marked `dead`
  and appears in the owner's next daily digest. Every instance runs the worker.
- **Scheduled jobs** (`src/jobs/`) run only where `RUN_JOBS=true`, and each
  run also takes a lock document in `joblocks` for its slot, so turning the
  flag on everywhere still runs each job once:

  | Job | Dhaka time | What it does |
  |---|---|---|
  | `nightlyReconcile` | 02:00 | Replays every wallet's ledger; alerts the owner (in-app, push, Telegram) on any drift. |
  | `kycPurge` | 03:00 | Deletes R2 scans of rejected KYC 90 days after review, and of approved KYC one year after the reseller was deactivated; sets `purgedAt` (docs/adr/0016). |
  | `dailyDigest` | 09:00 | One owner alert listing confirmed orders older than the aging threshold, resellers within 10% of their credit limit, outbox messages dead-lettered in the last day, and a low SMS gateway balance. Sends `balance.near_limit` to each affected reseller, once per Dhaka day. Silent when there is nothing to report. |

  A job that fails logs the error on its lock document (`lastError`) and does
  not claim its slot, so another instance's timer may still run it.

## Shape of the code

```
src/
  config/      env validation, db connection, logger, R2 storage
  models/      one file per collection
  domain/      constants and the order state machine
  services/    ledger, orders, pricing, stock, notifications, outbox
  jobs/        scheduled jobs, their MongoDB locks and the Dhaka-time scheduler
  channels/    web push, telegram, sms adapters
  middleware/  auth, validation, uploads, error envelope
  modules/     auth, public, reseller, owner route groups
  utils/       money, quantity, phone, Dhaka time, slugs, order codes
```

Three rules the code depends on:

1. **Money is integer poisha, quantity is integer milli-units.** Conversion
   happens only at the API boundary, in `utils/money.js` and `utils/quantity.js`.
2. **Only `services/ledger.js` changes a balance**, always inside a transaction,
   and it never edits an existing entry.
3. **No controller compares an order status by hand.** Every transition goes
   through `domain/orderStateMachine.js`, which decides what may happen, what the
   ledger posts and whether stock comes back.
