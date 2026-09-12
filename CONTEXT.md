# Domain vocabulary

Use these words exactly, in code, in the UI and in conversation. When a concept here
appears in code, it uses the name in the heading. Full design in `docs/PLAN.md`.

## Actors

**Owner** — the mango business. One account, created by seed. Holds the catalog, ships
every parcel, approves KYC, deposits and withdrawals. Never called "admin" in code.

**Reseller** — a sales channel. Registers with name, phone and password, submits KYC,
prices products, shares a public form, confirms orders. Holds a wallet.

**Customer** — the end buyer. Has no account and never logs in. Identified on an order by
name, phone and address.

## Catalog

**Source** — a place products are collected from. Name, address, optional phone. A source
is attached to a **line item** when the owner accepts an order, never to a Product: the
product is fixed, and which orchard today's crate comes from is not.

**Product** — something the owner sells. Carries a cost price, a unit, a minimum order
quantity, an optional maximum sell price, and optional stock tracking. Owned by the owner.
Has no source; see **Source**.

**Reseller product** — one reseller's activation of one product: their sell price, whether
the price is hidden on their form, and whether it is listed. A product reaches a public
form only through this. Never embedded in Product.

**Delivery zone** — a named group of districts with a delivery charge.

## Orders

**Order** — one customer submission. Belongs to one reseller, carries one payment mode,
and holds one or more line items.

**Line item** — one product within an order, with quantity, sell price, and snapshots of
the cost price, unit and minimum quantity taken at confirm. From accept onwards it also
carries the **source** it is collected from, and a snapshot of that source's name.

**Snapshot** — a value copied onto an order so that later catalog edits cannot change
history. Prices, names, units and minimums are taken at confirm; the source name is taken
at accept, because that is when it is decided. Never `populate()` a product or a source to
render a historical order: read the snapshot. This is what lets the owner archive a product
or retire an orchard without touching a single past order.

**Payment mode** — `prepaid` or `cod`, fixed per order at creation.
- `prepaid`: the customer pays the reseller before dispatch.
- `cod`: the courier collects from the customer and remits to the owner.

**Order code** — the public identifier, random and non-sequential. Used with the customer's
phone number to look up status.

**Business date** — the Asia/Dhaka calendar date an order was created, denormalised as a
string so "today's orders" is an index scan.

## Money

All money is **poisha**, an integer. One taka is one hundred poisha. Field names end in
`Poisha` so an unconverted value is visible at the call site.

All quantity is **qtyMilli**, an integer. One kilo is one thousand. Field names end in
`Milli` for the same reason.

**Wallet balance** — the reseller's net position with the owner. Negative means they owe.
Denormalised on the profile, moved only by the ledger service.

**Credit limit** — how far negative a reseller's balance may go. Per reseller, default zero.

**Ledger entry** — one immutable record of a balance movement. Never updated, never deleted.
A correction is a new entry referencing the original.

**Reversal** — a ledger entry that undoes an earlier one. Carries `reversalOf`.

**Deposit** — a reseller paying the owner. Credits the wallet on approval.

**Withdrawal** — the owner paying a reseller out. Debits the wallet on approval. Exists
because cash on delivery accumulates positive balances.

**SMS credit** — a separate integer counter, bought with wallet balance, spent on sending.
Not money and not stored in poisha.

## Notifications

**Event type** — what happened, e.g. `order.pending`, `deposit.approved`. Channels are
chosen from the event type and the user's preferences.

**Channel** — a delivery mechanism: in-app, web push, Telegram, SMS. In-app is always
written and is the source of truth. Every other channel is best effort.

**Outbox** — the queue that carries side effects out of a database transaction. Nothing
is sent from inside a transaction, because the transaction may be retried.

**SMS log** — one row per SMS this platform attempted, carrying the gateway's own reply.
Written by `services/sms.js`, which is the only code allowed to reach the gateway. An
attempt that never left is logged too, as **blocked**, with the reason: a suppressed
message and a broken gateway are indistinguishable without it.

**Master switch** — the owner's `features.sms` flag, surfaced as one toggle on the SMS
panel. Off means off for every reseller action, whatever a reseller's own preferences say
and however many credits they hold. Enforced twice, on purpose: once when the message
would be queued, and again, read fresh, at the moment of sending.
