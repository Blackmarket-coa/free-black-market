# Scheduled Jobs

Medusa scheduled jobs for FBM. Each file exports a handler plus a cron
`schedule`. (Generic how-to: <https://docs.medusajs.com/learn/fundamentals/scheduled-jobs>.)

## Inventory

| Job | Schedule | Purpose |
| --- | --- | --- |
| `activate-rentals.ts` | daily 00:00 | Activate rentals whose start date has arrived |
| `asset-graph-settlement-reconciler.ts` | every 15 min | Write asset-graph settlement records into hawala-ledger / karma events |
| `attribution-fraud-sweep.ts` | every 10 min | Flag suspicious creator-attribution activity |
| `content-platform-metrics-poll.ts` | every 15 min | Poll external content-platform metrics for creators |
| `creator-attribution-approve-held.ts` | hourly | Auto-approve held creator attributions past their review window |
| `creator-rewards-pool-close.ts` | daily 01:30 | Close and settle creator reward pools |
| `demand-pool-expiry.ts` | hourly | Expire lapsed demand pools |
| `donation-batch-disbursement.ts` | Mondays 03:00 | Disburse accrued donations via the fiscal sponsor (see `docs/POSTURE_A_COMPLIANCE.md`) |
| `drain-webhook-deliveries.ts` | every minute | Deliver queued marketplace webhook events |
| `hawala-balance-reconciler.ts` | every 6 h | Internal integrity sweep: recompute cached account balances from the entry log and warn on drift (read-only, never auto-corrects) |
| `hawala-external-reconciliation.ts` | daily 01:30 | Pull Stripe payouts/balance transactions and Stellar payments, then match them against ledger entries with the active matching rules (read-only over money: writes match/ingest records only) |
| `hawala-monitor-sweep.ts` | every 15 min | Backstop evaluation of balance monitors (edge-triggered; primary path runs after each transfer) |
| `hawala-settlement.ts` | daily 00:00 | Settle pending ledger entries out to payout rails |
| `inventory-reconciliation.ts` | daily 03:00 | Reconcile inventory levels across sync sources |
| `order-cycle-status-update.ts` | every 5 min | Advance order-cycle (CSA) lifecycle states |
| `patronage-refund.ts` | quarterly (daily fallback without Redis) | Return commission surplus to vendors weighted by paid commission |
| `process-subscription-renewals.ts` | hourly | Renew due subscriptions |
| `recompute-opportunity-scores.ts` | every 6 h | Refresh opportunity-engine scores |
| `review-request-emails.ts` | daily 14:00 | Send post-purchase review request emails |
| `supplier-forwarding-retries.ts` | every 5 min | Retry failed supplier-forwarding submissions |
| `sync-woocommerce-inventory.ts` | daily 02:00 | Pull inventory updates from linked WooCommerce stores |
| `wellness-reminders.ts` | hourly | Send wellness-program reminders |
| `xp-demurrage.ts` | Sundays 03:00 | Apply XP demurrage decay (see `docs/adr/ADR-0003-xp-demurrage-and-soulbound-semantics.md`) |

When adding a job, add a row here and note money-touching behavior against
`docs/POSTURE_A_COMPLIANCE.md`.
