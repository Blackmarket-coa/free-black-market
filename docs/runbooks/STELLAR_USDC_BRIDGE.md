# Stellar/USDC Settlement Bridge

**Last validated:** _testnet validation only; mainnet cutover is staged but not executed in this repository_.

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §1.3 (Coalition Credits as cross-platform settlement layer), §5.1 (foundation milestone), and §7.2 (new runbooks required by the consolidation).

This runbook covers the operational lifecycle of the Stellar/USDC bridge that anchors `hawala-ledger` settlement batches on-chain. The bridge is implemented in `backend/src/modules/hawala-ledger/stellar-settlement.ts` and consumed by `backend/src/jobs/hawala-settlement.ts`.

The current scope is **ops-readiness without mainnet cutover**: the code paths handle retry/backoff, dual-rail selection, and emit structured metrics; the runbook documents the mainnet steps without provisioning live keys here.

## Architecture

The bridge does two distinct things on Stellar:

1. **Anchor settlement batches** via `manageData` operations carrying a Merkle root of every entry in the batch. This is auditable, immutable, and cheap — anyone can later verify a batch by re-computing the Merkle root and looking up the on-chain key `hawala_batch_<batch_id>`.
2. **Move USDC value** between Stellar accounts via `payment` operations (the `processUsdcPayment` path in `stellar-settlement.ts`). This is the actual settlement leg used when the dual-rail selector picks Stellar over Stripe-ACH.

The dual-rail selector lives at `backend/src/modules/hawala-ledger/dual-rail-selector.ts`. It picks Stripe-ACH or Stellar-USDC for each settlement based on currency, amount, Horizon reachability, last-batch status, and bridge USDC liquidity. The decision is logged on every run; operators can override via the `forceRail` parameter.

## Mainnet config checklist

When ready to cut over from testnet to mainnet, work through this list and check off each step in the operations channel:

