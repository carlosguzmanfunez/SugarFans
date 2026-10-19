# Critical open item: automatic creator payouts

Status: **P0 — required before enabling unattended payouts.** The 26–25 calendar and 26–1 payment window are approved; automatic execution is explicitly deferred. This item does not replace other launch/security blockers.

## Step 1: retire simulated withdrawals from the real backend

The Supabase adapter now accepts only an explicit server confirmation (`ok: true`, `paid` or `sending`, and a positive numeric net amount). Network failures, unavailable endpoints and malformed responses report an unconfirmed withdrawal and never invoke a SQL payment fallback. Local demonstration payments remain in the separate browser-only backend.

Migration `20261019215002_disable_simulated_payout_fallback.sql` replaces the old `request_payout()` implementation with a non-writing rejection, changes it to `SECURITY INVOKER`, and removes execution from `PUBLIC`, `anon`, `authenticated` and `service_role`. Keeping the signature makes stale clients fail closed. Even a future accidental grant cannot restore its previous behavior. Existing payments and balances are not rewritten; the supported `paypal_payout_start` and provider confirmation flow remain available.

Deploy the retirement migration before publishing the updated client. Do not restore the historical fallback as a rollback: that would reopen the same unsafe path. Verify function privileges and unchanged historical rows when applying it. The new `npm run test:payout-safety` covers unavailable/malformed responses, valid paid/sending responses, session requirements, direct RPC denial and history preservation on disposable PostgreSQL. This is preparation for production review, not evidence that the migration is already applied or that an automatic executor exists.

Next in order: preserve/recover ambiguous submissions, persist and reconcile provider events, then build exact batch reservations/allocations and an adjustment ledger. Cross-session concurrency and actual PayPal Sandbox integration remain required before unattended execution.

## Existing foundation

The application already stores transactions, payout recipients and individual payouts with gross/fee/net amounts, sending/paid/failed state, provider references and an error field. The existing server sends a single creator payout, uses a stable identifier for that request, checks provider notifications, and can query or cancel applicable in-progress payouts. Database checks include identity verification, minimum balance, account restrictions, recipient presence and a lock against overlapping withdrawals.

Refund/dispute handling updates source transaction states, supports release after a favorable resolution and allows the platform to cover the creator's share. Administrative account actions and the movement book provide operational visibility. These are building blocks; they do not establish that every external service is enabled or that unattended payment handling is complete.

## Required implementation and acceptance criteria

- Durable cycles, frozen batch versions, per-creator items and transaction allocations. Separate current-cycle accrual, available carryover, reservations, in-progress delivery and confirmed payment. Prevent allocation of the same earnings to concurrent batches or manual requests.
- A persistent double-entry journal with balanced entries, source references, currency/rounding rules, reversals and an audit trail. Generated transaction reports are not a substitute. Reconcile PSP, bank, journal, payout items and available PayPal funds, including fees and other customer/creator obligations.
- Server-side scheduler/executor with a transactional outbox, locks, unique business keys, retry limits and operational recovery. The browser must not be the scheduler. Define the exact batch amount instead of blindly taking a changing aggregate balance.
- Durable provider event IDs and item history; signature, amount, currency, recipient and reference verification. Handle duplicate/out-of-order/lost events and fetch authoritative item states. Batch success alone is insufficient.
- Preserve a reservation for ambiguous submissions/timeouts, pending, held and unclaimed items. Reconcile before retrying; reuse the same business/provider key. Release funds only after definitive failure/return, and never resend a confirmed item.
- Explicit incident cases: missing/invalid recipient, unsupported country/currency, KYC or account limits, suspended/frozen account, insufficient funds including fees, unpaid minimum, dispute/refund/chargeback before or after payout, negative creator balance and late adjustments after a frozen close. Record reason, affected amount, evidence, owner, next action and resolution.
- Review existing fallback/retry and payout-state transition behavior before unattended use. Mark delivery paid only from verified provider confirmation; simulations must remain isolated from real payment records.
- Dashboard and email alerts only for actionable incidents, grouped and deduplicated per cycle/creator/cause. Routine successful payments remain in the log. Existing email infrastructure alone does not implement these incident workflows.
- Sandbox tests for concurrency, partial batch success, timeout after provider acceptance, duplicate/out-of-order notifications, long holds, unclaimed returns, dispute reversals, insufficient balance and recovery after downtime. Confirm commercial/provider authorization and current fees before live activation.

The independent finance dashboard remains a separate demo/proposal until its reader, durable storage and reconciliation are implemented. A read-only source connection cannot execute payouts or deduct creator balances.
