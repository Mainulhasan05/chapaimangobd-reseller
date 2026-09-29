# Domain vocabulary

Use these words exactly, in code, in the UI and in conversation. When a concept here
appears in code, it uses the name in the heading. Full design in `docs/PLAN.md`.

## Actors

**Owner** — the mango business. One account, created by seed. Holds the catalog, ships
every parcel, decides who is asked for KYC and approves it, approves deposits and
withdrawals. Never called "admin" in code.

**Reseller** — a sales channel. Registers with name, phone and password, prices products,
shares a public form, confirms orders. Holds a wallet. Submits KYC only where the owner has
asked them to: see **KYC requirement**.

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

**Product** — something the owner sells. Carries a name, a unit, whether it is stock-tracked,
and the **variants** it is sold in. It has no price and no quantity rules of its own: a variant
has both. Owned by the owner. Has no source; see **Source**.

**Variant** — one box a product is sold in: a six-kilo box, an eleven-kilo box. Holds how much
is in it, the cost price and the ceiling **per box**, and a stock count in **whole boxes**. Its
id is stable and is what an order line and a reseller's price row point at; a box that has been
ordered is switched off, never deleted. Never called a "size" or an "option" in code. See
docs/adr/0021 and `domain/variants.js`.

**Box** — what a variant is, in the interface and in conversation. A quantity is a count of
boxes; there is no loose-quantity ordering anywhere.

**Reseller product** — one reseller's activation of one product: a sell price **per box**,
whether the price is hidden on their form, and whether it is listed. A box with no price row is
one this shop does not sell. A product reaches a public form only through this. Never embedded
in Product.

**Delivery zone** — a named group of districts with a delivery charge.

**District** — one of the sixty-four districts of Bangladesh, listed once in
`frontend/lib/districts.ts`. The stored value is the English name and never changes: zones,
orders and the delivery-zone lookup all match on it exactly. `districtLabel(value)` is what a
reader sees, always Bengali. Every district field picks from the sixty-four, with search;
nothing types a district name by hand. See docs/adr/0019.

## Orders

**Order** — one customer submission. Belongs to one reseller, carries one payment mode,
and holds one or more line items.

**Line item** — one **variant** within an order: which box, and how many. Carries the box count,
the sell price per box, and snapshots of the box's label, its contents, the cost price and the
unit taken at confirm. Two box sizes of one product are two lines, which is the point. It also
carries `qtyMilli`, everything in those boxes together, so a report can add up lines whose boxes
are different sizes. From accept onwards it carries the **source** it is collected from, and a
snapshot of that source's name.

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

## Quality

**Complaint** — one thing a customer said was wrong with an order. Written down by the
owner; the customer never touches it. It never changes an order's status and never moves
money: the order happened, and a return or a refund is a separate decision with its own
ledger entries. This exists because the only negative signals were `cancelled` and
`returned`, which are both fulfilment outcomes — a customer who takes the parcel, pays,
and then rings to say the fruit was rotten previously left no trace at all.

Never called a "review": a review is a testimonial on a landing page, and this is evidence.

**Complaint kind** — `quality`, `damaged`, `short_weight`, `wrong_item`, `late`, `other`.
Only the first four are about the fruit, so only those count against a **source**; a late
parcel is the courier's doing and must not cost an orchard its record.

**Blamed line** — a complaint names the order lines at fault, not the order. A source is
chosen per line at accept (docs/adr/0006), so one order can carry two orchards' fruit and
only one of them sent a bad crate. A complaint about the delivery names no lines, and one
logged before accept names lines whose source is still null, because nobody had decided yet.
Every name on a complaint is a **snapshot**, so renaming an orchard cannot launder its
history.

**Source record** — what one orchard supplied and how often it went wrong: distinct orders
(never lines, or an order with two crates from one orchard would count twice), quantity,
returns, complaints, and a `complaintRate` built only from the fruit kinds. The rate is
`null`, never zero, for an orchard nobody has bought from: no record is a different
statement from a clean one. Below five orders the UI refuses to draw a conclusion at all —
two complaints out of two is a hundred per cent and means almost nothing.

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

