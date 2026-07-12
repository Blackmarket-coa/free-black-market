/**
 * Pure argument-builders for the Blackout emitter wirings (§2/§3). Kept free of
 * any container / DB access so the "should we emit, and with what payload"
 * decision is unit-testable; the subscriber/job glue performs the I/O
 * (identity resolution, account lookup) and calls the matching emit helper in
 * `blackout-stub-emitters.ts` with these args.
 */

/** Owner types on a ledger account that represent a vendor-side balance. */
export const VENDOR_OWNER_TYPES = ["SELLER", "PRODUCER", "CREATOR"] as const

export type ReferralAttribution = {
  id: string
  commission_amount_cents: number | string
  currency_code?: string | null
}

/**
 * Build the `emitReferralAttributed` args from a held creator attribution.
 * `grossCents` carries the commission the referrer earned (integer cents).
 */
export function buildReferralAttributedArgs(args: {
  userId: string
  orderId: string
  attribution: ReferralAttribution
}): {
  userId: string
  grossCents: number
  currency: string
  fbmOrderId: string
  referralId: string
} {
  return {
    userId: args.userId,
    grossCents: Math.round(Number(args.attribution.commission_amount_cents) || 0),
    currency: (args.attribution.currency_code || "usd").toLowerCase(),
    fbmOrderId: args.orderId,
    referralId: args.attribution.id,
  }
}

export type SettledLedgerEntry = {
  id: string
  order_id?: string | null
  amount: number | string
  currency_code?: string | null
}

export type LedgerOwnerAccount = {
  owner_type?: string | null
  owner_id?: string | null
}

export type UsdcConvertedArgs = {
  vendorId: string
  orderId: string
  amountMinorUnits: number
  currency: string
  ledgerTxId: string
}

/**
 * Decide whether a settled ledger entry represents a vendor's per-order USDC
 * conversion worth reporting to Blackout, and build the emit args if so.
 * Returns null when the entry has no order context or the credited account is
 * not a vendor-owned balance (platform/system/customer legs are skipped) — so
 * the settlement job only emits `ledger.usdc_converted` for real vendor
 * proceeds.
 */
export function buildUsdcConvertedArgs(args: {
  entry: SettledLedgerEntry
  creditAccount: LedgerOwnerAccount | null | undefined
  ledgerTxId: string
}): UsdcConvertedArgs | null {
  const { entry, creditAccount, ledgerTxId } = args

  if (!entry.order_id) {
    return null
  }
  const ownerType = creditAccount?.owner_type ?? ""
  const ownerId = creditAccount?.owner_id ?? ""
  if (!ownerId || !VENDOR_OWNER_TYPES.includes(ownerType as never)) {
    return null
  }

  const amountMinorUnits = Math.round((Number(entry.amount) || 0) * 100)
  if (amountMinorUnits <= 0) {
    return null
  }

  return {
    vendorId: ownerId,
    orderId: entry.order_id,
    amountMinorUnits,
    currency: (entry.currency_code || "USD").toUpperCase(),
    ledgerTxId,
  }
}
