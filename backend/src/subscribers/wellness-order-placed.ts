import { createLogger } from "../shared/logger"
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { WELLNESS_MODULE } from "../modules/wellness"
import type WellnessModuleService from "../modules/wellness/service"
import { WellnessKarmaService } from "../modules/wellness/karma"
import { WellnessAutomationService } from "../modules/wellness/automation-service"

const log = createLogger("subscribers/wellness-order-placed")

/**
 * Best-effort wellness side effects when an order is placed:
 *   - A class ticket purchase → register the buyer as a class attendee (linked
 *     to the order); award `class_sold_out` KARMA if it fills the class.
 *   - A membership purchase → create/activate the member, allocate the first
 *     period's credits, award `membership_first_signup` KARMA on the seller's
 *     first member, and fire the welcome automation.
 *
 * Fully isolated — never throws, never blocks order processing. No-ops for
 * ordinary (non-wellness) orders.
 */
export default async function wellnessOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const query = container.resolve("query")
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "email", "customer_id", "items.product_id", "items.quantity"],
      filters: { id: data.id },
    })
    if (!order) return

    const items = (order.items ?? []) as Array<{ product_id?: string | null }>
    const productIds = items.map((i) => i.product_id).filter((p): p is string => Boolean(p))
    if (!productIds.length) return

    const svc = container.resolve(WELLNESS_MODULE) as WellnessModuleService
    const karma = new WellnessKarmaService(container)
    const automation = new WellnessAutomationService(container)
    const email = (order.email as string) || ""

    // ---- Class ticket purchases ----
    const classes = (await svc.listClassEvents({
      product_id: productIds,
    } as never)) as Array<{ id: string; seller_id: string; title: string }>
    for (const cls of classes) {
      if (!email) continue
      const result = await svc.registerForClass({
        seller_id: cls.seller_id,
        class_event_id: cls.id,
        email,
        customer_id: (order.customer_id as string) ?? null,
        order_id: order.id as string,
      })
      if (result.sold_out) {
        await karma.emitWellnessKarmaEvent({
          seller_id: cls.seller_id,
          event_type: "class_sold_out",
          reference_id: `classsold:${cls.id}`,
        })
      }
      await automation.runTrigger({
        seller_id: cls.seller_id,
        trigger: "class_registered",
        vars: { name: email, session_type: cls.title },
        recipients: [{ email }],
      })
    }

    // ---- Membership purchases ----
    const tiers = (await svc.listMembershipTiers({
      product_id: productIds,
    } as never)) as Array<{ id: string; seller_id: string; name: string; credits_per_period: number }>
    for (const tier of tiers) {
      if (!email) continue
      const isFirst = (await svc.countActiveMembers(tier.seller_id)) === 0
      const member = (await svc.createMembers({
        seller_id: tier.seller_id,
        membership_tier_id: tier.id,
        email,
        customer_id: (order.customer_id as string) ?? null,
        status: "active",
        joined_at: new Date(),
        credits_balance: Number(tier.credits_per_period ?? 0),
        credits_allocated_total: Number(tier.credits_per_period ?? 0),
      })) as { id: string }

      await karma.emitWellnessKarmaEvent({
        seller_id: tier.seller_id,
        event_type: "membership_first_signup",
        reference_id: `member:${member.id}`,
      })
      if (isFirst) {
        // (kept distinct so the first-signup milestone is auditable)
      }

      await automation.runTrigger({
        seller_id: tier.seller_id,
        trigger: "membership_welcome",
        vars: {
          name: email,
          tier: tier.name,
          credits: Number(tier.credits_per_period ?? 0),
        },
        recipients: [{ email }],
      })
    }
  } catch (error) {
    log.error(`[wellness-order-placed] failed for order ${data.id}:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
