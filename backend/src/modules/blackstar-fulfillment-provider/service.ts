import { createLogger } from "../../shared/logger"
const log = createLogger("modules/blackstar-fulfillment-provider/service")
import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
} from "@medusajs/framework/types"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../blackstar-fulfillment/service"
import { decideStatusWrite } from "../blackstar-fulfillment/shipment-lifecycle"

/**
 * Blackstar fulfillment provider: hands an order to Blackstar's federated
 * delivery network. Registered in medusa-config.ts only when
 * FBM_BLACKSTAR_INTEGRATION=1.
 *
 * The provider itself creates no label and books no carrier —
 * `createFulfillment` returns the shipping method's data unchanged with no
 * labels. The real work happens on `order.fulfillment_created`, in
 * `subscribers/emit-blackstar-delivery-option-selected.ts`: it records the
 * BlackstarShipment row (with `fulfillment_node_id` / `pickup_point_id` /
 * `vending_machine_id` when the shipping data carries them) that
 * Blackstar's lifecycle webhooks update by order, and emits
 * `delivery.option.selected`, from which Blackstar creates the shipment
 * board listing.
 *
 * That work lives in a subscriber because it cannot live here. Medusa
 * constructs a fulfillment provider with the fulfillment module's own
 * container cradle, which holds only that module's dependencies (logger,
 * event bus, manager, config, pg connection, caching) — not `query` and not
 * any FBM module. A cradle has no `resolve` method either: the property is
 * itself looked up as a registration, so `this.container_.resolve(...)`
 * throws before it resolves anything.
 *
 * Adapted from `printful-fulfillment` and `digital-product-fulfillment`,
 * both of which extend AbstractFulfillmentProviderService.
 */
class BlackstarFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "blackstar"

  protected readonly container_: any

  constructor(container: any) {
    super()
    this.container_ = container
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: "blackstar-locker", name: "Blackstar Locker", is_return: false },
      { id: "blackstar-pickup-point", name: "Blackstar Pickup Point", is_return: false },
      { id: "blackstar-vending-machine", name: "Blackstar Vending Machine", is_return: false },
      // No return option. One was advertised here while
      // `createReturnFulfillment` returned `{}`, which let a return "complete"
      // with nothing collected and no listing created. Advertise it again
      // when a return flow exists on both sides of the bridge.
    ]
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return data
  }

  async validateOption(_data: Record<string, any>): Promise<boolean> {
    return true
  }

  /**
   * Returns the shipping method's data unchanged, with no labels. The
   * BlackstarShipment row and the `delivery.option.selected` emit happen on
   * `order.fulfillment_created` (see the class comment for why not here).
   */
  async createFulfillment(
    data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    _order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    return { data, labels: [] }
  }

  /**
   * Cancel a Blackstar fulfillment: the local-state half.
   *
   * This used to be `return {}` — a cancelled fulfillment left its
   * blackstar_shipment reading whatever it last read, so an operator looking
   * at the row could not tell a cancelled parcel from a stuck one. Now the
   * matching shipment (by fulfillment id when the data carries one, else
   * every shipment on the order) is moved to `cancelled` through the same
   * ordering guard the inbound bridge uses, so a parcel already delivered or
   * disputed is left alone rather than rewritten.
   *
   * The emit half is deliberately absent. `order.cancelled` on the wire means
   * the whole order (contract §6) and is already sent by
   * `subscribers/emit-blackstar-order-cancel.ts`; a per-fulfillment cancel
   * has no event in contract v1, and inventing one FBM-side would be a wire
   * change Blackstar has not agreed to. Recorded rather than pretended.
   *
   * Known gap: the local-state half resolves the blackstar-fulfillment module
   * through `this.container_`, which (see the class comment) is the
   * fulfillment module's cradle, where that call throws. As registered by
   * Medusa it therefore logs and returns `{}` without touching the row. It
   * needs the same move `createFulfillment`'s work made — to a subscriber on
   * `order.fulfillment_canceled` — which has not been done.
   */
  async cancelFulfillment(data: Record<string, unknown> = {}): Promise<any> {
    const orderId = String((data as any)?.order_id ?? "")
    const fulfillmentId = (data as any)?.fulfillment_id
      ? String((data as any).fulfillment_id)
      : null
    if (!orderId) return {}

    try {
      const service = this.container_.resolve(
        BLACKSTAR_FULFILLMENT_MODULE
      ) as BlackstarFulfillmentModuleService
      const rows = (await service.listBlackstarShipments({
        order_id: orderId,
        ...(fulfillmentId ? { fulfillment_id: fulfillmentId } : {}),
      })) as unknown as {
        id: string
        external_status?: string | null
        metadata?: Record<string, unknown> | null
      }[]

      for (const row of rows) {
        const decision = decideStatusWrite(row.external_status, "cancelled")
        if (!decision.apply) {
          log.info(
            `[blackstar-fulfillment] cancel: shipment ${row.id} is ${row.external_status}; not rewinding (${decision.reason})`
          )
          continue
        }
        await service.updateBlackstarShipments([
          {
            id: row.id,
            external_status: "cancelled",
            metadata: {
              ...(row.metadata ?? {}),
              cancelled_locally_at: new Date().toISOString(),
              cancelled_via: "fulfillment_provider",
            },
          },
        ])
      }
    } catch (err) {
      log.error("[blackstar-fulfillment] cancelFulfillment failed", err)
    }

    return {}
  }

  /**
   * Returns are not supported on this provider yet, and the option is no
   * longer advertised. Throwing here is the backstop for any caller that
   * still holds an old option id: a return that "succeeds" by doing nothing
   * is a parcel the buyer thinks is on its way back and nobody is collecting.
   */
  async createReturnFulfillment(): Promise<any> {
    throw new Error(
      "Blackstar returns are not supported yet: no return flow exists on the bridge. " +
        "Use a different return provider for this order."
    )
  }
}

export default BlackstarFulfillmentProviderService
