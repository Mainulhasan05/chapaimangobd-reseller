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

## Environment

Only four variables are mandatory: `MONGODB_URI`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, and the `OWNER_PHONE` / `OWNER_PASSWORD` pair used by the
seed. Everything else has a working default.

Integrations are optional and the app reports which are live at `/api/health`:

- **Cloudinary** is required for KYC documents, deposit screenshots and product
  images. Without it those uploads fail; the rest of the system works.
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
