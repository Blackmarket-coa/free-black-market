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
import { emitBlackstarEvent } from "../../lib/blackstar-emit"

/**
 * Stub Blackstar fulfillment provider. Registered in medusa-config.ts only
 * when FBM_BLACKSTAR_INTEGRATION=1. Returns no-op success and persists the
 * three placeholder identifiers (`fulfillment_node_id`, `pickup_point_id`,
 * `vending_machine_id`) into BlackstarShipment so Blackstar's webhook
 * receiver can later update status by order_id.
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
      { id: "blackstar-return", name: "Blackstar Return", is_return: true },
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

  async createFulfillment(
    data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const orderId = (order?.id ?? (data as any).order_id ?? "") as string
    const fulfillmentNodeId = (data.fulfillment_node_id ?? null) as string | null
    const pickupPointId = (data.pickup_point_id ?? null) as string | null
    const vendingMachineId = (data.vending_machine_id ?? null) as string | null

    if (orderId) {
      try {
        const service = this.container_.resolve(
          BLACKSTAR_FULFILLMENT_MODULE
        ) as BlackstarFulfillmentModuleService
        await service.recordOrUpdateShipment({
          order_id: orderId,
          fulfillment_id: fulfillment?.id ?? null,
          fulfillment_node_id: fulfillmentNodeId,
          pickup_point_id: pickupPointId,
          vending_machine_id: vendingMachineId,
          external_status: "pending",
          metadata: (data.metadata as Record<string, unknown> | undefined) ?? null,
        })
      } catch (err) {
        log.error("[blackstar-fulfillment] failed to persist BlackstarShipment", err)
      }

      // The contract's delivery.option.selected moment: a Blackstar shipping
      // option was actually fulfilled. Blackstar creates its shipment board
      // listing idempotently from source_order_ref, so a retried fulfillment
      // re-emits harmlessly. Note: created_by_user_id is deliberately absent —
      // FBM has no Blackstar user identity to send; the listing-side default
      // is Blackstar's to own (tracked as a contract gap in the partner spec).
      try {
        await emitBlackstarEvent(
          this.container_,
          "delivery.option.selected",
          {
            delivery_option: "federated_delivery_network",
            source_order_ref: orderId,
            claim_policy: "first_claim",
            job_type: "delivery",
            fulfillment_node_id: fulfillmentNodeId,
            pickup_point_id: pickupPointId,
            vending_machine_id: vendingMachineId,
          },
          {
            eventId: `blackstar:delivery.option.selected:${orderId}:${fulfillment?.id ?? "none"}`,
            correlationId: orderId,
          }
        )
      } catch (err) {
        log.error("[blackstar-fulfillment] failed to emit delivery.option.selected", err)
      }
    }

    return { data, labels: [] }
  }

  async cancelFulfillment(): Promise<any> {
    return {}
  }

  async createReturnFulfillment(): Promise<any> {
    return {}
  }
}

export default BlackstarFulfillmentProviderService