- [ ] Generate a fresh signer keypair using `Keypair.random()` in a clean offline environment. Do **not** reuse the testnet keypair.
- [ ] Store the secret in the chosen secrets manager per [`SECRETS_MANAGER_MIGRATION.md`](./SECRETS_MANAGER_MIGRATION.md). The signer secret never touches `.env` files outside the manager.
- [ ] Fund the new signer account with at least 5 XLM (`createAccount` minimum + headroom for trustlines + fees) using a fresh transfer from a funded mainnet account.
- [ ] Add the USDC trustline using `addUsdcTrustline()` against the Circle mainnet issuer (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`). Verify the trustline appears in `account.balances`.
- [ ] Top the bridge wallet with the operator-decided opening USDC balance (typical recommendation: enough for one week of expected settlement volume + 25% headroom).
- [ ] Update production env to set `STELLAR_NETWORK=mainnet`, `STELLAR_HORIZON_URL=https://horizon.stellar.org`, and `STELLAR_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`.
- [ ] Flip `ENABLE_STELLAR_SETTLEMENT=true` in production.
- [ ] Run a smoke settlement (1.00 USDC) against the bridge wallet's own address. Confirm Horizon reports the transaction, Merkle root anchored matches the local computation, and the dual-rail selector picked `stellar_usdc`.
- [ ] Update this runbook's "Last validated" line with the date and the smoke-settlement transaction hash.

## Key rotation SOP

Cadence: **at least every 90 days**, plus immediately on any suspected exposure.

Procedure:

1. Generate the new keypair offline.
2. Fund the new account with 5 XLM and add the USDC trustline (steps from the cutover checklist).
3. Open a maintenance window (settlement job pauses cleanly because each batch completes inside one job tick).
4. Drain the old wallet by calling `processUsdcPayment` to the new wallet for the full USDC balance, then sweep XLM with a `mergeAccount` operation if you want to fully retire the old account.
5. Update the secrets manager with the new signer secret.
6. Restart the FBM backend so `createStellarSettlementService()` picks up the new env-driven secret.
7. Run the same smoke settlement from the cutover checklist to confirm the new wallet is operational.
8. Record the rotation in the operations log; add the old wallet's tx history to the audit trail before retiring it.

## Failed-tx triage

The `submitSettlementBatch` and `processUsdcPayment` paths wrap Horizon calls in a 3-attempt exponential-backoff retry. After all three attempts, the function throws and the job sets the batch to `FAILED` with the error in `metadata`. The `stellar.submit.failure` counter increments.

When you see a `FAILED` batch:

1. Check the failure metric label (`op`) to see whether it was a settlement anchor or a USDC payment.
2. Look at the Horizon response code captured in the batch metadata. Common cases:
   - `tx_insufficient_balance`: bridge wallet ran out of XLM for fees. Fund and retry.
   - `op_no_trust`: destination has not added the USDC trustline. Coordinate with the recipient.
   - `tx_too_late`: clock skew or Horizon delay; usually transient.
   - `tx_bad_seq`: someone else used the same source account in parallel; check for a stuck transaction.
3. If transient, requeue the batch via the admin route (`POST /admin/hawala/settlements/:id/retry`).
4. If non-transient, fix the root cause, then requeue.

The settlement job will not auto-retry a `FAILED` batch on the next tick; this is intentional so a wedged batch does not consume retry budget.

## Liquidity provisioning

The dual-rail selector forces Stripe-ACH whenever the bridge's USDC balance is below the requested settlement amount. Bridge balances should be monitored and topped up before liquidity becomes the binding constraint.

Cadence: **weekly review** with a top-up target of one full settlement period of expected volume + 25% headroom.

Top-up procedure:

1. Move USDC from the operator-controlled treasury account to the bridge wallet using a standard Stellar payment (Lobstr, Solar, or `processUsdcPayment` from a funded sister account).
2. Confirm the bridge wallet's `getUsdcBalance()` reflects the new total before the next settlement tick.
3. Log the top-up in the operations channel with the source tx hash so the audit trail is complete.

## Multi-sig governance (deferred)

The bridge wallet is a single-sig wallet today. Multi-sig is the right pattern once settlement volume is meaningful enough that a single-key compromise is a material risk. This is **deferred to differentiation milestone** per the foundation-milestone scope; tracking issue should be filed when the volume crosses the operator's risk threshold.

When the time comes, the migration is:

1. Add additional signers via `setOptions` raising the master weight or adding cosigners.
2. Update the FBM backend to construct multi-sig transactions (the SDK supports this natively).
3. Re-run the cutover smoke test with the new threshold.

## Settlement monitoring

Counters emitted by `stellar-settlement.ts` (current implementation logs structured JSON; swap for `prom-client` once a dependency bump lands):

- `stellar.submit.success` — successful submission (batch anchor or USDC payment), labels: `op`, `batch_id` or `destination`.
- `stellar.submit.failure` — submission failed after all retries, labels: `op`, `batch_id` or `destination`.
- `stellar.submit.retry` — single retry attempt, labels: `op`, `attempt`, `is_final`.
- `stellar.submit.retry_recovered` — submission succeeded after one or more retries, labels: `op`, `attempt`.
- `stellar.dual_rail_decision` — emitted from the settlement job, labels: `rail` (`stripe_ach` or `stellar_usdc`), `batch_id`.

Every counter is JSON-shaped on stderr today, so a `grep '"metric":' | jq .` produces a clean event stream until the metrics backend is wired in.

## Standards alignment

The bridge runbook intentionally uses terminology from Stellar's Standards documents so any operator familiar with the ecosystem can reason about it without a glossary:

- **SEP-1** — operational metadata for the issuer; we don't ship a `stellar.toml` today but the runbook acknowledges the convention.
- **SEP-24** — interactive deposits/withdrawals between fiat and Stellar tokens. The dual-rail selector's Stripe-ACH leg is conceptually a SEP-24 off-ramp implemented with Stripe instead of an anchor protocol; the runbook follows SEP-24's vocabulary (anchor, trust, fee transparency).
- **SEP-31** — direct payment between anchors. Not used today; called out so future bridge-to-bridge work has a starting reference.

## See also

- [`SECRETS_MANAGER_MIGRATION.md`](./SECRETS_MANAGER_MIGRATION.md) — where the signer secret should live.
- [`MXID_VENDOR_BACKFILL.md`](./MXID_VENDOR_BACKFILL.md) — vendor identity prerequisite for routing settlements to the right account.
- `backend/src/modules/hawala-ledger/stellar-settlement.ts` — implementation.
- `backend/src/modules/hawala-ledger/dual-rail-selector.ts` — selection logic.
- `backend/src/modules/hawala-ledger/health.ts` — health snapshot helper.
- `backend/src/jobs/hawala-settlement.ts` — daily settlement job consuming both.
