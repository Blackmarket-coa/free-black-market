import type { MedusaResponse } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import {
  getCachedPlanFeatures,
  setCachedPlanFeatures,
  type PlanFeatureSnapshot,
} from "./plan-entitlement-cache"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import type VendorPlanService from "../modules/vendor-plan/service"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"
import {
  limitsForPlan,
  type PlanLimit,
  type VendorPlanLimits,
} from "../modules/vendor-plan/limits"
import { TENANCY_MODULE } from "../modules/tenancy"
import type TenancyModuleService from "../modules/tenancy/service"
import { vendorFeatureKeysForTier } from "../modules/tenancy/gates"

const log = createLogger("shared/seller-plan")

/**
 * One read path for "what does this seller's plan give them", shared by the
 * route gate (`requirePlanFeature`) and by every quantitative limit check.
 *
 * Both go through `plan-entitlement-cache`, so a request that has already been
 * through the gate costs a limit check nothing — the snapshot it needs is
 * already in the map, keyed by the same seller id with the same 30s TTL. Two
 * separate loaders would have meant two caches with two expiries, and a window
 * where the gate and the limit disagreed about which plan a seller was on.
 *
 * Takes a `MedusaContainer` rather than a request — routes pass `req.scope`,
 * while subscribers and jobs (which have no request) can use the same
 * functions. Imports the module files directly rather than the `shared` barrel
 * to keep this out of the cycle that barrel would otherwise create.
 */

/**
 * The feature keys a seller holds: their plan's keys UNION any directly held
 * seller entitlements UNION the floor their organization's tenancy tier grants.
 *
 * Reading the plan directly means plan features can never drift out of sync
 * with granted rows — there is no reconciliation job standing between "the
 * seller upgraded" and "the gate opens". Unioning entitlements on top is what
 * makes non-plan grants work: a comped feature, a promotional trial, or a
 * one-off operator grant opens the gate without inventing a bespoke plan.
 *
 * The tenancy floor is the enterprise/white-label half. An organization that
 * bought a verified or aligned-org contract has paid for its sellers' tooling
 * at the org level, so its tier grants those features to every seller under it.
 * **Union, never intersection** — a seller paying for Pro inside a tier1
 * organization keeps everything Pro includes; a floor that could lower an
 * entitlement would silently strip a feature somebody is paying for.
 *
 * Both additions degrade to nothing on failure. A seller's own plan features
 * are the load-bearing part and must stand even when the other two reads
 * misbehave.
 */
export async function loadSellerPlanSnapshot(
  container: MedusaContainer,
  sellerId: string
): Promise<PlanFeatureSnapshot> {
  const planService = container.resolve<VendorPlanService>(VENDOR_PLAN_MODULE)

  const assignment = await planService.ensureAssignment(sellerId)
  const planKeys = await planService.getEntitledFeatureKeys(sellerId)

  const keys = new Set<string>(planKeys)

  // Entitlement grants are additive and must never fail the request on their
  // own — a seller's plan features stand even if this read misbehaves.
  try {
    const entitlements =
      container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
    for (const key of await entitlements.listActiveFeatureKeysForSeller(
      sellerId
    )) {
      keys.add(key)
    }
  } catch (err) {
    log.warn(
      `[plan] seller entitlement read failed for ${sellerId}; using plan features only`,
      err
    )
  }

  // Same posture as entitlements: additive, and a failure here must never cost
  // a seller the plan they are paying for. Sellers with no tenancy membership —
  // every ordinary FBM vendor — resolve to `tier0_public`, which grants
  // nothing, so this is a no-op for them beyond one indexed lookup.
  try {
    const tenancy = container.resolve<TenancyModuleService>(TENANCY_MODULE)
    const tier = await tenancy.resolveSellerTier(sellerId)
    for (const key of vendorFeatureKeysForTier(tier)) {
      keys.add(key)
    }
  } catch (err) {
    log.warn(
      `[plan] tenancy tier read failed for ${sellerId}; no organization floor applied`,
      err
    )
  }

  return { plan_code: assignment.plan_code, feature_keys: keys }
}

/** Cached snapshot for a seller, loading and caching it on a miss. */
export async function getSellerPlanSnapshot(
  container: MedusaContainer,
  sellerId: string
): Promise<PlanFeatureSnapshot> {
  const cached = getCachedPlanFeatures(sellerId)
  if (cached) return cached

  const snapshot = await loadSellerPlanSnapshot(container, sellerId)
  setCachedPlanFeatures(sellerId, snapshot)
  return snapshot
}

export type ResolvedPlanLimits = {
  plan_code: string
  limits: VendorPlanLimits
}

/**
 * A seller's quantitative plan limits.
 *
 * Never throws. A limit check sits on ordinary create/read paths that already
 * have their own failure modes, and turning a plan-service blip into a 500 on
 * `POST /vendor/embed-keys` would be worse than briefly applying the free
 * tier's (most restrictive) ceiling. The route gate is where an unavailable
 * plan service is surfaced as a 503; here it degrades to fail-closed numbers.
 */
export async function getSellerPlanLimits(
  container: MedusaContainer,
  sellerId: string
): Promise<ResolvedPlanLimits> {
  try {
    const snapshot = await getSellerPlanSnapshot(container, sellerId)
    return {
      plan_code: snapshot.plan_code,
      limits: limitsForPlan(snapshot.plan_code),
    }
  } catch (err) {
    log.warn(`[plan] limit lookup failed for ${sellerId}; applying free tier`, err)
    return { plan_code: "free", limits: limitsForPlan("free") }
  }
}

export type PlanLimitDenial = {
  limit_key: keyof VendorPlanLimits
  limit: PlanLimit
  current: number
  plan_code: string
  /** Human-readable noun, e.g. "embed keys". Interpolated into the message. */
  noun: string
  /**
   * Pre-formatted allowance for the message, when the raw number would not
   * mean anything to the reader.
   *
   * "Your free plan allows 104857600 vault storage bytes" is technically the
   * truth and practically useless; "allows 100.0 MB of vault storage" is the
   * same fact in a form a vendor can act on. The machine-readable `limit` and
   * `current` fields stay raw either way, so the panel is unaffected.
   */
  display_limit?: string
}

/**
 * Write the 402 a limit check denies with.
 *
 * Same status and envelope superset as `requirePlanFeature`'s denial so the
 * panel's single error parser handles both, but a distinct `code`: "you have
 * used all of yours" and "your plan does not include this" need different copy
 * and different calls to action.
 */
export function respondPlanLimitReached(
  res: MedusaResponse,
  denial: PlanLimitDenial
): MedusaResponse {
  return res.status(402).json({
    type: "plan_limit_reached",
    code: "plan_limit_reached",
    message: `Your ${denial.plan_code} plan allows ${
      denial.display_limit ?? denial.limit
    } ${denial.noun}. Upgrade to add more.`,
    limit_key: denial.limit_key,
    limit: denial.limit,
    current: denial.current,
    current_plan: denial.plan_code,
    upgrade_url: "/settings/billing",
  }) as unknown as MedusaResponse
}
