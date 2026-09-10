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
they owe. Every order carries a payment mode, fixed when it is created.

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
npm test        # 64 tests against an in-memory replica set, no local MongoDB
npm run smoke   # boots both real servers and walks the whole flow over HTTP
```

`npm test` covers the money invariants: the ledger reconciles against the stored
balance, concurrent confirms debit once, a breached credit limit leaves nothing
behind, repricing does not move history, and the ledger refuses to be edited.

`npm run smoke` is the end-to-end check. It starts an in-memory replica set, the
Express API and the built Next app, then places a customer order, confirms it,
walks it to delivered, approves a deposit twice, and verifies the ledger
reconciles. Build the frontend first (`cd frontend && npm run build`).

## Layout

```
backend/     Express and Mongoose API, plain JavaScript
frontend/    Next.js 16 App Router, TypeScript, Bengali UI
docs/        the plan and the decision records
```

## Known gaps

- **Cloudflare R2 is required for uploads,** and it needs two buckets. R2 public
  access is bucket wide, so KYC scans cannot share a bucket with product photos
  that customers must load without signing in. `R2_BUCKET` stays private;
  `R2_PUBLIC_BUCKET` plus `R2_PUBLIC_BASE_URL` serve the images. Without
  credentials those uploads fail and everything else works. Verify with
  `npm run check:storage`.
- **SMS is built but switched off.** The Automas gateway integration, credit
  purchase and owner toggle are all complete, behind a feature flag that defaults
  to off, because Bengali messages are Unicode and cost roughly double.
- **Web push needs a VAPID keypair** and is best effort regardless: aggressive
  Android battery savers drop it. The in-app record is the source of truth.
- **Telegram needs a bot token.** It is the free channel that actually arrives.
# chapaimangobd-reseller