**Payout destination** — where a withdrawal is actually paid, and it is shaped by the
method. A mobile wallet (`bkash`, `nagad`, `rocket`) and cash are paid on a
`destinationNumber`, a normalised Bangladeshi phone number. A bank is paid on a `bank` block:
account holder name, bank name, branch name and account number, all required, plus an optional
routing number. Exactly one of the two is ever set on one withdrawal. Declared once in
`domain/payout.js`; never ask a bank for a phone number. See docs/adr/0018.

**Delivery adjustment** — a `DELIVERY_ADJUSTMENT` ledger entry for the difference when the
owner changes an order's delivery charge after the delivery debit has posted. Negative for a
raise, positive for a cut. The original debit is never edited. The charge may change until
the order ships; the charge on a return or cancel is the original debit plus every
adjustment, and they are kept or reversed together. See docs/adr/0010.

**SMS credit** — a separate integer counter, bought with wallet balance, spent on sending.
Not money and not stored in poisha.

**Owner revenue** — what the owner billed: the order's **wallet debit**, which is goods at
cost price plus the delivery charge. Never the customer total, which additionally carries
the reseller's margin and is therefore not the owner's money. Every report says
`ownerRevenue` for this and `customerTotal` for the other; calling either one "revenue"
without saying whose is how a figure ends up overstated by the resellers' earnings.

**COD in flight** — the customer total of every order that is `shipped` and `cod`. The
collection credit only posts at deliver, so until then this is the owner's cash out with
couriers, and it appears on no balance in the app.

## Cost

Everything above is what the owner **bills**. Everything here is what the owner **spends**,
which the system did not record at all before PLAN-3. None of it is visible to a reseller and
none of it touches a wallet.

**Supply** — something the business buys and uses up but never sells: a ক্যারেট, a sheet of
কাগজ, a সুই, a roll of tape. Carries a name, a unit, what is on hand and what it is worth. A
**Product** is the other thing entirely: a Product is sold and is never consumed, a Supply is
consumed and is never sold, and nothing is both. Never a Product with a flag. See
docs/adr/0022.

**On hand** — how many of a supply there are, in `qtyMilli` like every other quantity here.
Denormalised on the Supply and moved only by `services/supplyStock.js`, exactly as a wallet
balance is moved only by the ledger. The movements are the truth and a nightly reconciliation
asserts they agree.

**Negative on hand** — a supply consumed more than it was recorded bought. Allowed, and not an
error to be blocked: it means the recording is behind reality, which the owner needs to see
rather than something the system should refuse. Shown as "হিসাব মেলেনি". See docs/adr/0026.

**Stock movement** — one immutable record of a change to a supply's on-hand quantity. Never
updated, never deleted; a correction is a new movement. The same shape and the same promises
as a **Ledger entry**, for the same reason: the question is never only "how many are there"
but "where did four hundred go", and an overwritten number cannot answer the second one.

**Landed cost** — what one unit actually cost once the extra charges are added in: "koto kore
porlo". A hundred crates at 80 taka with 600 of van hire and 200 of loading cost 88 each, and
88 is the number meant by the price of a crate. Never the rate alone. Charges are spread by
**largest remainder**, so the shares sum to the charge exactly. See docs/adr/0023.

**Average cost** — the moving weighted average landed cost of a supply, recomputed on each
receipt, and what a consumed unit is valued at. Not FIFO. A consequence worth knowing:
cancelling a purchase cannot restore the previous average, because a moving average has no
memory and later movements were valued at the blended rate. A **stock take** is the remedy.

**Packaging recipe** — what one box of a variant consumes: an eleven-kilo box takes one
ক্যারেট, about one and a half sheets of কাগজ and two সুই. Held on the **variant**, because the
box is what gets packed. Read once, when the parcel's fate is settled, and snapshotted onto
the line; never read again.

**An estimate, and never described as anything else.** Nobody counts sheets of paper into a
crate. Every movement a recipe produces carries `isEstimated`, every screen that shows one
says so, and the recipe is expected to be wrong until stock takes have corrected it. A figure
inferred and then presented as a measurement is summed into a cost, then into a margin, then
believed.

**Estimated consumption** — a movement worked out from a recipe. **Counted** is its opposite:
a stock take, where somebody looked at the shelf. Both are real records; only one is a
measurement, and telling them apart is what makes a recipe improvable rather than merely
plausible.

