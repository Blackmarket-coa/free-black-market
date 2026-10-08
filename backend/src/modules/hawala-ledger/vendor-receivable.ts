/**
 * Vendor refund receivable: a card refund that lands after the vendor was
 * paid out (SD-40; operator answer 2026-10-06: "the vendor owes it" —
 * recovered from their next sales and before any payout, forgiven after 180
 * days).
 *
 * The problem it closes. Stripe refunds a card order from FBM's own Stripe
 * balance, whenever the operator issues it — including after the vendor's
 * earnings for that order have left the ledger. The ledger refunds a card
 * order by taking the vendor's balancing leg back from their earnings; with
 * the earnings gone, that leg cannot post, and before this the whole refund
 * was refused before any leg and retried by the reconciler forever. The
 * customer had their money back; the ledger never said so, and nothing
 * recorded that the vendor now owes it.
 *
 * Now the refund ALWAYS posts for a card order. Whatever the vendor's
 * earnings cannot cover is funded in this order:
 *
 *   1. the order's retained card processing, as before (a
 *      CARD_PROCESSING_SHORTFALL_LEG from the card-processing account,
 *      `./card-processing.ts`), up to what that order retained;
 *   2. the rest from the VENDOR_RECEIVABLE account: entry_type ADJUSTMENT,
 *      VENDOR_RECEIVABLE -> ESCROW, `metadata.leg = VENDOR_REFUND_SHORTFALL_LEG`,
 *      naming the seller account that owes it (`owed_by_account_id`).
 *
 * Both are receivables from the vendor and are recovered by the same
 * machinery, oldest first, whichever kind (`recoverCardProcessingShortfall`):
 * 100% of each later seller credit, then the outflow backstop before any
 * payout or vendor-to-vendor payment. A recovery always repays the account
 * that funded the shortfall, so a VENDOR_REFUND_RECOVERY_LEG is
 * SELLER_EARNINGS -> VENDOR_RECEIVABLE. The 180-day write-off by age applies
 * to both kinds (CARD_PROCESSING_WRITE_OFF_DAYS, from the refund).
 *
 * The account. Like card clearing (`./card-clearing.ts`), it is allowed
 * below zero, because it stands for money the platform is owed rather than
 * money it holds: its balance reads as minus what vendors owe in refunds
 * (including what was written off, which the platform absorbed). The
 * permission is narrow and enforced at the money-movement chokepoint
 * (`createTransfer`), not by callers:
 *
 *   - Only `account_type` VENDOR_RECEIVABLE, owner SYSTEM / `vendor_refunds`,
 *     USD only.
 *   - Out of it (taking it further below zero): ADJUSTMENT into the order
 *     escrow, naming its order, stamped VENDOR_REFUND_SHORTFALL_LEG.
 *   - Into it (bringing it back toward zero): ADJUSTMENT from a USD
 *     SELLER_EARNINGS account, stamped VENDOR_REFUND_RECOVERY_LEG. Never
 *     above zero — the balance update itself refuses it (`balance + delta
 *     <= 0`), so a recovery can never mint a positive balance here.
 *   - Nothing else may touch it.
 *
 * Posture A: USD only, inside a refund-of-order context; the receivable is a
 * record of what a vendor owes on a refunded order and is only ever repaid
 * out of that vendor's later earnings. It holds no balance for anyone and
 * pays nothing out. CCR is never touched (docs/POSTURE_A_COMPLIANCE.md,
 * "Vendor refund receivable").
 *
 * A wallet-funded order (not card) is unchanged: its refund is still refused
 * when the vendor cannot cover it.
 *
 * The dispute fee (operator answer 2026-10-07: "the vendor whose order was
 * disputed owes it", recovered like a refund they owe). Stripe takes a fee
 * from FBM's balance when a cardholder disputes a charge, and never returns
 * it, win or lose (outside Mexico; docs.stripe.com/disputes/how-disputes-work).
 * That is money Stripe kept, like card processing, so it is recorded the way
 * the ledger already records money Stripe keeps: into the card-processing
 * account (`./card-processing.ts`). The vendor owes it, so the receivable
 * funds it:
 *
 *   - Out of the receivable, a third shape: ADJUSTMENT, VENDOR_RECEIVABLE ->
 *     the card-processing account (PLATFORM_FEE / SYSTEM / `processing`,
 *     USD), stamped VENDOR_DISPUTE_FEE_LEG, naming the disputed charge
 *     (`metadata.stripe_charge_id`) and the order (`reference_type` ORDER,
 *     `reference_id`) — deliberately NOT `order_id`, so nothing that lists an
 *     order's own legs (a refund, a settlement check) ever sees or reverses
 *     it, the way a recovery leg carries none.
 *   - Repaid like a refund receivable: SELLER_EARNINGS -> VENDOR_RECEIVABLE,
 *     VENDOR_REFUND_RECOVERY_LEG, by the same recovery machinery, oldest
 *     first, and forgiven at the same age.
 *   - Only FBM's own code can write it. Because the leg carries no
 *     `order_id`, the order and charge are named in a dedicated top-level
 *     `createTransfer` field (`vendor_dispute_fee`) that no HTTP route
 *     forwards, and must match what the leg names.
 *
 * Every receivable leg is internal-only (`assertReceivableLegTagAllowed`).
 * The admin manual-transfer route (`POST /admin/hawala/transfers`) passes
 * caller-supplied metadata and references through to `createTransfer`, and
 * a receivable is recognised by its `metadata.leg` tag. So with a tag alone,
 * a request could have recorded a debt against any vendor — collected from
 * their next earnings and payouts — or repaid one, or minted a dispute fee.
 * Each of the five receivable tags (the two shortfall tags, the two recovery
 * tags, the dispute fee) is therefore refused unless the caller passes the
 * top-level `receivable_leg: true`, which only the ledger service's own
 * shortfall, recovery and dispute-fee writers set and no HTTP route
 * forwards. Found by the adversarial review of SD-44.
 */

