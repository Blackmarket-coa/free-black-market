/**
 * Coalition Credits closed-loop guard (Posture A).
 *
 * Under FinCEN's payment-processor exemption (31 CFR 1010.100(ff)(5)),
 * FBM operates as a Payment Facilitator only when:
 *
 *   1. Coalition Credits (CCR) never convert to cash.
 *   2. CCR transfers occur only in a goods-or-services purchase context
 *      (a cart, an order, a refund-of-order, a payout-of-order).
 *   3. No balance-holding outside that purchase-payout context.
 *
 * Crossing those lines turns FBM into a Money Services Business under
 * FinCEN 2019 CVC guidance. This module is the architectural enforcement
 * of (2). See `docs/POSTURE_A_COMPLIANCE.md` for the full frame.
 *
 * The guard is invoked by `HawalaLedgerModuleService.createTransfer` and
 * future CCR-touching public methods. It is **not** a workflow hook
 * because workflow hooks can be bypassed; the service layer is the only
 * line that can reliably refuse to write.
 */

/**
 * Currency code for Coalition Credits across the ledger.
 *
 * The CCR Stellar custom asset is issued with `authorization_required`
 * and `authorization_revocable` so the issuer (FBM operator account) can
 * refuse trustlines from accounts not under platform control.
 */
export const CCR_CURRENCY_CODE = "CCR"

/**
 * Reference types that constitute a valid goods-or-services purchase
 * context. Used by `assertPurchaseContext`.
 *
 * Adding a new value here MUST be reviewed against
 * `docs/POSTURE_A_COMPLIANCE.md` — every additional context expands the
 * surface area where CCR can move and must remain tied to a recorded
 * goods/services transaction.
 */
export const PURCHASE_CONTEXT_REFERENCE_TYPES: ReadonlySet<string> =
  new Set<string>([
    "ORDER",
    "CART",
    "REFUND",
    "PAYOUT",
    "ESCROW_FUND",
    "ESCROW_RELEASE",
    "CREATOR_ATTRIBUTION",
    "SUBSCRIPTION_RENEWAL",
  ])

/**
 * Entry types that are platform-internal issuer operations (mint/burn)
 * and therefore not subject to the purchase-context requirement. These
 * are the FBM-controlled operator → ledger movements that issue or
 * extinguish Credits without a user-to-user transfer.
 */
export const ISSUER_ENTRY_TYPES: ReadonlySet<string> = new Set<string>([
  "ISSUE",
  "BURN",
  "CREDIT_PAYOUT_MINT",
  "CREDIT_REFUND_BURN",
])

export class ClosedLoopViolationError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) {
    super(message)
    this.name = "ClosedLoopViolationError"
  }
}

export type TransferGuardInput = {
  currency_code: string
  entry_type: string
  reference_type?: string | null
  reference_id?: string | null
  order_id?: string | null
  cart_id?: string | null
  debit_account_id: string
  credit_account_id: string
}

export type GuardMode = "strict" | "warn" | "off"

export const resolveGuardMode = (): GuardMode => {
  const raw = (process.env.HAWALA_CCR_GUARD_MODE || "strict").toLowerCase()
  if (raw === "warn" || raw === "off") return raw
  return "strict"
}

/**
 * Assert the transfer is allowed under Posture A.
 *
 * Throws `ClosedLoopViolationError` (in strict mode) or logs a warning
 * (in warn mode) when a CCR-currency transfer lacks a purchase context.
 *
 * Non-CCR currencies are passthrough — guard returns without inspection.
 */
export const assertPurchaseContext = (
  input: TransferGuardInput,
  mode: GuardMode = resolveGuardMode()
): void => {
  if (input.currency_code !== CCR_CURRENCY_CODE) {
    return
  }

  // Issuer operations are platform-internal mint/burn flows.
  if (ISSUER_ENTRY_TYPES.has(input.entry_type)) {
    return
  }

  const hasOrder = Boolean(input.order_id)
  const hasCart = Boolean(input.cart_id)
  const referenceType = input.reference_type ?? ""
  const referenceId = input.reference_id ?? ""
  const hasPurchaseReference =
    PURCHASE_CONTEXT_REFERENCE_TYPES.has(referenceType) &&
    referenceId.length > 0

  if (hasOrder || hasCart || hasPurchaseReference) {
    return
  }

  const details = {
    currency_code: input.currency_code,
    entry_type: input.entry_type,
    reference_type: input.reference_type ?? null,
    reference_id: input.reference_id ?? null,
    order_id: input.order_id ?? null,
    cart_id: input.cart_id ?? null,
    debit_account_id: input.debit_account_id,
    credit_account_id: input.credit_account_id,
  }

  if (mode === "off") {
    return
  }

  if (mode === "warn") {
    console.warn(
      "[hawala-ledger] Posture A closed-loop violation (warn mode): " +
        "CCR transfer outside a goods/services purchase context. " +
        "See docs/POSTURE_A_COMPLIANCE.md.",
      details
    )
    return
  }

  throw new ClosedLoopViolationError(
    "Coalition Credits transfer rejected: no goods/services purchase context. " +
      "CCR is a closed-loop asset under Posture A. Attach order_id, cart_id, " +
      "or a recognized purchase reference_type. " +
      "See docs/POSTURE_A_COMPLIANCE.md.",
    details
  )
}
