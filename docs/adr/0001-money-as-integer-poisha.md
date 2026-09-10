# 1. Money is stored as integer poisha

Status: accepted

## Context
Amounts move through repeated `$inc` on a wallet balance. Quantities are fractional for
kilos but whole for pieces.

## Decision
Money is an integer count of poisha (one taka = 100). Quantity is an integer count of
milli-units (one kilo = 1000). Field names end in `Poisha` and `Milli`. One rounding rule:
`lineTotal = Math.round(unitPrice * qtyMilli / 1000)`, and an order total is the sum of
already-rounded line totals, never a rounded sum.

## Alternatives
Floating point drifts under repeated `$inc` and cannot be trusted in a ledger. Decimal128
is arithmetically correct but returns an object from Mongoose, serialises as
`{$numberDecimal}`, and needs conversion on every read for a currency with two decimals.

## Consequences
Every money field validates with `Number.isSafeInteger`. Mongoose maps `Number` to a BSON
double, which represents integers exactly below 2^53, so the validator is what actually
enforces the invariant. Conversion happens only at the API boundary.
