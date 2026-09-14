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

## Health, shutdown and logs

- `GET /api/health` is public and answers only `{ "ok": true, "db": "up" }`, or
  `503` with `{ "ok": false, "db": "down" }` when the database does not answer a
  ping. Point the load balancer at it.
- `GET /api/owner/system/health` (owner login) additionally reports the
  environment and which integrations are configured.
- `SIGTERM` / `SIGINT` stop accepting connections, stop the outbox worker, close
  MongoDB and exit, with a 10 second hard limit.
- Logs are one JSON line per event (pino). Every request gets an id, taken from
  an incoming `X-Request-Id` or generated, and echoed back in the `X-Request-Id`
  response header; quote it when reporting a problem. Cookies and the
  `Authorization` header are redacted. `LOG_LEVEL` sets verbosity; tests are
  silent. Pipe through `npx pino-pretty` locally for readable output.

## Environment

Only four variables are mandatory: `MONGODB_URI`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, and the `OWNER_PHONE` / `OWNER_PASSWORD` pair used by the
seed. Everything else has a working default.

The two JWT secrets must each be at least 32 characters and must differ; boot
refuses otherwise. `COOKIE_SECURE` follows `NODE_ENV` when unset (on in
production), and `COOKIE_SECURE=false` with `NODE_ENV=production` is refused.

Integrations are optional and the app reports which are live at
`/api/owner/system/health`:

- **Cloudflare R2** is required for KYC documents, deposit screenshots and
  product images. Without it those uploads fail; the rest of the system works.

  It needs **two buckets**, not one. R2 public access is bucket wide and cannot
  be scoped to a prefix, so there is no way to serve product photos publicly
  while keeping national ID scans private inside a single bucket.

  | Variable | Bucket | Holds | Access |
  |---|---|---|---|
  | `R2_BUCKET` | private | KYC scans, deposit screenshots | signed URLs only, ten minute expiry |
  | `R2_PUBLIC_BUCKET` | public | product photos, shop logos | readable by anyone, via `R2_PUBLIC_BASE_URL` |

  The app refuses to write a public image into the private bucket, and refuses to
  start public delivery if the two names match. Leave `R2_PUBLIC_BUCKET` unset and
  product image uploads fail with a clear message while KYC keeps working.

  `R2_PUBLIC_BASE_URL` is the public bucket's `r2.dev` URL or your own domain. It
  is **not** the S3 API endpoint, which requires a signature on every request.

  Everything is written under a single prefix, `R2_PREFIX`, defaulting to
  `chapaimango`, so a bucket shared with another project stays legible and a
  staging environment can use a different value:

  ```
  chapaimango/kyc/<uuid>.jpg        private bucket, signed URLs only
  chapaimango/deposits/<uuid>.jpg   private bucket, signed URLs only
  chapaimango/products/<uuid>.jpg   public bucket, served from R2_PUBLIC_BASE_URL
  chapaimango/logos/<uuid>.png      public bucket, served from R2_PUBLIC_BASE_URL
  ```

  Run `npm run check:storage` to verify it end to end. It uploads a throwaway
  object, reads it back through a signed URL, checks it is **not** readable
  without one, and deletes it.

- **Web push** needs a VAPID keypair. Generate once with
  `node -e "console.log(require('web-push').generateVAPIDKeys())"` and keep it.
  Regenerating silently invalidates every existing subscription.
- **SMS** uses the Automas gateway and is disabled by a feature flag regardless,
  so it stays dark until the owner turns it on.
- **Telegram** needs a bot token and username.

`TRUST_PROXY` must equal the exact number of proxy hops in front of Express.
Guessing collapses every client into one rate-limit bucket, or lets
`X-Forwarded-For` be attacker controlled.

## Shape of the code

```
src/
  config/      env validation, db connection, cloudinary, uploads
  models/      one file per collection
  domain/      constants and the order state machine
  services/    ledger, orders, pricing, stock, notifications, outbox
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
