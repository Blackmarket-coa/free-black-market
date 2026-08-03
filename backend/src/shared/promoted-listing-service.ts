import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "./logger"
import {
  PROMOTED_LISTING_FEATURE_KEY,
  featuredFlagAction,
  getPromotionTier,
  isPromotionActive,
  promotionExpiryFrom,
  type FeaturedFlagAction,
} from "./promoted-listing"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"
import {
  EntitlementKind,
  EntitlementSource,
  EntitlementStatus,
} from "../modules/entitlement/models/entitlement"
import { updateSellerMetadataRecord } from "../modules/seller-extension/metadata-service"
import type SellerExtensionService from "../modules/seller-extension/service"

const log = createLogger("shared/promoted-listing-service")

export type PromotionState = {
  active: boolean
  expires_at: Date | null
  /** Null when the seller has never held a promotion. */
  granted_at: Date | null
}

type PromotionRow = {
  id: string
  status: string
  expires_at: Date | string | null
  created_at?: Date | string | null
}

/** The seller's promotion entitlement, or null. */
async function findPromotion(
  entitlements: EntitlementModuleService,
  sellerId: string
): Promise<PromotionRow | null> {
  const rows = (await entitlements.listEntitlements({
    seller_id: sellerId,
    feature_key: PROMOTED_LISTING_FEATURE_KEY,
    status: EntitlementStatus.ACTIVE,
  })) as unknown as PromotionRow[]
  return rows?.[0] ?? null
}

/** Where a seller stands on promoted placement right now. */
export async function getPromotionState(
  container: MedusaContainer,
  sellerId: string,
  now: Date = new Date()
): Promise<PromotionState> {
  const entitlements =
    container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const row = await findPromotion(entitlements, sellerId)

  if (!row) return { active: false, expires_at: null, granted_at: null }

  const expiresAt = row.expires_at ? new Date(row.expires_at) : null
  return {
    active: isPromotionActive(expiresAt, now),
    expires_at: expiresAt,
    granted_at: row.created_at ? new Date(row.created_at) : null,
  }
}

/**
 * Write `seller_metadata.featured` directly.
 *
 * The unconditional writer, for the paths that already know what the answer is
 * — an explicit revoke, most importantly. `syncFeaturedFlag` is the *derived*
 * writer and deliberately refuses to clear a flag it has no promotion record
 * for; routing a revoke through it would silently leave the seller featured,
 * since the revoke is exactly what removes the record it would have read.
 */
async function setFeaturedFlag(
  container: MedusaContainer,
  sellerId: string,
  featured: boolean
): Promise<boolean> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: metaRows } = await query.graph({
    entity: "seller_metadata",
    fields: ["id", "featured"],
    filters: { seller_id: sellerId },
  })
  const meta = metaRows?.[0] as { id: string; featured: boolean } | undefined
  if (!meta || !!meta.featured === featured) return false

  const sellerExtension = container.resolve(
    "sellerExtension"
  ) as SellerExtensionService
  await updateSellerMetadataRecord(sellerExtension, [{ id: meta.id, featured }])
  return true
}

/**
 * Write `seller_metadata.featured` to match a seller's promotion.
 *
 * Returns the action taken. `"unbacked"` means the seller is featured with no
 * promotion behind it — reported, never cleared; see the docblock on
 * `featuredFlagAction` for why the sweep is one-directional there.
 */
export async function syncFeaturedFlag(
  container: MedusaContainer,
  sellerId: string,
  now: Date = new Date()
): Promise<FeaturedFlagAction> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: metaRows } = await query.graph({
    entity: "seller_metadata",
    fields: ["id", "featured"],
    filters: { seller_id: sellerId },
  })
  const meta = metaRows?.[0] as { id: string; featured: boolean } | undefined
  if (!meta) return "none"

  const state = await getPromotionState(container, sellerId, now)

  const action = featuredFlagAction({
    currentFeatured: !!meta.featured,
    expiresAt: state.expires_at,
    hasPromotion: state.granted_at !== null || state.expires_at !== null,
    now,
  })

  if (action === "set" || action === "clear") {
    const sellerExtension = container.resolve(
      "sellerExtension"
    ) as SellerExtensionService
    await updateSellerMetadataRecord(sellerExtension, [
      { id: meta.id, featured: action === "set" },
    ])
  }

  return action
}

