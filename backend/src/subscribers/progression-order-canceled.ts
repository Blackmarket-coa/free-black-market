import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

/**
 * Claw back the CONSUMER XP awarded for an order when it is canceled.
 *
 * Reverses the matching `order-placed` award by writing a negative XP event
 * (the sheet floors XP at zero). Isolated by try/catch — additive only.
 */
export default async function progressionOrderCanceled({
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

    const xp = Math.max(1, Math.round(Number(order.total ?? 0) / 100))

    await progression.recordXpEvent({
      customer_id: customerId,
      role: Stance.CONSUMER,
      amount: -xp,
      reason: "order-canceled",
      source_module: "order",
      source_id: order.id,
    })

    await progression.recomputeAggregates(customerId, query as never)
  } catch (error) {
    console.error(
      `[progression-order-canceled] Failed to claw back XP for order ${data.id}:`,
      error
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
