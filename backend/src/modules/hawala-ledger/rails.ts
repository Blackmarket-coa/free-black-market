/**
 * Settlement rail registry — single source of truth.
 *
 * Six rails clear through hawala-ledger:
 *
 *   CCR    Coalition Credits.   Closed-loop, on-chain (Stellar custom
 *                               asset), tied to goods/services context
 *                               (Posture A).
 *   USDC   USD Coin.            Cash-convertible, Stellar.
 *   USD    Fiat.                Cash, Stripe ACH edge.
 *   KARMA  Member karma.        Non-fungible accrual; not user-to-user.
 *   HRS    Time-bank hours.     Closed-loop, member-to-member, time-bank.
 *   GIFT   Non-settling.        Recorded as zero-value flow for audit.
 *
 * Until this file existed, those properties lived in scattered places —
 * `posture-a-guard.ts` knew about CCR, `dual-rail-selector.ts` implicitly
 * assumed USD/USDC, asset-graph's SettlementRecord knew the codes as
 * strings. This module is the canonical registry. Other modules (the
 * Posture A guard, the dual-rail selector, the matcher, asset-graph's
 * SettlementRecord emitter) should reach this registry rather than
 * hard-coding rail names.
 *
 * The asset-graph manifest catalog uses the lowercase enum values from
 * `manifests/types.ts`. `RAIL_CODE_BY_MANIFEST_RAIL` translates.
 *
 * See `docs/POSTURE_A_COMPLIANCE.md` and `docs/ASSET_GRAPH.md`.
 */

export type RailCode = "CCR" | "USDC" | "USD" | "KARMA" | "HRS" | "GIFT"

/** Lowercase rail vocabulary used by the asset-graph manifest catalog. */
export type ManifestRail =
  | "ccr"
  | "usdc"
  | "usd"
  | "karma"
  | "hours"
  | "gift"

/**
 * Per-rail invariants. The Posture A guard, the dual-rail selector,
 * and any future executor read these to decide what's allowed.
 */
export type RailDefinition = {
  code: RailCode
  /** Asset-graph manifest vocabulary. */
  manifest_code: ManifestRail
  display_name: string
  /**
   * Cash-convertible: a holder can redeem the balance for fiat through
   * the platform. Setting this true is what would turn the platform
   * into a Money Services Business — only USD/USDC have it.
   */
  cash_convertible: boolean
  /**
   * Transfers require a goods-or-services purchase context
   * (cart/order/refund/payout). CCR-only today; the closed-loop
   * Posture A guard enforces it.
   */
  requires_purchase_context: boolean
  /**
   * Bilateral user-to-user transfers are allowed. Karma is false (it
   * accrues from system events, doesn't move between members); the
   * other rails are true.
   */
  user_to_user_transferable: boolean
  /**
   * Rail closes the loop: no balance ever leaves the system as cash.
   * CCR, HRS, KARMA, and GIFT are closed-loop. USD and USDC are cash.
   */
  closed_loop: boolean
  /**
   * `ledger_account.account_type` that holds balances of this rail.
   * Null for non-balance rails (KARMA tracks events not balances;
   * GIFT records a flow without a balance change).
   */
  account_type: string | null
  /**
   * Unit identifier as it appears in `ledger_entry.currency_code` and
   * `asset_graph.settlement_record.asset_code`.
   */
  unit: string
}

export const RAIL_REGISTRY: Readonly<Record<RailCode, RailDefinition>> = {
  CCR: {
    code: "CCR",
    manifest_code: "ccr",
    display_name: "Coalition Credits",
    cash_convertible: false,
    requires_purchase_context: true,
    user_to_user_transferable: true,
    closed_loop: true,
    account_type: "USER_WALLET",
    unit: "CCR",
  },
  USDC: {
    code: "USDC",
    manifest_code: "usdc",
    display_name: "USDC",
    cash_convertible: true,
    requires_purchase_context: false,
    user_to_user_transferable: true,
    closed_loop: false,
    account_type: "USER_WALLET",
    unit: "USDC",
  },
  USD: {
    code: "USD",
    manifest_code: "usd",
    display_name: "USD (Stripe ACH)",
    cash_convertible: true,
    requires_purchase_context: false,
    user_to_user_transferable: true,
    closed_loop: false,
    account_type: "USER_WALLET",
    unit: "USD",
  },
  KARMA: {
    code: "KARMA",
    manifest_code: "karma",
    display_name: "Karma",
    cash_convertible: false,
    requires_purchase_context: false,
    user_to_user_transferable: false,
    closed_loop: true,
    account_type: null,
    unit: "KARMA",
  },
  HRS: {
    code: "HRS",
    manifest_code: "hours",
    display_name: "Time-bank hours",
    cash_convertible: false,
    requires_purchase_context: false,
    user_to_user_transferable: true,
    closed_loop: true,
    account_type: "TIME_BANK",
    unit: "HRS",
  },
  GIFT: {
    code: "GIFT",
    manifest_code: "gift",
    display_name: "Gift (non-settling)",
    cash_convertible: false,
    requires_purchase_context: false,
    user_to_user_transferable: true,
    closed_loop: true,
    account_type: null,
    unit: "GIFT",
  },
} as const

export const RAIL_CODES: ReadonlyArray<RailCode> = Object.keys(
  RAIL_REGISTRY
) as RailCode[]

/**
 * Convenience set: rails where balances cannot leave the system as
 * cash. Posture A's compliance posture depends on at least CCR being
 * here; HRS and KARMA share the property by design.
 */
export const CLOSED_LOOP_RAILS: ReadonlySet<RailCode> = new Set<RailCode>(
  RAIL_CODES.filter((c) => RAIL_REGISTRY[c].closed_loop)
)

/**
 * Convenience set: rails that the dual-rail selector (Stripe-ACH vs.
 * Stellar-USDC) is allowed to settle. Everything else must be rejected.
 */
export const CASH_RAILS: ReadonlySet<RailCode> = new Set<RailCode>(
  RAIL_CODES.filter((c) => RAIL_REGISTRY[c].cash_convertible)
)

const MANIFEST_TO_RAIL: Readonly<Record<ManifestRail, RailCode>> = {
  ccr: "CCR",
  usdc: "USDC",
  usd: "USD",
  karma: "KARMA",
  hours: "HRS",
  gift: "GIFT",
}

/** Map from asset-graph manifest rail name to the ledger rail code. */
export const RAIL_CODE_BY_MANIFEST_RAIL = (rail: ManifestRail): RailCode =>
  MANIFEST_TO_RAIL[rail]

/** Get a rail's full definition or throw on unknown code. */
export const getRail = (code: string): RailDefinition => {
  const def = RAIL_REGISTRY[code as RailCode]
  if (!def) {
    throw new Error(`Unknown settlement rail: ${code}`)
  }
  return def
}
