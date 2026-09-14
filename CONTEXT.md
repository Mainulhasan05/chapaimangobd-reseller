# Domain vocabulary

Use these words exactly, in code, in the UI and in conversation. When a concept here
appears in code, it uses the name in the heading. Full design in `docs/PLAN.md`.

## Actors

**Owner** — the mango business. One account, created by seed. Holds the catalog, ships
every parcel, approves KYC, deposits and withdrawals. Never called "admin" in code.

**Reseller** — a sales channel. Registers with name, phone and password, submits KYC,
prices products, shares a public form, confirms orders. Holds a wallet.

**Deactivated reseller** — a reseller the owner has switched off (`isActive: false`). Their
public shop answers "not taking orders", their pending orders are cancelled by the system,
and orders from confirmed onwards are fulfilled as normal. The balance stays. They keep a
read-only login and may still request a withdrawal, because money is never trapped by
deactivation; every other write is refused with `RESELLER_INACTIVE`. See docs/adr/0011.

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

**Payment mode** — `prepaid` or `cod`. Chosen on the form, may be changed by the reseller in
the confirm call, and fixed from confirm onwards (docs/adr/0007).
- `prepaid`: the customer pays the reseller before dispatch.
- `cod`: the courier collects from the customer and remits to the owner.

**Order code** — the public identifier, random and non-sequential. Used with the customer's
phone number to look up status.

**Business date** — the Asia/Dhaka calendar date an order was created, denormalised as a
string so "today's orders" is an index scan.

**Capability** — something a role may do to an order now that is not a status change:
`editCustomer` and `changeDeliveryCharge`. Declared beside the transitions in
`domain/orderStateMachine.js`. An order's **actions** are its available transitions followed
by its capabilities, for the role asking; every order response carries them, and a screen
offers exactly those buttons, never a status list of its own.

**Restock on return** — the owner's "put back in stock" choice when marking a shipped order
returned. Off unless ticked, because mangoes that have travelled are usually gone. Recorded
on the order as `restockedOnReturn` and in the audit log. A cancel, unlike a return, always
gives back the stock it took. See docs/adr/0008.

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
because cash on delivery accumulates positive balances. Never more than the balance: the
credit limit is never drawn on to pay one out (docs/adr/0009).

**Delivery adjustment** — a `DELIVERY_ADJUSTMENT` ledger entry for the difference when the
owner changes an order's delivery charge after the delivery debit has posted. Negative for a
raise, positive for a cut. The original debit is never edited. The charge may change until
the order ships; the charge on a return or cancel is the original debit plus every
adjustment, and they are kept or reversed together. See docs/adr/0010.

**SMS credit** — a separate integer counter, bought with wallet balance, spent on sending.
Not money and not stored in poisha.

## Notifications

**Event type** — what happened, e.g. `order.pending`, `deposit.approved`. Channels are
chosen from the event type and the user's preferences.

**Channel** — a delivery mechanism: in-app, web push, Telegram, SMS. In-app is always
written and is the source of truth. Every other channel is best effort.

**Outbox** — the queue that carries side effects out of a database transaction. Nothing
is sent from inside a transaction, because the transaction may be retried.

**Payer** — who an SMS is billed to, and therefore which rules govern it (docs/adr/0013).
- **Owner-paid:** OTP codes, owner alerts and customer SMS. Needs only a configured gateway.
- **Reseller-paid:** everything a reseller's notification preferences trigger. Needs the
  master switch, the reseller's own SMS flag, and credits.

Recorded on every SMS log row.

**Customer SMS** — the owner's optional text to an order's customer on accept, ship or
cancel, and on no other transition. An explicit checkbox, off by default, with the rendered
text previewed first. Rendered from owner-edited templates restricted to GSM-7 so each part
bills at the single-segment rate; exactly the previewed text is queued, through the outbox,
after the transition commits. Owner-paid, so the master switch does not apply.

**SMS log** — one row per SMS this platform attempted, carrying the gateway's own reply.
Written by `services/sms.js`, which is the only code allowed to reach the gateway. An
attempt that never left is logged too, as **blocked**, with the reason: a suppressed
message and a broken gateway are indistinguishable without it.

**Master switch** — the owner's `features.sms` flag, surfaced as one toggle on the SMS
panel. It governs **reseller-paid** SMS only: off means no reseller notification is sent by
SMS, whatever that reseller's own preferences say and however many credits they hold.
Owner-paid SMS (OTP codes, owner alerts, customer SMS) bypasses it and needs only a
configured gateway (docs/adr/0013). Enforced twice, on purpose: once when the message would
be queued, and again, read fresh, at the moment of sending.

## Identity

**OTP** — a six-digit one-time code sent by SMS. Required to register (the phone is proved
before the account exists), to reset a forgotten password, to change a phone number, and
for the owner signing in from a device that is not trusted. Stored only as a peppered hash;
valid five minutes; void after five wrong tries or when a newer code is sent for the same
phone and purpose; three sends per phone per hour, one a minute. Owner-paid. See
docs/adr/0014.

**Trusted device** — a browser the owner has proved with an OTP, remembered for thirty
days by a random cookie whose hash is stored in `TrustedDevice`. A password alone opens the
owner account only from a trusted device; a new one takes a code and raises a new-device
alert. `OWNER_DEVICE_OTP` turns this off for local development and tests, and cannot be
false in production. Resellers have no trusted devices.

## Coordination

**Lease** — a claim with an expiry, held in MongoDB, so that several API instances can
share work without doubling it (docs/adr/0012). An outbox message is claimed with a lease
(`leaseUntil`) before it is sent; a worker that dies simply lets it lapse and another
retries it. Telegram polling is held by the `telegramPolling` lease, renewed while polling.

**Job lock** — the lease a scheduled job takes in `joblocks` for its run (its slot), so
setting `RUN_JOBS=true` on every instance still runs each job once. A failed run records
`lastError` and does not claim its slot.