**Stock take** — the owner counting a supply and entering the real number, not a difference:
"there are ninety-four" is what somebody with a clipboard knows. The difference posts as a
counted `ADJUSTMENT`, and nothing at all posts when the count already agrees. The only thing
that corrects a drifting recipe.

**Recipe variance** — what the recipes predicted against what the stock takes corrected, per
supply, over a range. A ratio above one means every box really uses more than its recipe
claims. `null`, never one, when nothing has been compared: no evidence is a different
statement from no error, exactly as `complaintRate` is null for an orchard nobody has bought
from. The system never rewrites a recipe from its own variance — one bad count would otherwise
change every future cost with nobody deciding to.

**Recognised** — the moment packaging becomes a cost: **deliver** or **return**, never pack. A
returned parcel consumed its packaging too, because it travelled both ways; a **cancelled**
one consumed none, from any status including `packed`, because nothing left the building and a
crate on the table is reusable. All three outcomes are terminal, so a consumption is never
reversed and there is no restore path at all. The consequence is a lag — the shelf runs down
before the app does — and that is what a stock take closes. See docs/adr/0026.

**Payee** — anyone the business owes money to or pays: the ক্যারেট seller, a labourer, the
courier company, a van owner, a landlord. One model, because a due is a due; `kind` changes
the label a reader sees and nothing else. Deliberately not a "supplier", since a labourer
supplies nothing, and deliberately not a **Source**, which is an orchard carrying a quality
record — the same person may be both and they stay two rows. See docs/adr/0025.

**Due** — what the owner owes a payee, as `duePoisha`, **positive when the owner owes**.
Deliberately not named `balancePoisha`: a reseller balance runs the other way, negative meaning
they owe, and two fields that look alike and mean opposites is how a figure ends up backwards
in a report. The name is the guard. What resellers owe and what the owner owes are never
netted into one number.

**Advance** — a negative due. The owner paid ahead (বায়না) and the payee owes goods. Legal,
expected, and never guarded against.

**Payee ledger entry** — one immutable movement of a payee's due, append-only with a monotonic
sequence and a deterministic idempotency key, exactly like a **Ledger entry**. No entry is
ever refused by a limit: a reseller debit is guarded because the owner is extending credit and
chooses how much, while a payee due is a fact that already happened somewhere else and is
merely being written down. That difference is why it is a separate service and not a flag on
`services/ledger.js`.

**Purchase** — one buying event from one payee on one day, recorded when the goods are in
hand, so recording it moves the stock and posts the due in one transaction. **Cancelled and
re-entered, never edited**: editing one would have to rewrite a stock movement, a landed cost
and a ledger entry, all append-only on purpose. See docs/adr/0024.

**Purchase charge** — an extra cost on a purchase: transport, labour, loading, commission. Two
independent axes. `allocate` decides whether it raises what the goods cost; `paidTo` decides
whether anyone is owed for it. Paying the van driver in cash at the gate makes the crates cost
more without making the crate seller owed a paisa more, which is why `payeeTotalPoisha` and
`totalPoisha` are different fields and neither is a substitute for the other.

**Expense** — money that left the business and is not recorded anywhere else. The fruit's cost
is a snapshot on an order line and the crate's cost is a stock movement; everything else —
লেবার, পরিবহন, কুরিয়ার, rent — is one of these.

**Expense scope** — **order** or **period**, and every expense is exactly one. An order
expense belongs to one named parcel and counts toward its margin. A period expense belongs to
a day and is **never** divided across orders: nobody measured লেবার per parcel, and a share
invented to complete a per-order figure is a number that is not true and would then be summed
into a margin and believed. See docs/adr/0027.

**Expense category** — an owner-managed list, not a frozen enum, because this is where the
system stops being about mangoes. Seeded with the owner's six. Each declares the scope it is
for. Archived, never deleted: an expense snapshots its category's name.

**Order cost** — goods at cost, plus the packaging consumed, plus the order's own expenses.
What one parcel actually cost to put out.

**Order margin** — `ownerRevenue − order cost`. Never confused with the reseller's margin,
which is `customerTotal − ownerRevenue` and is not the owner's money at all.