export const VENDOR_RECEIVABLE_ACCOUNT_TYPE = "VENDOR_RECEIVABLE"
export const VENDOR_RECEIVABLE_OWNER_ID = "vendor_refunds"
export const VENDOR_REFUND_SHORTFALL_LEG = "vendor_refund_shortfall"
export const VENDOR_REFUND_RECOVERY_LEG = "vendor_refund_recovery"
export const VENDOR_DISPUTE_FEE_LEG = "vendor_dispute_fee"

/**
 * Where a dispute fee goes: the card-processing account. Spelled out here
 * rather than imported, because `./card-processing.ts` imports this file; a
 * unit test pins it to CARD_PROCESSING_ACCOUNT_TYPE / CARD_PROCESSING_OWNER_ID.
 */
export const DISPUTE_FEE_SINK = { account_type: "PLATFORM_FEE", owner_id: "processing" } as const

/**
 * Every `metadata.leg` tag that records or repays a debt a vendor owes. The
 * two card-processing tags are spelled out (the import-cycle reason above);
 * a unit test pins them to `./card-processing.ts`.
 */
export const RECEIVABLE_LEG_TAGS: ReadonlySet<string> = new Set([
  "card_processing_vendor_shortfall",
  "card_processing_vendor_recovery",
  VENDOR_REFUND_SHORTFALL_LEG,
  VENDOR_REFUND_RECOVERY_LEG,
  VENDOR_DISPUTE_FEE_LEG,
])

/**
 * Refuse a receivable leg written by anything but the ledger service's own
 * writers (`receivable_leg: true`, a top-level `createTransfer` field no HTTP
 * route forwards). Called by `createTransfer` before anything is written,
 * whatever the leg's accounts.
 */
export function assertReceivableLegTagAllowed(leg: {
  entry_type?: string
  metadata?: unknown
  receivable_leg?: boolean | null
}): void {
  const tag = legTag(leg.metadata)
  if (typeof tag === "string" && RECEIVABLE_LEG_TAGS.has(tag) && leg.receivable_leg !== true) {
    throw new VendorReceivableLegError(
      `Receivable leg refused: a "${tag}" leg is written only by the ledger's own refund, recovery and dispute-fee paths`,
      { entry_type: leg.entry_type ?? null, leg: tag }
    )
  }
}

export class VendorReceivableLegError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) {
    super(message)
    this.name = "VendorReceivableLegError"
  }
}

type AccountLike = {
  id: string
  account_type?: string | null
  owner_type?: string | null
  owner_id?: string | null
  currency_code?: string | null
}

export function isVendorReceivableAccount(account: AccountLike | null | undefined): boolean {
  return account?.account_type === VENDOR_RECEIVABLE_ACCOUNT_TYPE
}

const legTag = (metadata: unknown) => (metadata as { leg?: unknown } | null | undefined)?.leg

/** True for a leg that records a refund a vendor's earnings could not cover. */
export function isVendorRefundShortfallLeg(entry: { entry_type?: string | null; metadata?: unknown }): boolean {
  return entry.entry_type === "ADJUSTMENT" && legTag(entry.metadata) === VENDOR_REFUND_SHORTFALL_LEG
}

/** True for a leg that records a dispute fee a vendor owes. */
export function isVendorDisputeFeeLeg(entry: { entry_type?: string | null; metadata?: unknown }): boolean {
  return entry.entry_type === "ADJUSTMENT" && legTag(entry.metadata) === VENDOR_DISPUTE_FEE_LEG
}

/** True for a leg that repays (part of) a vendor refund receivable. */
export function isVendorRefundRecoveryLeg(entry: { entry_type?: string | null; metadata?: unknown }): boolean {
  return entry.entry_type === "ADJUSTMENT" && legTag(entry.metadata) === VENDOR_REFUND_RECOVERY_LEG
}

/**
 * Which side of a leg is the receivable account, and so how its balance may
 * move: `debit` may go further below zero, `credit` may come back toward
 * zero but never above it. `none` for a leg that does not touch it.
 */
