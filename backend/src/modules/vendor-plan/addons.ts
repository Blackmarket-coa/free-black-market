import {
  ALL_ACCESS_PLAN_CODE,
  VENDOR_FEATURE_KEYS,
  VENDOR_PLAN_CATALOG,
  featureKeysForPlan,
  type VendorFeatureKey,
} from "./catalog"

/**
 * Add-on packs — features bought à la carte on top of any plan.
 *
 * Phase 4 of the monetization roadmap: package what is functionally complete.
 * The Quest Engine and the vertical modules are finished software gated behind
 * `vendor.*` keys that only the Scale plan carries; an add-on lets a vendor buy
 * exactly the pack they need without a four-tier plan jump.
 *
 * An add-on is deliberately NOT a subscription. Each purchase buys a fixed
 * window (`duration_days`); buying again while a window is open EXTENDS it from
 * its current end, exactly like promoted-listing renewals — commitment-free by
 * construction, with no renewal cron, no dunning, and no state machine beyond
 * the entitlement's own expiry. A vendor who wants the feature permanently and
 * cheaply upgrades their plan; the premium over the plan's pro-rata price is
 * the price of no commitment.
 *
 * Mechanically an owned add-on is a set of seller-keyed `ACCESS_PASS`
 * entitlements with an `expires_at` (`shared/vendor-addons.ts`). The plan
 * snapshot unions entitlement keys on top of plan keys and drops expired rows,
 * so an add-on opens the same `requirePlanFeature` gates a plan does and
 * lapses on its own the moment the window closes — no sweep stands between
 * "expired" and "locked".
 *
 * Pure — no imports beyond the plan catalog, no I/O — so the invariants
 * (valid keys, unique codes, no pack undercutting a plan it covers) assert
 * directly in unit tests.
 */

export type VendorAddonDefinition = {
  /** Stable identifier. Referenced by charges and entitlement metadata. */
  code: string
  display_name: string
  description: string
  /** Minor units (cents) per purchase. */
  price_amount: number
  currency_code: string
  /** Days of access one purchase buys. Repeat purchases extend. */
  duration_days: number
  feature_keys: VendorFeatureKey[]
  is_active: boolean
  display_order: number
}

/**
 * The pack catalog.
 *
 * Pricing rule, held by a drift test: **no pack may undercut a plan whose
 * feature keys it covers.** A pack that granted a superset of a plan's keys
 * for less would make the plan irrational and turn add-ons into a discount
 * ladder nobody designed. Within that floor, packs price above the plan
 * pro-rata on purpose — the plan is the better deal for anyone staying.
 */
export const VENDOR_ADDON_CATALOG: VendorAddonDefinition[] = [
  {
    code: "quest_pack",
    display_name: "Readiness Quests",
    description:
      "The full vendor quest engine: guided readiness quests with exportable packets for loans, certification and wholesale onboarding.",
    price_amount: 4900,
    currency_code: "usd",
    duration_days: 30,
    feature_keys: ["vendor.quests"],
    is_active: true,
    display_order: 0,
  },
  {
    code: "grower_pack",
    display_name: "Grower Tools",
    description:
      "Nursery management and the production ledger, for growers tracking batches from propagation to sale.",
    price_amount: 3900,
    currency_code: "usd",
    duration_days: 30,
    feature_keys: ["vendor.nursery", "vendor.production_ledger"],
    is_active: true,
    display_order: 1,
  },
  {
    code: "commerce_pack",
    display_name: "Commerce Tools",
    description:
      "In-person point of sale, invoicing and pick-pack fulfilment for vendors selling beyond the storefront.",
    price_amount: 5900,
    currency_code: "usd",
    duration_days: 30,
    feature_keys: ["vendor.pos", "vendor.invoicing", "vendor.pick_pack"],
    is_active: true,
    display_order: 2,
  },
  {
    /**
     * The Buyer Center as a purchasable pack.
     *
     * Priced well above the vertical packs because it is a different kind of
     * product: it only pays off for a seller with a multi-vendor supply side
     * to organise, and it is the same capability the aligned-org tenancy tier
     * grants an operator wholesale. Offered per-vendor as well so a large
     * independent seller is not forced into an organization contract to reach
     * it — the alternative was a gated route with no way to buy in, which is
     * exactly what the coverage audit flags as unreachable.
     */
    code: "buyer_center_pack",
    display_name: "Buyer Center",
    description:
      "Demand pools, buyer networks and group bargaining for organising purchasing across many suppliers.",
    price_amount: 14900,
    currency_code: "usd",
    duration_days: 30,
    feature_keys: ["vendor.buyer_network"],
    is_active: true,
    display_order: 4,
  },
  {
    /**
     * Grant and restricted-fund tracking as a pack.
     *
     * Priced at the low end deliberately: the vendors who need it are
     * grant-funded nonprofits, and the module exists so they can prove an award
     * was spent as designated. An org holding a grant can carry $39; the pack
     * is here so reaching that does not require the $99 plan jump.
     *
     * Deliberately does NOT carry aid-network. Hub inventory, in-kind intake
     * and surplus routing ship free on every tier, including Free — a pantry
     * moving rescued food is exactly who should not meet a paywall. Only the
     * compliance surface, which by definition only matters once someone has
     * been given money, is sold.
     */
    code: "fund_pack",
    display_name: "Grant & Fund Tracking",
    description:
      "Restricted funds and grants: award, receipt and expenditure tracking with period and purpose compliance checks for grant reconciliation.",
    price_amount: 3900,
    currency_code: "usd",
    duration_days: 30,
    feature_keys: ["vendor.fund_accounting"],
    is_active: true,
    display_order: 5,
  },
  {
    code: "embed_pack",
    display_name: "Embedded Storefront",
    description:
      "The embeddable storefront and document vault — the Starter plan's features without the subscription.",
    // Priced ABOVE the Starter plan ($29/mo) on purpose: same keys,
    // commitment-free, so the subscription stays the rational choice for
    // anyone staying past a month.
    price_amount: 3500,
    currency_code: "usd",
    duration_days: 30,
    feature_keys: ["vendor.embed", "vendor.document_vault"],
    is_active: true,
    display_order: 3,
  },
]

