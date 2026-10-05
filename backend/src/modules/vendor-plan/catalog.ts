import { featureFlagState } from "../../shared/feature-flags"

/**
 * Vendor billing-plan catalog. Code is the source of truth; rows in
 * `vendor_plan` are a denormalized copy seeded from here.
 *
 * The plan → feature-key mapping lives in code rather than only in the database
 * because the gate registrations in `api/middlewares.ts` reference these keys as
 * literals at boot. A `VendorFeatureKey` union makes a typo a compile error; a
 * DB-only mapping would only surface it at runtime, as a silently open gate.
 */

/**
 * Feature keys a plan can grant.
 *
 * Deliberately a separate `vendor.*` namespace from the 14 `hasX` dashboard
 * keys in `shared/extension-keys.ts` and from `plugin:<slug>`. Reusing the UI
 * vocabulary as the billing vocabulary would weld pricing to whatever the
 * dashboard happens to call things, and would collide with the two namespaces
 * already sharing `seller_metadata.enabled_extensions`.
 */
export const VENDOR_FEATURE_KEYS = [
  "vendor.pos",
  "vendor.invoicing",
  "vendor.channel_sync",
  "vendor.document_vault",
  "vendor.quests",
  "vendor.production_ledger",
  "vendor.nursery",
  "vendor.pick_pack",
  "vendor.embed",
  "vendor.buyer_network",
  "vendor.fund_accounting",
] as const

export type VendorFeatureKey = (typeof VENDOR_FEATURE_KEYS)[number]

const VENDOR_FEATURE_KEY_SET: ReadonlySet<string> = new Set(VENDOR_FEATURE_KEYS)

export function isVendorFeatureKey(key: unknown): key is VendorFeatureKey {
  return typeof key === "string" && VENDOR_FEATURE_KEY_SET.has(key)
}

/** Billing interval for a plan's recurring charge. */
export type VendorPlanInterval = "month" | "year" | "none"

export type VendorPlanDefinition = {
  /** Stable identifier. Referenced by assignments and by operators. */
  code: string
  display_name: string
  description: string
  /** Minor units (cents). `0` for the free tier. */
  price_amount: number
  currency_code: string
  interval: VendorPlanInterval
  /**
   * Marketplace take rate for sellers on this plan, as a percentage.
   *
   * `null` means "no plan-level opinion — use the platform default". This is
   * consulted only as a fallback BELOW the per-seller override in
   * `seller_payout_settings.custom_platform_fee_percent`, so a negotiated rate
   * always wins over a plan rate and the two never become ambiguous.
   *
   * The ladder only ever discounts. `free` is pinned to the platform default,
   * so introducing plans did not raise anyone's rate, and each paid plan a
   * vendor is OFFERED is strictly cheaper than the one below it — a vendor's
   * take rate can only fall as they move up, never rise. Which plans are
   * offered depends on `FF_ALL_ACCESS_PLAN_V1` (`offeredPlans`): off, the
   * ladder is free 3% → starter 2.5% → pro 2% → scale 1.5%; on, it is free 3%
   * → all_access 0%. `PLATFORM_DEFAULT_FEE_PERCENT` and the drift test in
   * `__tests__/catalog.unit.spec.ts`, which runs the ladder invariants over
   * the offered set in BOTH flag states, hold that invariant.
   *
   * The ladder prices SALES. `all_access` at 0% is a priced, public plan: a
   * vendor buys it for $10/month, it is listed on the public fee schedule, and
   * it resolves through the chain as `source: "plan"` — below a negotiated
   * seller override, like every other plan rate. It is NOT the 0% on a
   * donation. That is a transaction-kind rule that sits above the whole
   * override → plan → default chain in `payout-breakdown/fee-resolution.ts`
   * (`source: "transaction_kind"`), because it is a decision about what FBM
   * charges for rather than a rate a vendor can buy down to, and it is never
   * expressed as a plan row here.
   */
  platform_fee_percent: number | null
  trial_days: number
  is_active: boolean
  /** Whether the plan is self-serve selectable, as opposed to operator-assigned. */
  is_public: boolean
  display_order: number
  feature_keys: VendorFeatureKey[]
}

