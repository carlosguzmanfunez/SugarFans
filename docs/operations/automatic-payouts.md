# Critical open item: automatic creator payouts

Status: **P0 — required before enabling unattended payouts.** The 26–25 calendar and 26–1 payment window are approved; automatic execution is explicitly deferred. This item does not replace other launch/security blockers.

## Step 1: retire simulated withdrawals from the real backend

The Supabase adapter now accepts only an explicit server confirmation (`ok: true`, `paid` or `sending`, and a positive numeric net amount). Network failures, unavailable endpoints and malformed responses report an unconfirmed withdrawal and never invoke a SQL payment fallback. Local demonstration payments remain in the separate browser-only backend.

Migration `20261019215002_disable_simulated_payout_fallback.sql` replaces the old `request_payout()` implementation with a non-writing rejection, changes it to `SECURITY INVOKER`, and removes execution from `PUBLIC`, `anon`, `authenticated` and `service_role`. Keeping the signature makes stale clients fail closed. Even a future accidental grant cannot restore its previous behavior. Existing payments and balances are not rewritten; the supported `paypal_payout_start` and provider confirmation flow remain available.

The retirement migration was applied before publishing the updated client, recorded in Supabase as version `20261020015101`. PR #86 is merged and published. Function bodies/privileges and unchanged historical rows/balances were verified. Do not restore the historical fallback as a rollback: that would reopen the same unsafe path. `npm run test:payout-safety` covers unavailable/malformed responses, valid paid/sending responses, session requirements, direct RPC denial and history preservation on disposable PostgreSQL. No automatic executor is enabled.

Step 2 below is also published. Step 3 provides the payout event reconciliation proposed in this branch; its migration and server still require publication. Exact batch reservations/allocations, an adjustment ledger, cross-session concurrency and actual PayPal Sandbox integration remain required before unattended execution.

## Step 2: preserve and recover ambiguous submissions

Migration `20261019220609_payout_submission_recovery.sql` adds a server-only snapshot per individual withdrawal. `paypal_payout_begin` atomically reserves the balance and stores the exact provider request, including recipient, net USD amount, note/header, stable withdrawal UUID, environment and sender client ID. It is not the frozen multi-creator batch or accounting ledger required below. No historical rows are backfilled from today's recipient account.

The server claims an attempt using a two-minute lease and a fencing token, then calls PayPal outside the database transaction with a bounded ten-second network timeout. A timeout, 5xx, malformed response or missing batch ID retains `sending` and its reserved balance. Acceptance saves the batch ID before any delivery query. A definitive `422 INSUFFICIENT_FUNDS` rejection may release a first attempt; the same rejection after an uncertain earlier attempt must retain the reserve.

`payout-check` now includes withdrawals without a stored batch ID. It can replay the same frozen request and recover the original batch from PayPal's duplicate response. Recovery links are limited to the configured PayPal API origin; the fetched batch must identify the original withdrawal. Amount, USD currency, recipient and item reference are checked before applying an item result. A known batch is queried without resending. `ONHOLD`, `BLOCKED` and unknown states retain the reservation.

New POST attempts stop after five total attempts or 29 days from the first attempt, conservatively within PayPal's documented 30-day duplicate protection. New sending is also held for sender/environment changes, identity/account restrictions and negative creator balances. These conditions never release the reservation. Known batches remain queryable beyond that limit and while sending is restricted. An older response with an obsolete lease cannot overwrite a newer attempt. An old withdrawal without its original snapshot and batch requires review instead of reconstruction or resending.

Recovery runs when the existing server reconciliation endpoint is requested (including opening/reloading earnings). This does not add a monthly scheduler or unattended executor. The creator sees “En proceso”, confirmation pending or review needed, rather than a guaranteed delivery message. New RPCs are executable only by `service_role`; RLS and table privileges deny direct client/server REST access to the snapshots, which are accessed by the narrowly granted RPCs.

`npm run test:payout-recovery` executes the actual API and SQL against disposable PostgreSQL with all PayPal calls mocked. Independent PostgreSQL sessions and actual PayPal Sandbox signature/integration behavior remain pending. Step 3 adds durable payout webhook history and replaces the old writer; step 2 alone does not make automatic payouts ready.

Publication completed in that order: PR #86/fallback retirement, this migration (Supabase version `20261020015155`), then PR #87/server and client. Production commit `45edfa40167ab6ba561bf53cf29ba08162baa9fe` is READY in Vercel. Historical payout, transaction, recipient and calculated balance signatures were unchanged. Retain snapshots and reservations during rollback; restoring the old send/error handling would reopen duplicate-payment risk. No real payout was executed and no automatic job was enabled.

Provider references: [sender batch deduplication](https://developer.paypal.com/api/payments.payouts-batch/v1/definitions/payout_sender_batch_header/), [batch details](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-get/), [item transaction states](https://developer.paypal.com/api/payments.payouts-batch/v1/definitions/transaction_enum/).

## Step 3: persist and reconcile payout events

See [payout event reconciliation](payout-event-reconciliation.md) for the design, deployment sequence and operator checks. This branch adds a private event inbox and query history, authoritative provider validation, atomic evidence/state commits and fencing of late query responses. Pending events are recoverable via webhook retries or the earnings endpoint. Contradictory payment states preserve/recover the original reservation and require review.

The recovery suite now includes 40 recovery cases and 25 event cases. This migration has not been applied to production. Its scope is Payouts notifications, queries and cancellation; capture refunds, disputes and subscription events still need their own durable inbox/reconciliation. The double-entry ledger, frozen multi-creator batches and unattended executor remain open.

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
