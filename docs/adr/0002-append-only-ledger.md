# 2. The ledger is append-only

Status: accepted

## Context
Disputes with resellers over how much is owed are the reason this system exists. A record
that can be edited settles nothing.

## Decision
`LedgerEntry` is never updated and never deleted. Mongoose pre-hooks on every update and
delete operation throw. A correction is a new entry carrying `reversalOf`.

Each entry carries a `seq` and a `balanceAfterPoisha`, both produced by the same atomic
`findOneAndUpdate` that changes the balance, so they cannot disagree with reality. The
credit-limit check lives in that operation's `$expr` filter rather than in JavaScript,
which removes a time-of-check-to-time-of-use race with the owner editing the limit.

Each entry carries a deterministic unique `idempotencyKey`. A duplicate write fails on the
index and resolves to the existing entry.

## Consequences
The denormalised balance on the profile is kept for query speed and for the atomic limit
check, but the ledger is the source of truth. A reconciliation job asserts they agree, and
the receivables report computes from the ledger so it doubles as a permanent check.
