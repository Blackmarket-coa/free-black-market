import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

/**
 * Award CONSUMER XP when an order is placed.
 *
 * Additive and fully isolated by try/catch — XP is a "nice-to-have" side effect
 * and must never break checkout. XP scales with order value (1 XP per whole
 * currency unit), then the aggregate snapshot is refreshed from source modules.
 */
export default async function progressionOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const progression = container.resolve(
      PROGRESSION_MODULE
    ) as ProgressionModuleService

    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "total", "customer_id"],
      filters: { id: data.id },
    })

    const customerId = order?.customer_id
    if (!customerId) return

    // 1 XP per whole currency unit (order.total is in the smallest unit / cents).
    const xp = Math.max(1, Math.round(Number(order.total ?? 0) / 100))

    await progression.recordXpEvent({
      customer_id: customerId,
      role: Stance.CONSUMER,
      amount: xp,
      reason: "order-placed",
      source_module: "order",
      source_id: order.id,
    })

    await progression.recomputeAggregates(customerId, query as never)
  } catch (error) {
    console.error(
      `[progression-order-placed] Failed to award XP for order ${data.id}:`,
      error
    )
    // Swallow — XP failure must not break the order flow.
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
