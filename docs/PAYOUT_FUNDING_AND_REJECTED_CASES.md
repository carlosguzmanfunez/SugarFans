# Rejected payout cases and payer funding pauses

An individual rejection opens a `PAYOUT_REJECTED` case linked to the original payout and its group mirror. It preserves the provider's reason and proof, without inferring creator fault, resending, changing the recipient or resetting attempts. Deployment backfills cases and alert queue entries for historical failures; it does not reproduce historical funding pauses.

A validated `INSUFFICIENT_FUNDS` rejection opens one `PAYER_FUNDS_INSUFFICIENT` incident per environment. Its immutable stop blocks new manual withdrawals, preparation, unsubmitted claims and the worker's last permission check. The worker also stops new submissions in its current round if the rejection acknowledgement is lost. Later rounds can reconcile accepted batches and events. Transport backoff remains a separate control.

To resume, an administrator records fresh payer funding evidence after the stop. It must be no more than 24 hours old and cover uncertain commitments, payments after observation and the current cycle's remaining reserved items. Refresh the case, select the resume action and document Fans Reserve's responsibility for its payer funds. The existing case confirmation, source hash and request key guard the decision. It releases only this funding stop. Execution gates, provider waits, recipient restrictions, commercial authorization and all original snapshots remain in force. A later funding rejection can open a new episode. Previously rejected payouts are not retried by closing either case.

Creator fees retain the existing actual-cost procedure: native item evidence plus a normalized statement line, administrative preview, documented resolution and paired ledger entries. A verified $0.98 cost against $1 estimated credits $0.02 to that creator in the next eligible cycle. Neither the original payout nor the platform's 20% sales commission is rewritten. A test normalization is not a real bank or PayPal account statement.

## Deployment

1. Review and apply `20261022015657_payout_rejected_cases_and_funding_pause.sql` before deploying the server and dashboard. It adds no scheduler, enables no execution gate and grants no direct client access to private records.
2. Publish the reviewed server and dashboard together. Use the existing incident alert delivery configuration. Do not send test alerts to real recipients as part of migration verification.
3. Inspect historical case links and access permissions. Reconcile the original references before deciding any further payout; retain uncertain funds and attempt history.

The isolated QA project adopted all 16 failures from the first clean-50 sample (13 explicit payer funding rejections and 3 failures without a specific reason), plus one older rejected fixture. The healthy repeat sample received 50 documented $0.02 test ledger credits from persisted native Sandbox evidence, totaling $1. No new provider payments or real emails were sent for this work. Production remains unchanged and automatic sending remains disabled.

## Verification

- `npm run test:payout-funding`: full worker, intercepted provider and temporary PostgreSQL, including same-round pause, continuing accepted reconciliation, old/insufficient evidence, uncertain previous submissions, lost acknowledgements, mirror cases, historical adoption and 50 actual-cost credits.
- `npm run test:payout-funding-ui`: desktop/mobile decision and attribution flow with no external network.
- `npm run test:payout-funding-concurrency -- <postgres-bin> [port]`: requires a running local PostgreSQL. Creates and drops only a randomly named synthetic test database, proving independent connection lock waits, exactly one resume and a subsequent stop episode. Never point it at a hosted or production database.

QA evidence and the review report are kept outside this repository in `outputs/seguimiento-pagos-3-puntos/` in the task workspace. Encrypted credentials stay outside Git. Written commercial PayPal approval and reconciliation with real statements remain separate prerequisites for real-money execution.
