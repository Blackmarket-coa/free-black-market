/**
 * Plant Network — Ship-window gating (Section 3).
 *
 * Layered on the existing `order-cycle` module: `updateOrderCycleStatuses()`
 * already auto-opens/closes cycles (invoked by `jobs/order-cycle-status-update.ts`
 * every 5 min). This adds (a) per-product orderability driven by the plant
 * metadata ship window, and (b) a Blackout notification when cycles close so the
 * Hub gets a fulfillment trigger.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_CYCLE_MODULE } from "./index"
import type OrderCycleModuleService from "./service"
import { emitBlackoutEvent } from "../../lib/blackout-emit"
import { readPlantMetadata } from "../../types/plant"

export type OrderableReason =
  | "available"
  | "window_not_open"
  | "window_closed"
  | "sold_out"
  | "not_found"

export interface OrderableResult {
  orderable: boolean
  reason: OrderableReason
  opens_at?: Date | null
  closes_at?: Date | null
  preorder_available?: boolean
}

type QueryLike = { graph: (args: Record<string, unknown>) => Promise<{ data: any[] }> }

export class PlantShipWindowService {
  private readonly container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private get query(): QueryLike {
    return this.container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  }

  private get orderCycles(): OrderCycleModuleService {
    return this.container.resolve(ORDER_CYCLE_MODULE) as OrderCycleModuleService
  }

  /**
   * Is a product orderable right now? Driven by the plant ship-window metadata,
   * with a best-effort inventory check. `now` is injectable for testing.
   */
  async isProductOrderable(productId: string, now: Date = new Date()): Promise<OrderableResult> {
    const { data: products } = await this.query.graph({
      entity: "product",
      fields: ["id", "metadata", "variants.id", "variants.inventory_quantity"],
      filters: { id: [productId] },
    })
    const product = products?.[0]
    if (!product) return { orderable: false, reason: "not_found" }

    const meta = readPlantMetadata(product.metadata as Record<string, unknown> | null)
    const opensAt = meta.ship_window_open ? new Date(meta.ship_window_open) : null
    const closesAt = meta.ship_window_close ? new Date(meta.ship_window_close) : null
    // `allow_preorder` is an optional metadata flag the storefront may set.
    const allowPreorder =
      (product.metadata as Record<string, unknown> | null)?.allow_preorder === true

    if (opensAt && now < opensAt) {
      return {
        orderable: allowPreorder,
        reason: "window_not_open",
        opens_at: opensAt,
        closes_at: closesAt,
        preorder_available: allowPreorder,
      }
    }
    if (closesAt && now > closesAt) {
      return { orderable: false, reason: "window_closed", opens_at: opensAt, closes_at: closesAt }
    }

    // Best-effort inventory check (only when the field is populated).
    const variants = (product.variants ?? []) as Array<{ inventory_quantity?: number | null }>
    const known = variants.filter((v) => typeof v.inventory_quantity === "number")
    if (known.length > 0 && known.every((v) => (v.inventory_quantity ?? 0) <= 0)) {
      return { orderable: false, reason: "sold_out", opens_at: opensAt, closes_at: closesAt }
    }

    return { orderable: true, reason: "available", opens_at: opensAt, closes_at: closesAt }
  }

  /**
   * Drive the existing cycle status transitions and, when cycles close, emit a
   * Blackout notification so the Hub can trigger fulfillment. Returns the counts
   * from the underlying transition.
   */
  async syncCycleStatuses(): Promise<{ opened: number; closed: number }> {
    const result = await this.orderCycles.updateOrderCycleStatuses()
    if (result.closed > 0) {
      await emitBlackoutEvent(
        this.container,
        "order_cycle.closed",
        { closedCount: result.closed, openedCount: result.opened },
        { eventId: `order_cycle.closed:${Date.now()}` }
      )
    }
    return result
  }
}
