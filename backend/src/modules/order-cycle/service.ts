import { MedusaService } from "@medusajs/framework/utils"
import {
  OrderCycle,
  OrderCycleProduct,
  OrderCycleSeller,
  OrderCycleExchange,
  OrderCycleFee,
  EnterpriseFee,
  ShareBoxTemplate,
  ShareBoxSubscription,
  ShareBox,
} from "./models"

type _OrderCycleStatus = "draft" | "upcoming" | "open" | "closed" | "dispatched" | "cancelled"
type FeeType = "admin" | "packing" | "transport" | "fundraising" | "sales" | "coordinator"
type CalculatorType = "flat_rate" | "flat_per_item" | "percentage" | "weight"
type _ExchangeType = "incoming" | "outgoing"
type ApplicationType = "coordinator" | "incoming" | "outgoing"

export type ShareBoxSlot = {
  key: string
  label?: string
  quantity: number
  candidate_variant_ids?: string[]
  tag?: string | null
}

export type ShareBoxSlotOverride = {
  candidate_variant_ids?: string[]
  skip?: boolean
}

export type ShareBoxItem = {
  slot_key: string
  variant_id: string
  quantity: number
  unit_price: number
  currency_code: string
}

class OrderCycleModuleService extends MedusaService({
  OrderCycle,
  OrderCycleProduct,
  OrderCycleSeller,
  OrderCycleExchange,
  OrderCycleFee,
  EnterpriseFee,
  ShareBoxTemplate,
  ShareBoxSubscription,
  ShareBox,
}) {
  // ==================== ORDER CYCLE METHODS ====================

  async getActiveOrderCycles(sellerId?: string) {
    const now = new Date()

    const filters: Record<string, unknown> = {
      status: "open",
      opens_at: { $lte: now },
      closes_at: { $gte: now },
    }

    if (sellerId) {
      const sellerCycles = await this.listOrderCycleSellers({
        seller_id: sellerId,
        is_active: true,
      })

      const cycleIds = sellerCycles.map((sc) => sc.id)
      if (cycleIds.length === 0) return []

      filters.id = cycleIds
    }

    return this.listOrderCycles(filters)
  }

  async getUpcomingOrderCycles(sellerId?: string, limit = 10) {
    const now = new Date()

    const filters: Record<string, unknown> = {
      status: ["draft", "upcoming"],
      opens_at: { $gt: now },
    }

    if (sellerId) {
      const sellerCycles = await this.listOrderCycleSellers({
        seller_id: sellerId,
        is_active: true,
      })

      const cycleIds = sellerCycles.map((sc) => sc.id)
      if (cycleIds.length === 0) return []

      filters.id = cycleIds
    }

    return this.listOrderCycles(filters, {
      order: { opens_at: "ASC" },
      take: limit,
    })
  }

  async updateOrderCycleStatuses(): Promise<{ opened: number; closed: number }> {
    const now = new Date()
    const results = { opened: 0, closed: 0 }

    const toOpen = await this.listOrderCycles({
      status: ["draft", "upcoming"],
      opens_at: { $lte: now },
      closes_at: { $gt: now },
    })

    for (const cycle of toOpen) {
      await this.updateOrderCycles({ id: cycle.id, status: "open" })
      results.opened++
    }

    const toClose = await this.listOrderCycles({
      status: "open",
      closes_at: { $lte: now },
    })

    for (const cycle of toClose) {
      await this.updateOrderCycles({ id: cycle.id, status: "closed" })
      results.closed++
    }

    return results
  }

  // ==================== EXCHANGE METHODS ====================

  async createIncomingExchange(
    orderCycleId: string,
    producerId: string,
    receiverId: string,
    data?: {
      pickup_time?: string
      pickup_instructions?: string
    }
  ) {
    const existing = await this.listOrderCycleExchanges({
      order_cycle_id: orderCycleId,
      exchange_type: "incoming",
      seller_id: producerId,
    })

    if (existing.length > 0) {
      return this.updateOrderCycleExchanges({
        id: existing[0].id,
        receiver_id: receiverId,
        pickup_time: data?.pickup_time,
        pickup_instructions: data?.pickup_instructions,
        is_active: true,
      })
    }

    return this.createOrderCycleExchanges({
      order_cycle_id: orderCycleId,
      exchange_type: "incoming" as const,
      seller_id: producerId,
      receiver_id: receiverId,
      pickup_time: data?.pickup_time,
      pickup_instructions: data?.pickup_instructions,
    })
  }

  async createOutgoingExchange(
    orderCycleId: string,
    distributorId: string,
    data?: {
      ready_at?: Date
      pickup_time?: string
      pickup_instructions?: string
    }
  ) {
    const existing = await this.listOrderCycleExchanges({
      order_cycle_id: orderCycleId,
      exchange_type: "outgoing",
      seller_id: distributorId,
    })

    if (existing.length > 0) {
      return this.updateOrderCycleExchanges({
        id: existing[0].id,
        ready_at: data?.ready_at,
        pickup_time: data?.pickup_time,
        pickup_instructions: data?.pickup_instructions,
        is_active: true,
      })
    }

    return this.createOrderCycleExchanges({
      order_cycle_id: orderCycleId,
      exchange_type: "outgoing" as const,
      seller_id: distributorId,
      ready_at: data?.ready_at,
      pickup_time: data?.pickup_time,
      pickup_instructions: data?.pickup_instructions,
    })
  }

  async getIncomingExchanges(orderCycleId: string, onlyActive = true) {
    const filters: Record<string, unknown> = {
      order_cycle_id: orderCycleId,
      exchange_type: "incoming",
    }
    if (onlyActive) filters.is_active = true

    return this.listOrderCycleExchanges(filters)
  }

  async getOutgoingExchanges(orderCycleId: string, onlyActive = true) {
    const filters: Record<string, unknown> = {
      order_cycle_id: orderCycleId,
      exchange_type: "outgoing",
    }
    if (onlyActive) filters.is_active = true

    return this.listOrderCycleExchanges(filters)
  }

  async addProductsToExchange(
    exchangeId: string,
    products: Array<{
      variant_id: string
      seller_id: string
      available_quantity?: number
      override_price?: number
    }>
  ) {
    const exchange = await this.retrieveOrderCycleExchange(exchangeId)
    const results: any[] = []

    for (const product of products) {
      const existing = await this.listOrderCycleProducts({
        order_cycle_id: exchange.order_cycle_id,
        variant_id: product.variant_id,
      })

      if (existing.length > 0) {
        const updated = await this.updateOrderCycleProducts({
          id: existing[0].id,
          exchange_id: exchangeId,
          available_quantity: product.available_quantity,
          override_price: product.override_price,
        })
        results.push(updated)
      } else {
        const created = await this.createOrderCycleProducts({
          order_cycle_id: exchange.order_cycle_id,
          exchange_id: exchangeId,
          variant_id: product.variant_id,
          seller_id: product.seller_id,
          available_quantity: product.available_quantity,
          override_price: product.override_price,
        })
        results.push(created)
      }
    }

    return results
  }

  // ==================== ENTERPRISE FEE METHODS ====================

  async createFeeTemplate(
    sellerId: string,
    data: {
      name: string
      description?: string
      fee_type: FeeType
      calculator_type: CalculatorType
      amount: number
      currency_code?: string
      tax_category_id?: string
      inherits_tax_category?: boolean
    }
  ) {
    return this.createEnterpriseFees({
      seller_id: sellerId,
      name: data.name,
      description: data.description,
      fee_type: data.fee_type as any,
      calculator_type: data.calculator_type as any,
      amount: data.amount,
      currency_code: data.currency_code,
      tax_category_id: data.tax_category_id,
      inherits_tax_category: data.inherits_tax_category,
    })
  }

  async getSellerFeeTemplates(sellerId: string, onlyActive = true) {
    const filters: Record<string, unknown> = { seller_id: sellerId }
    if (onlyActive) filters.is_active = true

    return this.listEnterpriseFees(filters)
  }

  async applyFeeToOrderCycle(
    orderCycleId: string,
    enterpriseFeeId: string,
    applicationType: ApplicationType,
    targetSellerId?: string
  ) {
    if ((applicationType === "incoming" || applicationType === "outgoing") && !targetSellerId) {
      throw new Error(`${applicationType} fees require a target seller ID`)
    }

    const existing = await this.listOrderCycleFees({
      order_cycle_id: orderCycleId,
      enterprise_fee_id: enterpriseFeeId,
      application_type: applicationType,
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return this.createOrderCycleFees({
      order_cycle_id: orderCycleId,
      enterprise_fee_id: enterpriseFeeId,
      application_type: applicationType as any,
      target_seller_id: targetSellerId,
    })
  }

  async getOrderCycleFees(orderCycleId: string, applicationType?: ApplicationType) {
    const filters: Record<string, unknown> = { order_cycle_id: orderCycleId }
    if (applicationType) filters.application_type = applicationType

    return this.listOrderCycleFees(filters)
  }

  async calculateFeesForProduct(
    orderCycleId: string,
    variantId: string,
    productPrice: number,
    quantity: number,
    weight?: number
  ): Promise<{
    coordinator_fees: number
    incoming_fees: number
    outgoing_fees: number
    total_fees: number
    fee_breakdown: Array<{
      fee_id: string
      fee_name: string
      fee_type: string
      application_type: string
      amount: number
    }>
  }> {
    const product = await this.listOrderCycleProducts({
      order_cycle_id: orderCycleId,
      variant_id: variantId,
    })

    if (product.length === 0) {
      throw new Error("Product not found in order cycle")
    }

    const sellerId = product[0].seller_id
    const fees = await this.listOrderCycleFees({
      order_cycle_id: orderCycleId,
    })

    let coordinatorFees = 0
    let incomingFees = 0
    let outgoingFees = 0
    const feeBreakdown: Array<{
      fee_id: string
      fee_name: string
      fee_type: string
      application_type: string
      amount: number
    }> = []

    for (const ocFee of fees) {
      if (ocFee.application_type !== "coordinator" && ocFee.target_seller_id !== sellerId) {
        continue
      }

      const fee = await this.retrieveEnterpriseFee(ocFee.enterprise_fee_id)
      let feeAmount = 0

      switch (fee.calculator_type) {
        case "flat_rate":
          feeAmount = Number(fee.amount)
          break
        case "flat_per_item":
          feeAmount = Number(fee.amount) * quantity
          break
        case "percentage":
          feeAmount = Math.round((productPrice * quantity * Number(fee.amount)) / 10000)
          break
        case "weight":
          if (weight) {
            feeAmount = Math.round(Number(fee.amount) * weight * quantity)
          }
          break
      }

      feeBreakdown.push({
        fee_id: fee.id,
        fee_name: fee.name,
        fee_type: fee.fee_type,
        application_type: ocFee.application_type,
        amount: feeAmount,
      })

      switch (ocFee.application_type) {
        case "coordinator":
          coordinatorFees += feeAmount
          break
        case "incoming":
          incomingFees += feeAmount
          break
        case "outgoing":
          outgoingFees += feeAmount
          break
      }
    }

    return {
      coordinator_fees: coordinatorFees,
      incoming_fees: incomingFees,
      outgoing_fees: outgoingFees,
      total_fees: coordinatorFees + incomingFees + outgoingFees,
      fee_breakdown: feeBreakdown,
    }
  }

  // ==================== PRODUCT METHODS ====================

  async addProductToOrderCycle(
    orderCycleId: string,
    variantId: string,
    sellerId: string,
    data?: {
      exchange_id?: string
      available_quantity?: number
      override_price?: number
      is_visible?: boolean
      display_order?: number
    }
  ) {
    const existing = await this.listOrderCycleProducts({
      order_cycle_id: orderCycleId,
      variant_id: variantId,
    })

    if (existing.length > 0) {
      return this.updateOrderCycleProducts({
        id: existing[0].id,
        ...data,
      })
    }

    return this.createOrderCycleProducts({
      order_cycle_id: orderCycleId,
      variant_id: variantId,
      seller_id: sellerId,
      ...data,
    })
  }

  async addSellerToOrderCycle(
    orderCycleId: string,
    sellerId: string,
    role: "coordinator" | "producer" | "hub" = "producer",
    commissionRate?: number
  ) {
    const existing = await this.listOrderCycleSellers({
      order_cycle_id: orderCycleId,
      seller_id: sellerId,
    })

    if (existing.length > 0) {
      return this.updateOrderCycleSellers({
        id: existing[0].id,
        role: role as any,
        commission_rate: commissionRate,
        is_active: true,
      })
    }

    return this.createOrderCycleSellers({
      order_cycle_id: orderCycleId,
      seller_id: sellerId,
      role: role as any,
      commission_rate: commissionRate,
    })
  }

  async getOrderCycleProducts(orderCycleId: string, onlyVisible = true) {
    const filters: Record<string, unknown> = { order_cycle_id: orderCycleId }
    if (onlyVisible) filters.is_visible = true

    return this.listOrderCycleProducts(filters, {
      order: { display_order: "ASC" },
    })
  }

  async getOrderCycleSellers(orderCycleId: string, onlyActive = true) {
    const filters: Record<string, unknown> = { order_cycle_id: orderCycleId }
    if (onlyActive) filters.is_active = true

    return this.listOrderCycleSellers(filters)
  }

  async checkProductAvailability(
    orderCycleId: string,
    variantId: string,
    requestedQuantity: number
  ): Promise<{
    available: boolean
    reason?: string
    maxQuantity?: number
  }> {
    const cycle = await this.retrieveOrderCycle(orderCycleId)

    if (cycle.status !== "open") {
      return {
        available: false,
        reason: `Order cycle is ${cycle.status}, not accepting orders`,
      }
    }

    const products = await this.listOrderCycleProducts({
      order_cycle_id: orderCycleId,
      variant_id: variantId,
    })

    if (products.length === 0) {
      return {
        available: false,
        reason: "Product not available in this order cycle",
      }
    }

    const cycleProduct = products[0]

    if (!cycleProduct.is_visible) {
      return {
        available: false,
        reason: "Product is not currently visible",
      }
    }

    if (cycleProduct.available_quantity !== null) {
      const remaining = cycleProduct.available_quantity - cycleProduct.sold_quantity

      if (remaining < requestedQuantity) {
        return {
          available: false,
          reason: `Only ${remaining} units available`,
          maxQuantity: remaining,
        }
      }
    }

    return { available: true }
  }

  async recordSale(orderCycleId: string, variantId: string, quantity: number) {
    const products = await this.listOrderCycleProducts({
      order_cycle_id: orderCycleId,
      variant_id: variantId,
    })

    if (products.length === 0) {
      throw new Error("Product not found in order cycle")
    }

    const product = products[0]

    return this.updateOrderCycleProducts({
      id: product.id,
      sold_quantity: product.sold_quantity + quantity,
    })
  }

  async cloneOrderCycle(
    sourceOrderCycleId: string,
    newDates: {
      opens_at: Date
      closes_at: Date
      dispatch_at: Date
    }
  ) {
    const source = await this.retrieveOrderCycle(sourceOrderCycleId)

    const sourceProducts = await this.listOrderCycleProducts({
      order_cycle_id: sourceOrderCycleId,
    })

    const sourceSellers = await this.listOrderCycleSellers({
      order_cycle_id: sourceOrderCycleId,
    })

    const sourceExchanges = await this.listOrderCycleExchanges({
      order_cycle_id: sourceOrderCycleId,
    })

    const sourceFees = await this.listOrderCycleFees({
      order_cycle_id: sourceOrderCycleId,
    })

    const newCycle = await this.createOrderCycles({
      name: source.name,
      description: source.description,
      opens_at: newDates.opens_at,
      closes_at: newDates.closes_at,
      dispatch_at: newDates.dispatch_at,
      status: "draft" as any,
      coordinator_seller_id: source.coordinator_seller_id,
      is_recurring: source.is_recurring,
      recurrence_rule: source.recurrence_rule,
      pickup_instructions: source.pickup_instructions,
      pickup_location: source.pickup_location,
      ready_for_text: source.ready_for_text,
    })

    const exchangeIdMap = new Map<string, string>()

    for (const exchange of sourceExchanges) {
      const newExchange = await this.createOrderCycleExchanges({
        order_cycle_id: newCycle.id,
        exchange_type: exchange.exchange_type as any,
        seller_id: exchange.seller_id,
        receiver_id: exchange.receiver_id,
        pickup_time: exchange.pickup_time,
        pickup_instructions: exchange.pickup_instructions,
        ready_at: exchange.ready_at,
        is_active: exchange.is_active,
      })
      exchangeIdMap.set(exchange.id, newExchange.id)
    }

    for (const product of sourceProducts) {
      await this.createOrderCycleProducts({
        order_cycle_id: newCycle.id,
        exchange_id: product.exchange_id ? exchangeIdMap.get(product.exchange_id) : undefined,
        variant_id: product.variant_id,
        seller_id: product.seller_id,
        available_quantity: product.available_quantity,
        override_price: product.override_price,
        is_visible: product.is_visible,
        display_order: product.display_order,
        sold_quantity: 0,
      })
    }

    for (const seller of sourceSellers) {
      await this.createOrderCycleSellers({
        order_cycle_id: newCycle.id,
        seller_id: seller.seller_id,
        role: seller.role as any,
        commission_rate: seller.commission_rate,
        is_active: seller.is_active,
      })
    }

    for (const fee of sourceFees) {
      await this.createOrderCycleFees({
        order_cycle_id: newCycle.id,
        enterprise_fee_id: fee.enterprise_fee_id,
        application_type: fee.application_type as any,
        target_seller_id: fee.target_seller_id,
        display_order: fee.display_order,
      })
    }

    return newCycle
  }

  // ==================== SHARE BOX SCHEDULER ====================
  //
  // Implements the share-box primitive named in
  // AGGRESSIVE_OPERATIONS_GUIDE.md §5.1 ("Order Cycles share-box scheduler
  // on top of the existing `order-cycle` and `food-distribution` modules").

  private validateSlots(slots: unknown): ShareBoxSlot[] {
    if (!Array.isArray(slots) || slots.length === 0) {
      throw new Error("share-box template must declare at least one slot")
    }
    const seen = new Set<string>()
    const validated: ShareBoxSlot[] = []
    for (const raw of slots as Array<Record<string, unknown>>) {
      if (!raw || typeof raw.key !== "string" || !raw.key) {
        throw new Error("share-box slot is missing a string `key`")
      }
      if (seen.has(raw.key)) {
        throw new Error(`share-box slot key "${raw.key}" is duplicated`)
      }
      seen.add(raw.key)
      const quantity = Number(raw.quantity)
      if (!Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
        throw new Error(
          `share-box slot "${raw.key}" must have an integer quantity >= 1`
        )
      }
      const candidates = raw.candidate_variant_ids
      if (
        candidates !== undefined &&
        candidates !== null &&
        !(
          Array.isArray(candidates) &&
          candidates.every((v) => typeof v === "string")
        )
      ) {
        throw new Error(
          `share-box slot "${raw.key}" candidate_variant_ids must be a string array`
        )
      }
      validated.push({
        key: raw.key,
        label: typeof raw.label === "string" ? raw.label : undefined,
        quantity,
        candidate_variant_ids: Array.isArray(candidates)
          ? (candidates as string[])
          : undefined,
        tag: typeof raw.tag === "string" ? raw.tag : null,
      })
    }
    return validated
  }

  async createShareBoxTemplate(args: {
    coordinator_seller_id: string
    name: string
    description?: string
    base_price?: number | null
    currency_code?: string
    slots: ShareBoxSlot[] | unknown
    metadata?: Record<string, unknown> | null
  }) {
    if (!args.coordinator_seller_id) {
      throw new Error("coordinator_seller_id is required")
    }
    if (!args.name) {
      throw new Error("name is required")
    }
    const slots = this.validateSlots(args.slots)
    const [created] = await this.createShareBoxTemplates([
      {
        coordinator_seller_id: args.coordinator_seller_id,
        name: args.name,
        description: args.description ?? null,
        base_price: args.base_price ?? null,
        currency_code: args.currency_code ?? "usd",
        slots: slots as any,
        is_active: true,
        metadata: args.metadata ?? null,
      } as any,
    ])
    return created
  }

  async createShareBoxSubscriptionRecord(args: {
    share_box_template_id: string
    customer_id?: string | null
    customer_external_id?: string | null
    slot_overrides?: Record<string, ShareBoxSlotOverride> | null
    starts_at?: Date | null
    ends_at?: Date | null
    metadata?: Record<string, unknown> | null
  }) {
    if (!args.share_box_template_id) {
      throw new Error("share_box_template_id is required")
    }
    if (!args.customer_id && !args.customer_external_id) {
      throw new Error("customer_id or customer_external_id is required")
    }
    const [created] = await this.createShareBoxSubscriptions([
      {
        share_box_template_id: args.share_box_template_id,
        customer_id: args.customer_id ?? null,
        customer_external_id: args.customer_external_id ?? null,
        status: "active" as const,
        slot_overrides: args.slot_overrides ?? null,
        starts_at: args.starts_at ?? null,
        ends_at: args.ends_at ?? null,
        metadata: args.metadata ?? null,
      },
    ])
    return created
  }

  async pauseShareBoxSubscription(id: string, until?: Date | null) {
    const [updated] = await this.updateShareBoxSubscriptions([
      {
        id,
        status: "paused" as const,
        pause_until: until ?? null,
      },
    ])
    return updated
  }

  async resumeShareBoxSubscription(id: string) {
    const [updated] = await this.updateShareBoxSubscriptions([
      {
        id,
        status: "active" as const,
        pause_until: null,
      },
    ])
    return updated
  }

  async cancelShareBoxSubscription(id: string, reason?: string) {
    const [updated] = await this.updateShareBoxSubscriptions([
      {
        id,
        status: "cancelled" as const,
        cancelled_at: new Date(),
        cancelled_reason: reason ?? null,
      },
    ])
    return updated
  }

  /**
   * Determine whether a subscription is eligible for a given cycle.
   * Eligibility requires status=active and the cycle's dispatch date
   * to fall within any [starts_at, ends_at] / pause_until window.
   */
  private isSubscriptionEligible(
    subscription: any,
    dispatchAt: Date
  ): boolean {
    if (subscription.status !== "active") return false
    if (subscription.starts_at && new Date(subscription.starts_at) > dispatchAt) {
      return false
    }
    if (subscription.ends_at && new Date(subscription.ends_at) < dispatchAt) {
      return false
    }
    if (
      subscription.pause_until &&
      new Date(subscription.pause_until) > dispatchAt
    ) {
      return false
    }
    return true
  }

  /**
   * Resolve the variants for a single share-box slot against the order
   * cycle's available products. Returns picked items and any leftover
   * candidate variants that were skipped because they were already
   * exhausted or not present.
   */
  private resolveSlot(args: {
    slot: ShareBoxSlot
    override?: ShareBoxSlotOverride
    products: Array<{
      variant_id: string
      override_price: number | string | null
      sold_quantity: number
      available_quantity: number | null
      currency_code: string | null
    }>
    reservations: Map<string, number>
  }): { items: ShareBoxItem[]; filled: boolean } {
    if (args.override?.skip) {
      return { items: [], filled: true }
    }
    const candidates =
      args.override?.candidate_variant_ids ??
      args.slot.candidate_variant_ids ??
      []

    const eligible = args.products.filter((p) => {
      if (candidates.length > 0 && !candidates.includes(p.variant_id)) {
        return false
      }
      const reserved = args.reservations.get(p.variant_id) ?? 0
      const taken = p.sold_quantity + reserved
      if (p.available_quantity == null) return true
      return taken < p.available_quantity
    })

    const items: ShareBoxItem[] = []
    let need = args.slot.quantity
    for (const product of eligible) {
      if (need <= 0) break
      const reserved = args.reservations.get(product.variant_id) ?? 0
      const headroom =
        product.available_quantity == null
          ? need
          : Math.max(
              0,
              product.available_quantity - product.sold_quantity - reserved
            )
      const take = Math.min(need, headroom)
      if (take <= 0) continue
      items.push({
        slot_key: args.slot.key,
        variant_id: product.variant_id,
        quantity: take,
        unit_price:
          product.override_price == null ? 0 : Number(product.override_price),
        currency_code: product.currency_code ?? "usd",
      })
      args.reservations.set(product.variant_id, reserved + take)
      need -= take
    }
    return { items, filled: need === 0 }
  }

  /**
   * Generate share boxes for every active subscription whose template's
   * coordinator matches the order cycle's coordinator.
   *
   * Idempotent on (subscription_id, order_cycle_id): re-running for the
   * same cycle returns the existing rows rather than creating duplicates.
   *
   * The scheduler does not transition the order cycle status; it works
   * for cycles in any non-cancelled status so coordinators can preview
   * generation while the cycle is still in `draft` or `upcoming`.
   */
  async generateBoxesForCycle(orderCycleId: string): Promise<{
    cycle_id: string
    generated: number
    reused: number
    skipped: number
    boxes: any[]
  }> {
    const cycle = await this.retrieveOrderCycle(orderCycleId)
    if (cycle.status === "cancelled") {
      throw new Error("cannot generate boxes for a cancelled cycle")
    }
    const dispatchAt = new Date(cycle.dispatch_at)

    const templates = await this.listShareBoxTemplates({
      coordinator_seller_id: cycle.coordinator_seller_id,
      is_active: true,
    })
    if (templates.length === 0) {
      return {
        cycle_id: orderCycleId,
        generated: 0,
        reused: 0,
        skipped: 0,
        boxes: [],
      }
    }

    const products = (
      await this.listOrderCycleProducts({ order_cycle_id: orderCycleId })
    )
      .filter((p: any) => p.is_visible !== false)
      .map((p: any) => ({
        variant_id: p.variant_id,
        override_price: p.override_price,
        sold_quantity: Number(p.sold_quantity ?? 0),
        available_quantity:
          p.available_quantity == null ? null : Number(p.available_quantity),
        currency_code: p.currency_code ?? null,
      }))

    let generated = 0
    let reused = 0
    let skipped = 0
    const boxes: any[] = []
    const reservations = new Map<string, number>()

    for (const template of templates) {
      const subscriptions = await this.listShareBoxSubscriptions({
        share_box_template_id: template.id,
      })
      const slots = this.validateSlots(template.slots)

      for (const subscription of subscriptions) {
        if (!this.isSubscriptionEligible(subscription, dispatchAt)) {
          continue
        }

        const existing = await this.listShareBoxes({
          share_box_subscription_id: subscription.id,
          order_cycle_id: orderCycleId,
        })
        if (existing.length > 0) {
          boxes.push(existing[0])
          reused++
          continue
        }

        const overrides =
          (subscription.slot_overrides as
            | Record<string, ShareBoxSlotOverride>
            | null
            | undefined) ?? null

        const items: ShareBoxItem[] = []
        const unfilled: string[] = []
        for (const slot of slots) {
          const resolved = this.resolveSlot({
            slot,
            override: overrides ? overrides[slot.key] : undefined,
            products,
            reservations,
          })
          items.push(...resolved.items)
          if (!resolved.filled) unfilled.push(slot.key)
        }

        const total = items.reduce(
          (sum, item) => sum + item.unit_price * item.quantity,
          0
        )
        const status = unfilled.length > 0 ? "skipped" : "allocated"
        const currencyCode =
          items[0]?.currency_code ?? template.currency_code ?? "usd"

        const [box] = await this.createShareBoxes([
          {
            share_box_subscription_id: subscription.id,
            share_box_template_id: template.id,
            order_cycle_id: orderCycleId,
            customer_id: subscription.customer_id ?? null,
            customer_external_id: subscription.customer_external_id ?? null,
            status: status as any,
            items: items as any,
            total_price: items.length > 0 ? total : null,
            currency_code: currencyCode,
            unfilled_slot_keys: unfilled.length > 0 ? (unfilled as any) : null,
            generated_at: new Date(),
            allocated_at: status === "allocated" ? new Date() : null,
          } as any,
        ])
        boxes.push(box)
        if (status === "allocated") generated++
        else skipped++
      }
    }

    // Reflect the reservations into the cycle's product sold_quantity so
    // downstream availability checks treat allocated boxes the same as
    // direct sales. We update only products that received allocations.
    for (const [variantId, reservedQty] of reservations) {
      if (reservedQty <= 0) continue
      const matches = await this.listOrderCycleProducts({
        order_cycle_id: orderCycleId,
        variant_id: variantId,
      })
      if (matches.length === 0) continue
      const product = matches[0]
      await this.updateOrderCycleProducts({
        id: product.id,
        sold_quantity: Number(product.sold_quantity ?? 0) + reservedQty,
      })
    }

    return {
      cycle_id: orderCycleId,
      generated,
      reused,
      skipped,
      boxes,
    }
  }

  async markShareBoxPacked(id: string) {
    const [updated] = await this.updateShareBoxes([
      { id, status: "packed" as const },
    ])
    return updated
  }

  async markShareBoxDispatched(id: string) {
    const [updated] = await this.updateShareBoxes([
      {
        id,
        status: "dispatched" as const,
        dispatched_at: new Date(),
      },
    ])
    return updated
  }

  async cancelShareBox(id: string) {
    const [updated] = await this.updateShareBoxes([
      { id, status: "cancelled" as const },
    ])
    return updated
  }

  async getShareBoxesForCycle(orderCycleId: string) {
    return this.listShareBoxes({ order_cycle_id: orderCycleId })
  }
}

export default OrderCycleModuleService
