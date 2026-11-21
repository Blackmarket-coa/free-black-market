/**
 * Vendor-to-vendor money that stays off until an operator and counsel decide.
 *
 * Two paths move a vendor's USD earnings to another vendor with no order
 * behind the movement, behind seller authentication alone:
 *
 * - **Subcontract escrow.** `openSubcontractEscrow` debits the buyer-vendor's
 *   SELLER_EARNINGS into a per-subcontract ESCROW account and
 *   `releaseSubcontractEscrow` pays it to the service vendor (both
 *   `reference_type: "MANUAL"`, `order_id: null`). The subcontract's
 *   `parent_order_id` is a string nobody checks.
 * - **Creator reward pools.** `fundCreatorRewardPool` moves a vendor's
 *   earnings into a pool and `creditCreatorReward` pays creators out of it;
 *   a daily job distributes, and nothing refunds a pool.
 *
 * Neither ever ran on a database built from the migrations: their rows
 * (`service_contract`, `order_subcontract`, `reward_pool`, `reward_payout`)
 * could not be inserted until SD-63's `raw_*` migrations. Those migrations
 * would have switched both on by deploying; these switches keep that an
 * explicit decision. Each is dark unless its variable is the literal `1`,
 * like `FBM_CAMPAIGN_ESCROW_LIVE` (lib/campaign-escrow.ts).
 *
 * The refusal lives in the ledger methods themselves (CLAUDE.md rule 3: a
 * route or a job can be bypassed, the service layer is the only place that
 * can reliably refuse to write). The routes and the job check the same switch
 * first so that nothing is written before the refusal: no proposed
 * subcontract, no unfunded pool, no payout rows.
 *
 * How these relate to `shared/vendor-to-vendor-payments.ts` (SD-156,
 * `VENDOR_TO_VENDOR_PAYMENTS_DECIDED`): that constant is the one switch for
 * the direct transfer, `createVendorToVendorPayment`, which
 * `POST /vendor/pos/checkout` and `POST /vendor/hawala/payments` make; those
 * two routes refuse it, and the service method itself does not. The switches
 * here cover different ledger methods (escrow under a service contract, and a
 * creator program's reward pool), so no transfer sits behind two switches, and
 * turning one on leaves the other two off. All three wait on the same kind of
 * decision, by an operator and counsel (Posture A), and whoever makes it
 * should make it for each. SD-156's list of transfers it looked at does not
 * name these two; neither had a working insert on a migrated database when it
 * was written. The difference in form is deliberate: that switch is a
 * constant, so only a code change turns it on; these are environment
 * variables, as `FBM_CAMPAIGN_ESCROW_LIVE` is, read on every call.
 */

export const SUBCONTRACT_ESCROW_FLAG = "FBM_SUBCONTRACT_ESCROW_LIVE"
export const CREATOR_REWARD_POOLS_FLAG = "FBM_CREATOR_REWARD_POOLS_LIVE"

export function isSubcontractEscrowLive(): boolean {
  return process.env[SUBCONTRACT_ESCROW_FLAG] === "1"
}

export function isCreatorRewardPoolsLive(): boolean {
  return process.env[CREATOR_REWARD_POOLS_FLAG] === "1"
}

/** What a route answers while a switch is off: 404, as the repo's other dark features do. */
export const SUBCONTRACT_ESCROW_OFF_MESSAGE = "Service subcontracts are not available"
export const CREATOR_REWARD_POOLS_OFF_MESSAGE = "Creator reward pools are not available"

export class VendorTransferOffError extends Error {
  readonly type = "feature_disabled"

  constructor(
    message: string,
    readonly flag: string
  ) {
    super(`${message} (${flag} is not on)`)
    this.name = "VendorTransferOffError"
  }
}

export function assertSubcontractEscrowLive(): void {
  if (!isSubcontractEscrowLive()) {
    throw new VendorTransferOffError(SUBCONTRACT_ESCROW_OFF_MESSAGE, SUBCONTRACT_ESCROW_FLAG)
  }
}

export function assertCreatorRewardPoolsLive(): void {
  if (!isCreatorRewardPoolsLive()) {
    throw new VendorTransferOffError(CREATOR_REWARD_POOLS_OFF_MESSAGE, CREATOR_REWARD_POOLS_FLAG)
  }
}
