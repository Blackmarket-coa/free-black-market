import { MedusaService } from "@medusajs/framework/utils"
import OrderSubcontract, {
  OrderSubcontractStatus,
} from "./models/order-subcontract"
import SubcontractEvent, {
  SubcontractEventType,
} from "./models/subcontract-event"

export interface ProposeSubcontractInput {
  parentOrderId: string
  parentSellerId: string
  subcontractSellerId: string
  contractId: string
  programId?: string | null
  orderItemIds: string[]
  unitCount: number
  unitPriceCents: number
  currencyCode?: string
  pickupAt?: Date | null
  deliverTo?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

class OrderSubcontractService extends MedusaService({
  OrderSubcontract,
  SubcontractEvent,
}) {
  async proposeSubcontract(input: ProposeSubcontractInput): Promise<any> {
    const total = Math.max(0, input.unitCount * input.unitPriceCents)
    const sub = await (this as any).createOrderSubcontracts({
      parent_order_id: input.parentOrderId,
      parent_seller_id: input.parentSellerId,
      subcontract_seller_id: input.subcontractSellerId,
      contract_id: input.contractId,
      program_id: input.programId ?? null,
      order_item_ids: input.orderItemIds,
      unit_count: input.unitCount,
      unit_price_cents: input.unitPriceCents,
      currency_code: input.currencyCode ?? "usd",
      total_cents: total,
      pickup_at: input.pickupAt ?? null,
      deliver_to: input.deliverTo ?? null,
      metadata: input.metadata ?? null,
    })
    await this.recordEvent({
      subcontractId: sub.id,
      eventType: SubcontractEventType.PROPOSED,
      actorSellerId: input.parentSellerId,
    })
    return sub
  }

  async acceptSubcontract(args: {
    subcontractId: string
    serviceSellerId: string
  }): Promise<any> {
    const list = await this.listOrderSubcontracts({
      id: args.subcontractId,
      subcontract_seller_id: args.serviceSellerId,
    })
    const sub = list[0]
    if (!sub) throw new Error("Subcontract not found")
    if (sub.status !== OrderSubcontractStatus.PROPOSED) {
      throw new Error(`Cannot accept subcontract in status ${sub.status}`)
    }
    const updated = await (this as any).updateOrderSubcontracts({
      id: args.subcontractId,
      status: OrderSubcontractStatus.ACCEPTED,
    })
    await this.recordEvent({
      subcontractId: args.subcontractId,
      eventType: SubcontractEventType.ACCEPTED,
      actorSellerId: args.serviceSellerId,
    })
    return updated
  }

  async attachEscrow(args: {
    subcontractId: string
    escrowLedgerEntryId: string
  }): Promise<any> {
    return (this as any).updateOrderSubcontracts({
      id: args.subcontractId,
      escrow_ledger_entry_id: args.escrowLedgerEntryId,
    })
  }

  async markInProgress(subcontractId: string): Promise<any> {
    const updated = await (this as any).updateOrderSubcontracts({
      id: subcontractId,
      status: OrderSubcontractStatus.IN_PROGRESS,
    })
    await this.recordEvent({
      subcontractId,
      eventType: SubcontractEventType.PRODUCTION_STARTED,
    })
    return updated
  }

  async markDelivered(args: {
    subcontractId: string
    proofId?: string | null
    actorSellerId: string
  }): Promise<any> {
    const updated = await (this as any).updateOrderSubcontracts({
      id: args.subcontractId,
      status: OrderSubcontractStatus.DELIVERED,
    })
    await this.recordEvent({
      subcontractId: args.subcontractId,
      eventType: SubcontractEventType.DELIVERED,
      actorSellerId: args.actorSellerId,
      proofId: args.proofId ?? null,
    })
    return updated
  }

  async markAcceptedByParent(args: {
    subcontractId: string
    parentSellerId: string
    releaseLedgerEntryId: string
  }): Promise<any> {
    const updated = await (this as any).updateOrderSubcontracts({
      id: args.subcontractId,
      status: OrderSubcontractStatus.ACCEPTED_BY_PARENT,
      release_ledger_entry_id: args.releaseLedgerEntryId,
    })
    await this.recordEvent({
      subcontractId: args.subcontractId,
      eventType: SubcontractEventType.ACCEPTED_BY_PARENT,
      actorSellerId: args.parentSellerId,
    })
    return updated
  }

  async dispute(args: {
    subcontractId: string
    actorSellerId: string
    reason: string
  }): Promise<any> {
    const updated = await (this as any).updateOrderSubcontracts({
      id: args.subcontractId,
      status: OrderSubcontractStatus.DISPUTED,
      dispute_reason: args.reason,
    })
    await this.recordEvent({
      subcontractId: args.subcontractId,
      eventType: SubcontractEventType.DISPUTED,
      actorSellerId: args.actorSellerId,
      note: args.reason,
    })
    return updated
  }

  async cancel(args: {
    subcontractId: string
    actorSellerId: string
  }): Promise<any> {
    const updated = await (this as any).updateOrderSubcontracts({
      id: args.subcontractId,
      status: OrderSubcontractStatus.CANCELED,
    })
    await this.recordEvent({
      subcontractId: args.subcontractId,
      eventType: SubcontractEventType.CANCELED,
      actorSellerId: args.actorSellerId,
    })
    return updated
  }

  async recordEvent(args: {
    subcontractId: string
    eventType: SubcontractEventType
    actorSellerId?: string | null
    proofId?: string | null
    note?: string | null
    metadata?: Record<string, unknown> | null
  }): Promise<any> {
    return (this as any).createSubcontractEvents({
      subcontract_id: args.subcontractId,
      event_type: args.eventType,
      actor_seller_id: args.actorSellerId ?? null,
      proof_id: args.proofId ?? null,
      note: args.note ?? null,
      occurred_at: new Date(),
      metadata: args.metadata ?? null,
    })
  }
}

export default OrderSubcontractService
