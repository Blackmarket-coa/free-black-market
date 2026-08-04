import type { VendorFeatureKey } from "../vendor-plan/catalog"

/**
 * What a storefront's tenancy tier entitles.
 *
 * Extracted from `service.ts` and kept pure — no container, no I/O — for the
 * same reason `vendor-plan/limits.ts` and `overage.ts` are: this table is a
 * commercial decision, and a commercial decision should be assertable without
 * standing up a database. The service delegates to it so the tier checks the
 * admin donation routes already run keep behaving identically.
 *
 * Two distinct ladders meet here, and conflating them is the mistake to avoid:
 *
 * - **`vendor_plan`** is what one *seller* bought. Per-seller, billed monthly,
 *   enforced by `requirePlanFeature`.
 * - **Tenancy tier** is what an *organization* bought. Per-storefront, and for
 *   a white-label or enterprise customer it is the contract — they are not
 *   going to buy each of their sellers a Pro subscription on top of it.
 *
 * So a tier does not replace a plan; it **floors** it. See
 * `vendorFeatureKeysForTier` below.
 */

export type TierFlag = "tier0_public" | "tier1_verified" | "tier2_aligned_org"

/** Ascending. A tier is "at least" another when its rank is not lower. */
export const TIER_ORDER: readonly TierFlag[] = [
  "tier0_public",
  "tier1_verified",
  "tier2_aligned_org",
] as const

const tierRank: Record<TierFlag, number> = {
  tier0_public: 0,
  tier1_verified: 1,
  tier2_aligned_org: 2,
}

export function isTierFlag(value: unknown): value is TierFlag {
  return typeof value === "string" && value in tierRank
}

/**
 * Unknown tiers rank lowest rather than throwing.
 *
 * A storefront row carrying a tier this build does not know about — a rollback
 * mid-deploy, a hand-edited row — must fail closed to the public tier, not 500
 * on every request that touches it. Same fail-closed posture
 * `limitsForPlan` takes for an unrecognized plan code.
 */
export function hasMinimumTier(actual: TierFlag, required: TierFlag): boolean {
  return (tierRank[actual] ?? 0) >= (tierRank[required] ?? 0)
}

/**
 * The capability table.
 *
 * Every gate here names something that exists in the codebase today; a gate for
 * a capability nothing consults is a promise the product cannot keep, and would
 * read to an operator as a feature they had bought.
 */
export const TENANCY_GATES = {
  /** Route a share of order value to beneficiaries — `api/admin/donations/*`. */
  donation_routing: "tier1_verified",
  /** Public donation transparency reporting — `api/store/donations/transparency`. */
  transparency_reporting: "tier1_verified",
  /** CSV catalog import — `parseCsvRows` / `validateMappedRows`. */
  bulk_catalog_import: "tier1_verified",
  /** Non-live storefront for trialling a configuration — `setSandboxMode`. */
  sandbox_mode: "tier1_verified",
  /** Storefront branding and domain presented as the org's own. */
  white_label_branding: "tier1_verified",
  /** Wellness/marketing automation beyond the defaults. */
  advanced_automation: "tier2_aligned_org",
  /** More than one storefront under a single organization. */
  multi_storefront: "tier2_aligned_org",
  /** The four-role RBAC matrix — only meaningful once a real org runs the store. */
  role_delegation: "tier2_aligned_org",
  /**
   * Batch ledger settlement rather than split-at-processor. The
   * `nonprofit_marketplace` starter template already selects
   * `settlement_mode: "ledger_batch"` and is the only tier2 template.
   */
  ledger_batch_settlement: "tier2_aligned_org",
} as const satisfies Record<string, TierFlag>

export type TenancyGate = keyof typeof TENANCY_GATES

export const TENANCY_GATE_KEYS = Object.keys(TENANCY_GATES) as TenancyGate[]

export function isTenancyGate(value: unknown): value is TenancyGate {
  return typeof value === "string" && value in TENANCY_GATES
}

/** Every gate, with whether this tier holds it. The middleware's payload. */
export function featureGatesForTier(tier: TierFlag): Record<TenancyGate, boolean> {
  const gates = {} as Record<TenancyGate, boolean>
  for (const key of TENANCY_GATE_KEYS) {
    gates[key] = hasMinimumTier(tier, TENANCY_GATES[key])
  }
  return gates
}

/** Just the gates this tier holds. Convenient for logging and for admin UI. */
export function gatesGrantedByTier(tier: TierFlag): TenancyGate[] {
  return TENANCY_GATE_KEYS.filter((key) => hasMinimumTier(tier, TENANCY_GATES[key]))
}

/**
 * Vendor plan features an organization's tier grants to its sellers.
 *
 * The floor, and the reason this file imports from `vendor-plan/catalog`. An
 * organization that has bought a verified or aligned-org contract has paid for
 * its sellers' tooling at the org level; requiring each of those sellers to
 * also carry a paid `vendor_plan` would bill the same capability twice and make
 * the enterprise offer unsellable.
 *
 * **A floor only ever raises.** It is unioned onto whatever the seller's own
 * plan grants, never intersected with it — a seller who pays for Pro inside a
 * tier1 organization keeps everything Pro includes. This is the same rule
 * `effectiveGrowerTier` applies to the KARMA ladder's plan floor, and it exists
 * because the alternative silently strips a feature somebody is paying for.
 *
 * Deliberately conservative. `tier0_public` grants nothing: a public storefront
 * is not an enterprise contract, and treating it as one would hand the whole
 * paid catalog to anyone who created an organization.
 */
const TIER_VENDOR_FEATURES: Record<TierFlag, readonly VendorFeatureKey[]> = {
  tier0_public: [],
  // Matches the `starter` plan — the org has been verified, so its sellers can
  // put an embedded storefront on their own site and keep documents with us.
  tier1_verified: ["vendor.embed", "vendor.document_vault"],
  // Adds the `pro` operational set. This is the white-label buyer.
  tier2_aligned_org: [
    "vendor.embed",
    "vendor.document_vault",
    "vendor.pos",
    "vendor.invoicing",
    "vendor.channel_sync",
    "vendor.quests",
  ],
}

export function vendorFeatureKeysForTier(
  tier: TierFlag
): readonly VendorFeatureKey[] {
  return TIER_VENDOR_FEATURES[tier] ?? TIER_VENDOR_FEATURES.tier0_public
}

/**
 * The highest tier among the storefronts a seller belongs to.
 *
 * A seller can be a member of more than one storefront, and the tiers can
 * differ. Taking the maximum follows from the floor rule: the seller has, in
 * fact, been granted the higher tier's capability by one of their
 * organizations, and picking the lower one would revoke something an
 * organization deliberately gave them. `tier0_public` for no memberships at
 * all — the ordinary case for a seller with no enterprise relationship.
 */
export function highestTier(tiers: readonly (string | null | undefined)[]): TierFlag {
  let best: TierFlag = "tier0_public"
  for (const candidate of tiers) {
    if (isTierFlag(candidate) && tierRank[candidate] > tierRank[best]) {
      best = candidate
    }
  }
  return best
}
