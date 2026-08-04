import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import {
  addonExpiryFrom,
  getAddonDefinition,
  listPurchasableAddons,
  type VendorAddonDefinition,
} from "../modules/vendor-plan/addons"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"
import {
  EntitlementKind,
  EntitlementSource,
  EntitlementStatus,
} from "../modules/entitlement/models/entitlement"
import { invalidateSellerPlan } from "./plan-entitlement-cache"

const log = createLogger("shared/vendor-addons")

/**
 * Grant, inspect and revoke add-on packs (`vendor-plan/addons.ts`).
 *
 * An owned pack is one seller-keyed `ACCESS_PASS` entitlement per feature key,
 * each carrying the pack's expiry and `metadata.addon = <code>`. That makes the
 * gate side free: `loadSellerPlanSnapshot` already unions active, unexpired
 * seller entitlements on top of plan keys, so a granted pack opens
 * `requirePlanFeature` immediately and lapses by itself at expiry — there is
 * no sweep between "expired" and "locked".
 *
 * Renewal EXTENDS: like promotions, a repeat grant computes its expiry from
 * the pack's current end (when still open) and writes fresh rows. Old rows
 * expire naturally; `listActiveFeatureKeysForSeller` de-duplicates keys, so
 * row accumulation is cosmetic, one row per key per purchase.
 *
 * Every write path ends by invalidating the seller's plan-snapshot cache —
 * a vendor who just paid must not wait out a 30s TTL to use what they bought.
 */

export type AddonOwnership = {
  code: string
  active: boolean
  expires_at: Date | null
}

type EntitlementRow = {
  id: string
  feature_key: string
  expires_at: Date | string | null
  metadata?: Record<string, unknown> | null
}

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Active entitlement rows this pack has granted the seller. */
async function findAddonRows(
  entitlements: EntitlementModuleService,
  sellerId: string,
  code: string
): Promise<EntitlementRow[]> {
  const rows = (await entitlements.listEntitlements({
    seller_id: sellerId,
    status: EntitlementStatus.ACTIVE,
  })) as unknown as EntitlementRow[]
  return (rows ?? []).filter((r) => r.metadata?.addon === code)
}

/** The pack's current window end: the latest expiry among its rows. */
function currentExpiry(rows: EntitlementRow[]): Date | null {
  let latest: Date | null = null
  for (const row of rows) {
    const expires = asDate(row.expires_at)
    if (expires && (!latest || expires.getTime() > latest.getTime())) {
      latest = expires
    }
  }
  return latest
}

/**
 * Grant a pack (extending its window when one is open).
 *
 * Throws on an unknown code — a grant is always downstream of a validated
 * purchase or an operator action, and silently granting nothing would report
 * fulfilment success for a pack that does not exist.
 */
export async function grantAddon(
  container: MedusaContainer,
  args: {
    sellerId: string
    code: string
    reason?: string | null
    now?: Date
  }
): Promise<AddonOwnership> {
  const addon = getAddonDefinition(args.code)
  if (!addon) {
    throw new Error(`Unknown add-on: ${args.code}`)
  }

  const now = args.now ?? new Date()
  const entitlements =
    container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const existing = await findAddonRows(entitlements, args.sellerId, addon.code)
  const expires_at = addonExpiryFrom(
    addon.duration_days,
    now,
    currentExpiry(existing)
  )

  for (const feature_key of addon.feature_keys) {
    await entitlements.grant({
      seller_id: args.sellerId,
      feature_key,
      kind: EntitlementKind.ACCESS_PASS,
      source: EntitlementSource.MANUAL,
      expires_at,
      metadata: {
        addon: addon.code,
        reason: args.reason ?? null,
      },
    })
  }

  // The vendor just gained features; the gate must see them now, not after
  // the snapshot TTL runs out.
  invalidateSellerPlan(args.sellerId)

  return { code: addon.code, active: true, expires_at }
}

/**
 * End a pack now, regardless of remaining time (refund, dispute, operator
 * removal). Revokes only rows this pack granted — a key the seller also holds
 * from another source is untouched. Idempotent when nothing is active.
 */
export async function revokeAddon(
  container: MedusaContainer,
  sellerId: string,
  code: string,
  reason?: string
): Promise<number> {
  const entitlements =
    container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const rows = await findAddonRows(entitlements, sellerId, code)
  if (!rows.length) return 0

  await entitlements.updateEntitlements(
    rows.map((r) => ({
      id: r.id,
      status: EntitlementStatus.REVOKED,
      revoked_at: new Date(),
      revoked_reason: reason ?? null,
    }))
  )

  invalidateSellerPlan(sellerId)
  return rows.length
}

/**
 * Where the seller stands on every purchasable pack. Never throws — this
 * backs a storefront-of-packs screen, and a lookup failure should read as
 * "nothing owned", not a 500.
 */
export async function getAddonOwnership(
  container: MedusaContainer,
  sellerId: string,
  now: Date = new Date()
): Promise<AddonOwnership[]> {
  let rows: EntitlementRow[] = []
  try {
    const entitlements =
      container.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
    rows = (await entitlements.listEntitlements({
      seller_id: sellerId,
      status: EntitlementStatus.ACTIVE,
    })) as unknown as EntitlementRow[]
  } catch (err) {
    log.warn(`[addons] ownership lookup failed for ${sellerId}`, err)
    rows = []
  }

  return listPurchasableAddons().map((addon: VendorAddonDefinition) => {
    const mine = (rows ?? []).filter((r) => r.metadata?.addon === addon.code)
    const expires = currentExpiry(mine)
    return {
      code: addon.code,
      active: expires !== null && expires.getTime() > now.getTime(),
      expires_at: expires,
    }
  })
}
