/**
 * Plant Network — Ship-window gating (Section 3).
 *
 * The `order-cycle` module already models time-bounded ordering: OrderCycle has
 * a draft→upcoming→open→closed→dispatched workflow (see `service.ts`,
 * `getActiveOrderCycles` / `getUpcomingOrderCycles`), ShareBox templates, and
 * fees. The subscriber `subscribers/order-cycle-order-placed.ts` already reacts
 * to orders, and `links/order-order-cycle.ts` links orders to cycles.
 *
 * What is MISSING: per-product ship-window gating driven by the plant metadata
 * (`ship_window_open` / `ship_window_close` in `types/plant.ts`) and a daily job
 * to auto-open/close cycles. These stubs are meant to be folded into the
 * existing OrderCycleService status workflow, not run as a parallel scheduler.
 */

import type { PlantProductMetadata } from "../../types/plant"

export type OrderableReason =
  | "available"
  | "window_not_open"
  | "window_closed"
  | "sold_out"

export interface OrderableResult {
  orderable: boolean
  reason: OrderableReason
  opens_at?: Date
  closes_at?: Date
  preorder_available?: boolean
}

export class PlantShipWindowService {
  /**
   * TODO: Determine if a product is orderable right now.
   * Read `ship_window_open` / `ship_window_close` from product metadata
   * (`readPlantMetadata`), cross-check any active OrderCycle for the product
   * (reuse OrderCycleService.getActiveOrderCycles), and fall back to inventory.
   * Called at checkout and by the storefront availability badge.
   */
  async isProductOrderable(
    _product_id: string,
    _plantMeta?: PlantProductMetadata
  ): Promise<OrderableResult> {
    throw new Error("TODO: PlantShipWindowService.isProductOrderable not implemented")
  }

  /**
   * TODO: Daily cron (add under `backend/src/jobs/`, alongside the existing jobs).
   * Transition OrderCycle rows whose opens_at/closes_at have passed using the
   * EXISTING status workflow in OrderCycleService (do not re-implement the state
   * machine). On close, emit the Hub fulfillment trigger via the existing
   * Blackout Matrix subscriber path.
   */
  async syncCycleStatuses(): Promise<void> {
    throw new Error("TODO: PlantShipWindowService.syncCycleStatuses not implemented")
  }
}
