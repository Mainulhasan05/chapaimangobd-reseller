# 3. Payment mode is fixed per order

Status: accepted

## Context
Resellers collect payment directly in some cases, and in others the courier collects on
delivery and remits to the owner. These settle differently.

## Decision
Every order carries `paymentMode`, either `prepaid` or `cod`, snapshotted at creation.

Confirm posts the same two debits in both modes: cost price times quantity, and the
delivery charge, as separate entries. Only the delivered transition branches. A `cod` order
posts a collection credit for the sell subtotal plus delivery, so the reseller's margin
lands in their wallet. A `prepaid` order posts nothing further.

## Consequences
Cash on delivery accumulates positive balances, so withdrawal requests are required, not
optional. The delivery charge is its own entry rather than folded into the cost debit,
because a refused delivery reverses the goods while the courier fee was still paid.