export function getAddonDefinition(
  code: string | null | undefined
): VendorAddonDefinition | null {
  if (!code) return null
  return VENDOR_ADDON_CATALOG.find((a) => a.code === code) ?? null
}

/** Active, purchasable packs in display order. */
export function listPurchasableAddons(): VendorAddonDefinition[] {
  return VENDOR_ADDON_CATALOG.filter((a) => a.is_active).sort(
    (a, b) => a.display_order - b.display_order
  )
}

/**
 * Does this plan already grant every key the pack would? Then buying the pack
 * pays for nothing. Reads the PLAN's keys only — never the seller's
 * entitlement union, which includes the pack itself once owned.
 */
export function addonCoveredByPlan(
  addon: VendorAddonDefinition,
  planCode: string | null | undefined
): boolean {
  if (!addon.feature_keys.length) return false
  const planKeys = new Set<string>(featureKeysForPlan(planCode))
  return addon.feature_keys.every((k) => planKeys.has(k))
}

/**
 * Whether a pack belongs on this seller's PURCHASE list (operator answer OI-9,
 * 2026-10-05).
 *
 * Flag off: every active pack, exactly as before. Flag on
 * (`FF_ALL_ACCESS_PLAN_V1`): hidden only for a seller on `all_access` whose
 * plan covers the pack (every pack today) — they would pay for nothing.
 * Scoped to all_access as OI-9 says: a seller on any other plan (free, or a
 * retired tier an operator assigned) is offered every pack as before. And an
 * all_access seller with a scheduled move OFF all_access (a cancellation or a
 * downgrade pending) may buy again, so they can hold a pack past the plan's
 * end. A trialing all_access seller with nothing pending is on the plan and is
 * not offered packs it covers.
 *
 * This only decides what is OFFERED for sale. It never revokes, deactivates
 * or refunds a pack the seller already bought: an owned pack keeps its
 * entitlement rows to their expiry whatever plan the seller moves to, and the
 * `/vendor/addons` route keeps listing an owned, active covered pack as owned.
 */
export function addonOfferedForPurchase(
  addon: VendorAddonDefinition,
  planCode: string | null | undefined,
  allAccessOn: boolean,
  pendingPlanCode: string | null = null
): boolean {
  if (!addon.is_active) return false
  if (!allAccessOn) return true
  if (planCode !== ALL_ACCESS_PLAN_CODE) return true
  if (pendingPlanCode && pendingPlanCode !== ALL_ACCESS_PLAN_CODE) return true
  return !addonCoveredByPlan(addon, planCode)
}

/**
 * When a purchase made now should expire, extending an unexpired window
 * rather than restarting it — a second month bought with a week left yields
 * five weeks, not four. Same shape as `promotionExpiryFrom`, duplicated here
 * so the plan module does not import promotion concerns.
 */
export function addonExpiryFrom(
  durationDays: number,
  now: Date,
  currentExpiry?: Date | string | null
): Date {
  const base = (() => {
    if (!currentExpiry) return now
    const existing =
      currentExpiry instanceof Date ? currentExpiry : new Date(currentExpiry)
    if (Number.isNaN(existing.getTime())) return now
    return existing.getTime() > now.getTime() ? existing : now
  })()
  return new Date(base.getTime() + durationDays * 86_400_000)
}

/**
 * Would this pack, at this price, undercut a plan it covers? Exposed for the
 * drift test rather than inlined there, so the rule reads next to the catalog
 * it constrains.
 */
export function addonUndercutsPlan(addon: VendorAddonDefinition): string | null {
  const packKeys = new Set<string>(addon.feature_keys)
  for (const plan of VENDOR_PLAN_CATALOG) {
    if (!plan.is_public || !plan.is_active || plan.price_amount <= 0) continue
    const covered = plan.feature_keys.every((k) => packKeys.has(k))
    if (covered && addon.price_amount < plan.price_amount) {
      return plan.code
    }
  }
  return null
}

/** Every key an add-on can grant is a real plan feature key. For drift tests. */
export const VENDOR_ADDON_KEY_SET: ReadonlySet<string> = new Set(
  VENDOR_FEATURE_KEYS
)
