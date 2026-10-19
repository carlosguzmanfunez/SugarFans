# Earnings calendar: 26–25, Honduras

Approved product rule: earnings accrue from the 26th at 00:00 to the following 26th at 00:00, exclusive. The last included local date is the 25th. Payments for closed cycles may be requested from the 26th through the following 1st, inclusive; the exclusive end is the 2nd at 00:00. Use America/Tegucigalpa (UTC−6), independently of the browser/server zone. These are calendar days.

Example: earnings October 26–November 25 are paid November 26–December 1. Earnings from November 26 belong to the next cycle even while the previous cycle is being paid. This change does not modify subscription renewal dates, reward qualification periods or providers' billing months.

## Transition and balances

The migration creates one read-only calendar settings row and freezes the previous UTC month boundary at migration time. The effective credit cutoff is the later of that frozen boundary and the current cycle start. This preserves previously credited earnings; the frozen boundary must never be reset each month. Reapplying the migration does not change it. No sales, past payouts or payout statuses are rewritten.

Balances retain existing creator shares, platform-covered refunds/disputes, minimums and deductions for sending/paid payouts. Unpaid balances carry forward. Non-covered disputes/refunds reduce earnings and may leave debt after an earlier payout. That debt must not be silently erased. No payout is created by opening a window or changing the date.

The authenticated, SECURITY INVOKER `payout_calendar_policy()` RPC exposes only global calendar metadata. Its backing table has RLS and SELECT-only access for authenticated users; clients cannot change the transition boundary. Internal functions remain unavailable as public RPCs. Unknown calendar configuration disables the payout action rather than substituting an old cutoff.

## Payment execution

Until automatic payouts are separately implemented and validated, the existing manual request remains available only inside the payment window. Both SQL entry points enforce the window using the server clock and retain account locks, verification, suspension/freeze, recipient, in-progress payout and minimum checks. New payouts use a Honduras scheduled date. Confirmation, cancellation and reconciliation of existing payouts are not stopped when the window closes.

**Automatic batch execution is an open critical item.** No cron, batch worker, payment credential or scheduled transfer is enabled by this calendar change. See `docs/operations/automatic-payouts.md`.

## Screens and exports

Creator balances, dashboard/home, admin amounts owed, gifts, registration/help and the existing draft legal text use the same policy. The movement book keeps accounting months as calendar months and adds an explicit current-cycle filter. Book rows and CSV timestamps use UTC−6 explicitly; download filenames use the Honduras date. These are operational movement reports, not a persistent double-entry accounting ledger.

## Rollout and verification

Apply `20261019194731_earnings_calendar_26_25.sql` before deploying the client. Compare current function definitions, snapshot aggregate balances and payout rows, verify the transition cutoff, RLS, grants and function definitions after migration. Then deploy the exact tested commit. The migration does not repair unrelated migration-history gaps.

`npm run test:payout-calendar` executes the actual migration and TS calculations on a throwaway PGlite database with a controlled clock. It covers midnight boundaries, February/leap year/year change, UTC/Honduras/Tokyo independence, transition preservation, equivalent client/server balances, refund/dispute handling, window guards, existing account controls, payout reservations and CSV dates. Minimum/fee/account-check dependencies use fixture implementations; this is not a full production or live-PayPal certification. `e2e/flows.mjs` additionally exercises manual offline payment inside/outside the window.
