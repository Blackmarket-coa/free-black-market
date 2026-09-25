import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
} from "@medusajs/framework/types"

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
 * board listing. Cancelling works the same way, on
 * `order.fulfillment_canceled` in
 * `subscribers/blackstar-fulfillment-canceled.ts`.
 *
 * That work lives in subscribers because it cannot live here. Medusa
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
   * Nothing to do here: the cancel's work happens on
   * `order.fulfillment_canceled`, in
   * `subscribers/blackstar-fulfillment-canceled.ts`, which marks the
   * BlackstarShipment row `cancelled` through the inbound bridge's ordering
   * guard and sends Blackstar `order.cancelled` once the order has no live
   * Blackstar shipment left.
   *
   * It used to be attempted here, by resolving the blackstar-fulfillment
   * module through `this.container_` — the fulfillment module's cradle, where
   * that call throws (see the class comment). As registered by Medusa it
   * logged an error and returned `{}` without touching the row.
   */
  async cancelFulfillment(): Promise<any> {
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