/**
 * Grant or extend a seller's promoted placement.
 *
 * `tierCode` picks the duration; passing none grants an open-ended promotion
 * (null expiry), which is the operator/comp shape and the one the backfill
 * uses for flags that predate promotions.
 *
 * The entitlement is granted first and the flag synced second. If the sync
 * fails the seller is entitled but not yet visible — recoverable by the next
 * sweep. The reverse order would show placement nobody is entitled to, which
 * nothing would ever correct.
 */
export async function grantPromotion(
  container: MedusaContainer,
  args: {
    sellerId: string
    tierCode?: string | null
    reason?: string | null
    now?: Date
  }
): Promise<PromotionState> {
  const now = args.now ?? new Date()
  const entitlements =
    container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const tier = getPromotionTier(args.tierCode)
  if (args.tierCode && !tier) {
    throw new Error(`Unknown promotion tier: ${args.tierCode}`)
  }

  const existing = await findPromotion(entitlements, args.sellerId)
  const currentExpiry = existing?.expires_at ?? null

  const expires_at = tier
    ? promotionExpiryFrom(tier.duration_days, now, currentExpiry)
    : null

  await entitlements.grant({
    seller_id: args.sellerId,
    feature_key: PROMOTED_LISTING_FEATURE_KEY,
    kind: EntitlementKind.ACCESS_PASS,
    source: EntitlementSource.MANUAL,
    expires_at,
    metadata: {
      tier: tier?.code ?? "open_ended",
      reason: args.reason ?? null,
    },
  })

  await syncFeaturedFlag(container, args.sellerId, now)

  return {
    active: isPromotionActive(expires_at, now),
    expires_at,
    granted_at: now,
  }
}

/** End a seller's promoted placement now, regardless of remaining time. */
export async function revokePromotion(
  container: MedusaContainer,
  sellerId: string,
  reason?: string
): Promise<boolean> {
  const entitlements =
    container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const revoked = await entitlements.revokeSellerFeatureKeys(
    sellerId,
    [PROMOTED_LISTING_FEATURE_KEY],
    reason
  )

  // Written directly, NOT through `syncFeaturedFlag`. Revoking removes the
  // very entitlement that function reads, so it would see a featured seller
  // with no promotion on record, classify it "unbacked" and leave the flag set
  // — the seller would keep their placement after being revoked.
  await setFeaturedFlag(container, sellerId, false)
  return revoked > 0
}

export type PromotionSweepResult = {
  checked: number
  cleared: number
  set: number
  unbacked: string[]
  failed: number
}

/**
 * Bring every featured seller's flag back in line with their promotion.
 *
 * Sweeps the `featured` rows rather than the entitlement rows: a promotion that
 * lapsed leaves an entitlement whose `expires_at` has passed, but the thing
 * that has to change is the flag, and the set of flagged sellers is small and
 * directly indexed. Each seller is handled in its own try/catch so one bad row
 * cannot abort the batch.
 */
export async function sweepExpiredPromotions(
  container: MedusaContainer,
  now: Date = new Date()
): Promise<PromotionSweepResult> {
  const result: PromotionSweepResult = {
    checked: 0,
    cleared: 0,
    set: 0,
    unbacked: [],
    failed: 0,
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: rows } = await query.graph({
    entity: "seller_metadata",
    fields: ["seller_id"],
    filters: { featured: true },
  })

  for (const row of (rows ?? []) as { seller_id: string }[]) {
    result.checked++
    try {
      const action = await syncFeaturedFlag(container, row.seller_id, now)
      if (action === "clear") result.cleared++
      if (action === "set") result.set++
      if (action === "unbacked") result.unbacked.push(row.seller_id)
    } catch (err) {
      result.failed++
      log.warn(`[promotions] sweep failed for ${row.seller_id}`, err)
    }
  }

  return result
}