/**
 * The seeded plan ladder.
 *
 * `free` is required to exist — `getEntitledFeatureKeys` lazily assigns it to
 * any seller with no assignment row, so that "on the free plan" and "never
 * provisioned" are never ambiguous.
 */
export const VENDOR_PLAN_CATALOG: VendorPlanDefinition[] = [
  {
    code: "free",
    display_name: "Free",
    description:
      "Everything needed to list and sell: products, orders, customers and payouts.",
    price_amount: 0,
    currency_code: "usd",
    interval: "none",
    // Matches the platform default, so no existing vendor's rate changes.
    platform_fee_percent: 3,
    trial_days: 0,
    is_active: true,
    is_public: true,
    display_order: 0,
    feature_keys: [],
  },
  {
    code: "starter",
    display_name: "Starter",
    description:
      "Adds the embeddable storefront and document vault for vendors selling on their own site.",
    price_amount: 2900,
    currency_code: "usd",
    interval: "month",
    platform_fee_percent: 2.5,
    trial_days: 30,
    is_active: true,
    is_public: true,
    display_order: 1,
    feature_keys: ["vendor.embed", "vendor.document_vault"],
  },
  {
    code: "pro",
    display_name: "Pro",
    description:
      "Adds in-person selling, invoicing, external channel sync, fulfilment tooling and restricted-fund tracking.",
    price_amount: 9900,
    currency_code: "usd",
    interval: "month",
    platform_fee_percent: 2,
    trial_days: 30,
    is_active: true,
    is_public: true,
    display_order: 2,
    feature_keys: [
      "vendor.embed",
      "vendor.document_vault",
      "vendor.pos",
      "vendor.invoicing",
      "vendor.channel_sync",
      "vendor.pick_pack",
      "vendor.fund_accounting",
    ],
  },
  {
    code: "scale",
    display_name: "Scale",
    description:
      "Everything in Pro plus the readiness quests, production ledger and vertical modules.",
    price_amount: 24900,
    currency_code: "usd",
    interval: "month",
    platform_fee_percent: 1.5,
    trial_days: 0,
    is_active: true,
    is_public: true,
    display_order: 3,
    feature_keys: [...VENDOR_FEATURE_KEYS],
  },
  {
    /**
     * Black Mask F8: the $10/month all-access plan. Offered (with `free`) only
     * while `FF_ALL_ACCESS_PLAN_V1` is on — see `offeredPlans`. Defined
     * unconditionally so an assignment to it keeps resolving its features
     * and limits even if the flag is later switched off (`getPlanDefinition`
     * and `featureKeysForPlan` fail closed on an unknown code).
     *
     * Every vendor.* key: the built-in modules and the enhanced versions the
     * packs sell à la carte (operator answer OI-7, 2026-10-05). 0% platform
     * fee is a priced plan rate, not the donation rule (see the field doc).
     * 30-day trial (OI-8), once per seller — `trialEndsAtFor` in
     * `transitions.ts`.
     */
    code: "all_access",
    display_name: "All-Access",
    description:
      "Every vendor tool on the marketplace — point of sale, invoicing, channel sync, embeddable storefront, document vault, quests, production ledger, nursery, pick-pack, buyer network and fund tracking — with no platform fee on your sales.",
    price_amount: 1000,
    currency_code: "usd",
    interval: "month",
    platform_fee_percent: 0,
    trial_days: 30,
    is_active: true,
    is_public: true,
    display_order: 4,
    feature_keys: [...VENDOR_FEATURE_KEYS],
  },
  {
    code: "internal",
    display_name: "Internal",
    description:
      "Operator-assigned plan carrying every feature. Used for FBM's own vendors and for support.",
    price_amount: 0,
    currency_code: "usd",
    interval: "none",
    // No plan-level opinion: FBM's own vendors stay on the platform default
    // rather than having their (internal, paper) fee silently zeroed.
    platform_fee_percent: null,
    trial_days: 0,
    is_active: true,
    is_public: false,
    display_order: 99,
    feature_keys: [...VENDOR_FEATURE_KEYS],
  },
]