**Courier cost** — what the owner pays the courier. **Not** `deliveryChargePoisha`, which is
what the owner *bills the reseller* and is revenue, already posted as `DELIVERY_DEBIT`. They
are two different numbers, the app held only the second until PLAN-3, and the gap between them
is the owner's margin on delivery. Never added together, never substituted for one another.

**Gross margin** — the sum of order margins over a range, **before** period costs. Never
called profit.

**Period profit** — gross margin minus the period expenses in that range. The only figure in
the system that answers "did we make money", and the only one that may be called profit
without saying whose or before what.

## Reports

**Report** — a screen that prints. There is no PDF renderer: the whole app is in Bengali,
which needs real text shaping, and the browser already does that correctly for every other
screen. A report page is styled for paper under `@media print` in `globals.css`, and a PDF
comes out of the browser's own print dialog under "Save as PDF". `print-hide` drops a
control from the sheet, `print-block` keeps a block from being torn across two pages.

**Order sheet** — every order in a range, printed unpaged, with the full address and the
amount to collect. The document the packing table works from. Never paged: a dispatch sheet
missing page two is worse than no sheet, so `max` caps it and the response says when it hit
the cap rather than handing back a short sheet that looks complete.

**Pick list** — what to collect and from which source, for orders that are confirmed,
accepted or packed. A confirmed order has no source yet (docs/adr/0006), so it is reported
under a null source rather than folded into an orchard's total.

**Due report** — who owes what, now. Takes no date range, because a balance is where a
wallet stands at the moment it is printed and not a property of a period. Same for the
customer report, which reads the standing `Customer` projection.

**Order filter** — `utils/orderFilter.js`, the only place a query becomes a Mongo filter
over orders. The list, the counts beside it, the order sheet and the CSV export all build
from it, so they cannot disagree about which orders a screen is showing. Dates match the
indexed `businessDate` string, never `createdAt`.

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

**KYC requirement** — the owner's per-reseller `kycRequired` flag. Off for every reseller
until the owner turns it on, and while it is off the KYC module is not on that reseller's
screens at all and nothing about their shop is gated by verification. Never a platform-wide
setting: the owner asks one reseller, for a reason, and the ask is audited. Read through
`domain/kyc.js` and never directly, so that a reseller who was never asked cannot be refused
for not having answered. **Required** is the gate; **visible** is the screen, and they differ
for a reseller who submitted documents before the requirement was lifted. See docs/adr/0017.

**Link field** — a field someone types a web address into: the reseller's `facebookUrl` and
the owner's landing `videoUrl`. No format is demanded of either; they hold whatever was typed.
`externalHref()` in `frontend/lib/url.ts` is the only thing that turns one into an `href`, and
the only thing allowed to assume a scheme. Never add a URL check to one of these. See
docs/adr/0020. Not to be confused with an env var URL or a push endpoint, which are not typed
by anyone and stay validated.

**OTP** — a six-digit one-time code sent by SMS. Required to register (the phone is proved
before the account exists), to reset a forgotten password, to change a phone number, and
for the owner signing in from a device that is not trusted. Stored only as a peppered hash;
valid five minutes; void after five wrong tries or when a newer code is sent for the same
phone and purpose; three sends per phone per hour, one a minute. Owner-paid. See
docs/adr/0014.

**Trusted device** — a browser the owner has proved with an OTP, remembered for thirty
days by a random cookie whose hash is stored in `TrustedDevice`. Governed by
`OWNER_DEVICE_OTP`, which is **off by default**: the owner signs in with a password alone,
from any browser. Switched on, a password alone opens the owner account only from a trusted
device, and a new one takes a code and raises a new-device alert. Off is the right default
for a business one person runs from one phone, where the SMS gateway failing would otherwise
lock the owner out of their own orders; turn it on wherever more than one person holds the
owner password. Resellers have no trusted devices.

## Coordination

**Lease** — a claim with an expiry, held in MongoDB, so that several API instances can
share work without doubling it (docs/adr/0012). An outbox message is claimed with a lease
(`leaseUntil`) before it is sent; a worker that dies simply lets it lapse and another
retries it. Telegram polling is held by the `telegramPolling` lease, renewed while polling.

**Job lock** — the lease a scheduled job takes in `joblocks` for its run (its slot), so
setting `RUN_JOBS=true` on every instance still runs each job once. A failed run records
`lastError` and does not claim its slot.
