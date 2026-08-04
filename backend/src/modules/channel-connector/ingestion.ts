import type { ChannelOrder } from "./types"

/**
 * Turning a channel's orders into FBM state, decided purely.
 *
 * Phase 10's premise, and the reason this exists at all: **FBM sales and
 * channel sales must decrement one stock pool.** Two stores of stock is exactly
 * the divergence that causes oversell — a vendor sells their last jar on Faire
 * and FBM happily sells it again an hour later, and the person who has to
 * apologise is the vendor.
 *
 * So a channel order takes the same path a POS sale does: resolve each line to
 * a variant's inventory context, plan the decrements, then apply them against
 * Medusa's inventory module. This file is the planning half, kept pure and
 * mirroring `workflows/pos/pos-helpers.ts` deliberately — if the two ever
 * disagree about what a sale does to stock, that disagreement is the bug.
 */

/** A variant's inventory context, resolved by the caller. */
export type ChannelVariantContext = {
  sku: string
  variant_id: string
  manage_inventory: boolean
  inventory_item_id?: string | null
  location_id?: string | null
}

export type ChannelInventoryAdjustment = {
  sku: string
  variant_id: string
  inventory_item_id: string
  location_id: string
  /** Units sold (positive); the caller applies it as a negative delta. */
  quantity: number
}

export type ChannelInventorySkip = {
  sku: string
  reason:
    | "no_sku"
    | "unknown_sku"
    | "not_managed"
    | "no_inventory_item"
    | "no_location_level"
}

export type ChannelInventoryPlan = {
  adjustments: ChannelInventoryAdjustment[]
  skipped: ChannelInventorySkip[]
}

/**
 * What one channel order implies for stock.
 *
 * Channels report SKUs, not variant ids, so resolution goes through the SKU —
 * which is also why an **unmatched SKU is reported rather than ignored**. A
 * silently skipped line means stock was not decremented, and the vendor finds
 * out when they oversell. The caller surfaces these; they are not noise.
 *
 * A SKU appearing on several lines is aggregated into one adjustment, matching
 * the POS planner. Unmanaged variants are skipped without complaint — that is
 * a deliberate configuration, not a failure.
 */
export function planChannelInventoryAdjustments(
  items: readonly { sku: string | null; quantity: number }[],
  variants: readonly ChannelVariantContext[]
): ChannelInventoryPlan {
  const contextBySku = new Map(variants.map((v) => [v.sku, v]))

  const quantityBySku = new Map<string, number>()
  const skipped: ChannelInventorySkip[] = []

  for (const item of items) {
    const sku = item.sku?.trim()
    if (!sku) {
      // A line with no SKU cannot be matched to stock at all. Worth saying so:
      // it is the shape a channel-side listing problem takes.
      skipped.push({ sku: "", reason: "no_sku" })
      continue
    }
    const quantity = Math.max(0, Math.floor(item.quantity || 0))
    if (quantity === 0) continue
    quantityBySku.set(sku, (quantityBySku.get(sku) ?? 0) + quantity)
  }

  const adjustments: ChannelInventoryAdjustment[] = []
  for (const [sku, quantity] of quantityBySku) {
    const context = contextBySku.get(sku)
    if (!context) {
      skipped.push({ sku, reason: "unknown_sku" })
      continue
    }
    if (!context.manage_inventory) {
      skipped.push({ sku, reason: "not_managed" })
      continue
    }
    if (!context.inventory_item_id) {
      skipped.push({ sku, reason: "no_inventory_item" })
      continue
    }
    if (!context.location_id) {
      skipped.push({ sku, reason: "no_location_level" })
      continue
    }
    adjustments.push({
      sku,
      variant_id: context.variant_id,
      inventory_item_id: context.inventory_item_id,
      location_id: context.location_id,
      quantity,
    })
  }

  return { adjustments, skipped }
}

/** What to do with one order the channel handed us. */
export type IngestionDecision =
  /** Never seen — store it and apply its stock effect. */
  | { action: "ingest" }
  /** Seen, and its stock effect already applied. Do nothing. */
  | { action: "skip" }
  /**
   * Seen, but stock was never applied — a crash between writing the row and
   * decrementing. Retry only the inventory half.
   */
  | { action: "apply_inventory"; order_id: string }

export type ExistingOrder = {
  id: string
  inventory_applied: boolean
}

/**
 * Decide what a polled order needs, given what we already stored.
 *
 * The ordering problem this solves, stated plainly because both failures are
 * expensive and they pull in opposite directions:
 *
 * - **Decrement first, then record** — a crash between the two makes the next
 *   poll decrement *again*. Phantom stockout; the vendor loses sales they could
 *   have made.
 * - **Record first, then decrement** — a crash between the two makes the next
 *   poll treat the order as done and *never* decrement. Oversell; the vendor
 *   has to cancel on a real buyer.
 *
 * Neither ordering is safe on its own, so the row carries an
 * `inventory_applied` flag and the two steps are separately resumable: record
 * unapplied, decrement, then stamp applied. A crash anywhere leaves a state the
 * next poll can finish correctly, and the unique index on
 * `(channel_id, external_id)` means a replay can never create a second row to
 * decrement against.
 */
export function decideIngestion(
  existing: ExistingOrder | null
): IngestionDecision {
  if (!existing) return { action: "ingest" }
  if (existing.inventory_applied) return { action: "skip" }
  return { action: "apply_inventory", order_id: existing.id }
}

/**
 * How far order ingestion has now read.
 *
 * Takes the **latest `placed_at` actually ingested**, never "now": a cursor set
 * from the clock silently skips any order the channel had not yet returned when
 * the poll ran, and those orders are simply never seen again. Falls back to the
 * previous cursor when nothing came back, so an empty poll does not move it.
 *
 * Deliberately does not subtract a safety margin. Re-reading an order is free —
 * `decideIngestion` makes it a no-op — whereas advancing past one loses it, so
 * the bias is toward re-reading.
 */
export function nextOrderCursor(
  previous: Date | null,
  ingested: readonly ChannelOrder[]
): Date | null {
  let latest = previous
  for (const order of ingested) {
    const at = order.placed_at
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) continue
    if (!latest || at > latest) latest = at
  }
  return latest
}