/** The plan a seller falls back to when they have no assignment. */
export const DEFAULT_PLAN_CODE = "free"

/**
 * The platform's take rate before plans existed — the seeded default of
 * `payout_config.platform_fee_percent`.
 *
 * Kept here as the ceiling the ladder is asserted against: no plan may charge
 * more than a seller was already paying, so shipping the ladder cannot raise
 * anyone's rate. If the operator changes the `payout_config` row, this constant
 * needs to move with it or the drift test is checking the wrong number.
 */
export const PLATFORM_DEFAULT_FEE_PERCENT = 3

export function getPlanDefinition(
  code: string | null | undefined
): VendorPlanDefinition | null {
  if (!code) return null
  return VENDOR_PLAN_CATALOG.find((p) => p.code === code) ?? null
}

/**
 * Feature keys a plan grants. An unknown code grants nothing — failing closed,
 * so a typo or a removed plan cannot silently hand out access.
 */
export function featureKeysForPlan(
  code: string | null | undefined
): VendorFeatureKey[] {
  return getPlanDefinition(code)?.feature_keys ?? []
}

/** The Black Mask F8 plan code. */
export const ALL_ACCESS_PLAN_CODE = "all_access"

/**
 * Paid tiers that stay DEFINED but are not offered while
 * `FF_ALL_ACCESS_PLAN_V1` is on. Kept in the catalog on purpose: lookups fail
 * closed, so deleting a row would strip every feature from anyone assigned to
 * it. Operator answer OI-6 (2026-10-05): no vendor is on any of them today, so
 * no assignment needs migrating.
 */
export const PLANS_RETIRED_UNDER_ALL_ACCESS: readonly string[] = [
  "starter",
  "pro",
  "scale",
]

/** Whether the all-access ladder is live. The registry's reader, never a second env parse. */
export function allAccessPlanEnabled(): boolean {
  return featureFlagState.isEnabled("ALL_ACCESS_PLAN_V1")
}

function listedInFlagState(code: string, allAccessOn: boolean): boolean {
  if (code === ALL_ACCESS_PLAN_CODE) return allAccessOn
  if (PLANS_RETIRED_UNDER_ALL_ACCESS.includes(code)) return !allAccessOn
  return true
}

/**
 * The catalog as public surfaces may describe it in this flag state: the
 * ladder rows that exist for vendors to buy, plus operator rows (`internal`)
 * that those surfaces already listed. Flag off, this is exactly the catalog
 * as it was before `all_access` existed, in the same order.
 */
export function advertisedPlans(allAccessOn: boolean): VendorPlanDefinition[] {
  return VENDOR_PLAN_CATALOG.filter((p) => listedInFlagState(p.code, allAccessOn))
}

/**
 * The self-serve ladder a vendor may select, in display order.
 *
 * Off: [free, starter, pro, scale] — exactly the `is_active && is_public` set
 * before `all_access` existed. On: [free, all_access]. `internal` is never
 * offered (`is_public: false`). The ladder invariants in
 * `__tests__/catalog.unit.spec.ts` run over this set for both values.
 */
export function offeredPlans(allAccessOn: boolean): VendorPlanDefinition[] {
  return advertisedPlans(allAccessOn)
    .filter((p) => p.is_active && p.is_public)
    .sort((a, b) => a.display_order - b.display_order)
}

/** May a vendor select this plan for themselves right now? */
export function isPlanOffered(
  code: string | null | undefined,
  allAccessOn: boolean = allAccessPlanEnabled()
): boolean {
  if (!code) return false
  return offeredPlans(allAccessOn).some((p) => p.code === code)
}
