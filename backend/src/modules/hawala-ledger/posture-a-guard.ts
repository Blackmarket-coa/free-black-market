import { createLogger } from "../../shared/logger"
const log = createLogger("modules/hawala-ledger/posture-a-guard")
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
 *
 * `assertRailInvariants` is the entry point that dispatches per rail:
 *   - CCR  → purchase-context check (this file, historical)
 *   - HRS  → time-bank transfer rules
 *   - KARMA → accrual-only (no user-to-user transfers)
 *   - USDC / USD / GIFT → passthrough (cash settlement is governed by
 *                                       dual-rail-selector + Stripe/Stellar)
 */

import { RAIL_REGISTRY, type RailCode } from "./rails"

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
    log.warn(
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

/**
 * Valid reference_types for time-bank (HRS) entries. Hours transfers
 * are bilateral but must always cite the time-bank activity they
 * settle — a loan, a return, or a redistribution among members.
 */
export const TIMEBANK_REFERENCE_TYPES: ReadonlySet<string> = new Set<string>([
  "TIMEBANK_LOAN",
  "TIMEBANK_RETURN",
  "TIMEBANK_REDISTRIBUTION",
  "TIMEBANK_OPEN_BALANCE",
])

/**
 * Issuer entry types for the time-bank rail. Platform-internal
 * issuance / extinguishment (e.g. seeding a new member's opening
 * balance, archiving a withdrawn member's outstanding balance) bypass
 * the reference-type rule the same way CCR's ISSUE/BURN do.
 */
export const HOURS_ISSUER_ENTRY_TYPES: ReadonlySet<string> = new Set<string>([
  "HOURS_OPEN_BALANCE",
  "HOURS_ARCHIVE_BALANCE",
])

/**
 * Assert an HRS (time-bank) transfer is allowed.
 *
 *   - debit and credit accounts must differ (no self-transfer; hours
 *     are a record of work done for someone else).
 *   - the entry must carry a recognized `reference_type` from
 *     `TIMEBANK_REFERENCE_TYPES`, unless the `entry_type` is a
 *     platform-internal issuer operation.
 *   - the amount sign is the caller's responsibility; the guard only
 *     checks shape.
 *
 * Throws `ClosedLoopViolationError` in strict mode, logs in warn,
 * passes in off.
 */
export const assertHoursTransferAllowed = (
  input: TransferGuardInput,
  mode: GuardMode = resolveGuardMode()
): void => {
  if (input.currency_code !== "HRS") return

  if (HOURS_ISSUER_ENTRY_TYPES.has(input.entry_type)) {
    return
  }

  const details = {
    currency_code: input.currency_code,
    entry_type: input.entry_type,
    reference_type: input.reference_type ?? null,
    reference_id: input.reference_id ?? null,
    debit_account_id: input.debit_account_id,
    credit_account_id: input.credit_account_id,
  }

  if (input.debit_account_id === input.credit_account_id) {
    raiseOrWarn(
      mode,
      "Time-bank (HRS) transfer rejected: debit and credit accounts " +
        "are the same. Hours record work done for someone else; a " +
        "self-transfer has no time-bank meaning. " +
        "See docs/POSTURE_A_COMPLIANCE.md § hours rail.",
      details
    )
    return
  }

  const ref = input.reference_type ?? ""
  if (!TIMEBANK_REFERENCE_TYPES.has(ref) || !(input.reference_id ?? "")) {
    raiseOrWarn(
      mode,
      "Time-bank (HRS) transfer rejected: must carry a recognized " +
        "reference_type and reference_id (one of " +
        [...TIMEBANK_REFERENCE_TYPES].join(", ") +
        "). See docs/POSTURE_A_COMPLIANCE.md § hours rail.",
      details
    )
  }
}

/**
 * Assert a KARMA "transfer" is allowed.
 *
 * Karma is non-fungible and not user-to-user transferable: it accrues
 * from system events tied to a single member. The ledger-entry path
 * is therefore the wrong primitive for karma; use the `karma_event`
 * model. This guard rejects every attempt to route a KARMA-coded
 * ledger entry through the standard transfer path.
 */
export const assertKarmaTransferAllowed = (
  input: TransferGuardInput,
  mode: GuardMode = resolveGuardMode()
): void => {
  if (input.currency_code !== "KARMA") return

  const details = {
    currency_code: input.currency_code,
    entry_type: input.entry_type,
    debit_account_id: input.debit_account_id,
    credit_account_id: input.credit_account_id,
  }

  raiseOrWarn(
    mode,
    "Karma is non-fungible and not user-to-user transferable. " +
      "Record karma accruals via the `karma_event` model rather than " +
      "the double-entry ledger transfer path. " +
      "See docs/POSTURE_A_COMPLIANCE.md § karma rail.",
    details
  )
}

const raiseOrWarn = (
  mode: GuardMode,
  message: string,
  details: Record<string, unknown>
): void => {
  if (mode === "off") return
  if (mode === "warn") {
    log.warn(`[hawala-ledger] ${message}`, details)
    return
  }
  throw new ClosedLoopViolationError(message, details)
}

/**
 * Top-level per-rail dispatcher. Service code calls this once per
 * transfer; it routes to the correct rail-specific guard.
 *
 * The dispatcher is intentionally exhaustive over `RAIL_REGISTRY` —
 * adding a rail without giving it a clause here is a compile-time
 * miss (the `unhandled` line throws a runtime error so unknown rails
 * never silently succeed).
 */
export const assertRailInvariants = (
  input: TransferGuardInput,
  mode: GuardMode = resolveGuardMode()
): void => {
  const code = input.currency_code as RailCode
  const def = RAIL_REGISTRY[code]
  if (!def) {
    // Unknown rail — not in the registry. Refuse rather than passthrough,
    // so a typo or a forgotten rail addition surfaces loudly.
    raiseOrWarn(
      mode,
      `Settlement rail "${input.currency_code}" is not registered. ` +
        `Add it to backend/src/modules/hawala-ledger/rails.ts.`,
      {
        currency_code: input.currency_code,
        debit_account_id: input.debit_account_id,
        credit_account_id: input.credit_account_id,
      }
    )
    return
  }

  switch (code) {
    case "CCR":
      assertPurchaseContext(input, mode)
      return
    case "HRS":
      assertHoursTransferAllowed(input, mode)
      return
    case "KARMA":
      assertKarmaTransferAllowed(input, mode)
      return
    case "USD":
    case "USDC":
    case "GIFT":
      // Cash rails (USD/USDC) are governed by the dual-rail selector
      // and Stripe/Stellar paths; ledger-side they're passthrough.
      // GIFT is recorded for audit and never balance-changing.
      return
    default: {
      const unhandled: never = code
      throw new ClosedLoopViolationError(
        `Unhandled rail "${unhandled}" in assertRailInvariants — rails.ts and posture-a-guard.ts have drifted.`,
        { currency_code: input.currency_code }
      )
    }
  }
}