export type VendorReceivableSide = "none" | "debit" | "credit"

/**
 * Refuse every leg touching the receivable account that is not one of the
 * three allowed shapes. Called by `createTransfer` before anything is written.
 */
export function assertVendorReceivableLeg(
  leg: {
    entry_type: string
    order_id?: string | null
    reference_type?: string | null
    reference_id?: string | null
    metadata?: unknown
    /** The internal-only dispute-fee field (`createTransfer`'s `vendor_dispute_fee`). */
    vendor_dispute_fee?: { order_id?: unknown; stripe_charge_id?: unknown } | null
  },
  debit: AccountLike,
  credit: AccountLike
): { side: VendorReceivableSide; receivableAccountId: string | null } {
  const debitIs = isVendorReceivableAccount(debit)
  const creditIs = isVendorReceivableAccount(credit)
  if (legTag(leg.metadata) === VENDOR_DISPUTE_FEE_LEG && !leg.vendor_dispute_fee) {
    throw new VendorReceivableLegError(
      "Vendor-receivable leg refused: a dispute fee is written only by FBM's own dispute-fee path",
      { entry_type: leg.entry_type, debit_account_id: debit.id, credit_account_id: credit.id }
    )
  }
  if (!debitIs && !creditIs) {
    if (leg.vendor_dispute_fee) {
      throw new VendorReceivableLegError("Vendor-receivable leg refused: a dispute fee must come out of the vendor receivable", {
        entry_type: leg.entry_type,
        debit_account_id: debit.id,
        credit_account_id: credit.id,
      })
    }
    return { side: "none", receivableAccountId: null }
  }

  const receivable = debitIs ? debit : credit
  const other = debitIs ? credit : debit
  const details = {
    entry_type: leg.entry_type,
    order_id: leg.order_id ?? null,
    leg: legTag(leg.metadata) ?? null,
    debit_account_id: debit.id,
    credit_account_id: credit.id,
  }
  const refuse = (why: string): never => {
    throw new VendorReceivableLegError(`Vendor-receivable leg refused: ${why}`, details)
  }

  if (debitIs && creditIs) refuse("both sides are the vendor receivable")
  if (
    receivable.owner_type !== "SYSTEM" ||
    receivable.owner_id !== VENDOR_RECEIVABLE_OWNER_ID ||
    String(receivable.currency_code ?? "").toUpperCase() !== "USD"
  ) {
    refuse("only the SYSTEM-owned USD vendor-receivable account may be used")
  }
  if (leg.entry_type !== "ADJUSTMENT") refuse("only an ADJUSTMENT may touch the vendor receivable")

  if (leg.vendor_dispute_fee && !(debitIs && legTag(leg.metadata) === VENDOR_DISPUTE_FEE_LEG)) {
    refuse("a dispute fee must leave the vendor receivable, tagged as one")
  }
  if (debitIs && legTag(leg.metadata) === VENDOR_DISPUTE_FEE_LEG) {
    if (leg.order_id) refuse("a dispute fee names its order by reference, never by order_id")
    if (leg.reference_type !== "ORDER" || !leg.reference_id) refuse("a dispute fee must name its order")
    const charge = (leg.metadata as { stripe_charge_id?: unknown } | null | undefined)?.stripe_charge_id
    if (typeof charge !== "string" || !charge) refuse("a dispute fee must name the disputed charge")
    const internal = leg.vendor_dispute_fee
    if (!internal || internal.order_id !== leg.reference_id || internal.stripe_charge_id !== charge) {
      refuse("the dispute fee's order and charge must match what the leg names")
    }
    if (
      other.account_type !== DISPUTE_FEE_SINK.account_type ||
      other.owner_type !== "SYSTEM" ||
      other.owner_id !== DISPUTE_FEE_SINK.owner_id ||
      String(other.currency_code ?? "").toUpperCase() !== "USD"
    ) {
      refuse("a dispute fee must go to the card-processing account")
    }
    return { side: "debit", receivableAccountId: receivable.id }
  }

  if (debitIs) {
    if (legTag(leg.metadata) !== VENDOR_REFUND_SHORTFALL_LEG) {
      refuse("money leaves the vendor receivable only as a refund shortfall or a dispute fee")
    }
    if (!leg.order_id) refuse("a refund shortfall must name its order")
    if (other.account_type !== "ESCROW" || other.owner_type !== "SYSTEM" || other.owner_id !== "system") {
      refuse("a refund shortfall must fund the order escrow")
    }
    return { side: "debit", receivableAccountId: receivable.id }
  }

  if (legTag(leg.metadata) !== VENDOR_REFUND_RECOVERY_LEG) {
    refuse("money returns to the vendor receivable only as a recovery")
  }
  if (
    other.account_type !== "SELLER_EARNINGS" ||
    other.owner_type !== "SELLER" ||
    String(other.currency_code ?? "").toUpperCase() !== "USD"
  ) {
    refuse("a recovery must come from a USD seller earnings account")
  }
  return { side: "credit", receivableAccountId: receivable.id }
}
