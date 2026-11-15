import { createLogger } from "../shared/logger"
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { WELLNESS_MODULE } from "../modules/wellness"
import type WellnessModuleService from "../modules/wellness/service"
import { WellnessKarmaService } from "../modules/wellness/karma"
import { WellnessAutomationService } from "../modules/wellness/automation-service"
import type { EmitWellnessKarmaInput } from "../modules/wellness/karma"
import { featureFlagState } from "../shared/feature-flags"

const log = createLogger("subscribers/wellness-order-placed")

/**
 * Sale KARMA, behind WELLNESS_SALE_KARMA_V1 (default off; see the flag's note
 * in shared/feature-flags.ts). Off, nothing is awarded, which is what every
 * order got before SD-52 fixed the read below. On, a KARMA failure is logged
 * and does not stop the registration, membership or automation around it.
 */
async function awardSaleKarma(
  karma: WellnessKarmaService,
  orderId: string,
  input: EmitWellnessKarmaInput
): Promise<void> {
  if (!featureFlagState.isEnabled("WELLNESS_SALE_KARMA_V1")) return
  try {
    await karma.emitWellnessKarmaEvent(input)
  } catch (error) {
    log.error(
      `[wellness-order-placed] ${input.event_type} KARMA failed for order ${orderId}:`,
      error
    )
  }
}

/**
 * Best-effort wellness side effects when an order is placed:
 *   - A class ticket purchase → one attendee per ticket bought (linked to the
 *     order); award `class_sold_out` KARMA if it fills the class; send the
 *     `class_registered` message only when a seat was actually taken.
 *   - A membership purchase → create/activate the member, allocate the first
 *     period's credits, award `membership_first_signup` KARMA, and fire the
 *     welcome automation.
 * Both KARMA awards wait on WELLNESS_SALE_KARMA_V1 (operator-gated, SD-52).
 *
 * Safe to redeliver: seats are counted per (class, order) and a member row
 * created for this order is recognised, so a second `order.placed` for the
 * same order takes no further seats and sends no second message.
 *
 * NOT handled, and logged at warn: a ticket for a class that is full and has
 * no waitlist. The buyer has paid, is not registered, and is not told; there
 * is no buyer or vendor notification for it yet (SD-52 follow-up). Before
 * SD-52 fixed the read below, every buyer was in that position.
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
    // `items.*`, never `items.quantity` (SD-52): Medusa 2.14.2 rewrites
    // `items.quantity` to `items.item.quantity`, a property OrderLineItem does
    // not have, so this read threw for every order and no class ticket or
    // membership sale ever registered anyone. `items.*` carries the quantity.
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "email", "customer_id", "items.*"],
      filters: { id: data.id },
    })
    if (!order) return

    // Units bought per product: a class line of quantity 2 is two seats.
    const unitsByProduct = new Map<string, number>()
    for (const it of (order.items ?? []) as Array<{ product_id?: string | null; quantity?: unknown } | null>) {
      if (!it?.product_id) continue
      const units = Math.max(0, Math.floor(Number(it.quantity ?? 0)))
      unitsByProduct.set(it.product_id, (unitsByProduct.get(it.product_id) ?? 0) + units)
    }
    const productIds = [...unitsByProduct.keys()]
    if (!productIds.length) return

    const svc = container.resolve(WELLNESS_MODULE) as WellnessModuleService
    const karma = new WellnessKarmaService(container)
    const automation = new WellnessAutomationService(container)
    const email = (order.email as string) || ""

    // ---- Class ticket purchases ----
    const classes = (await svc.listClassEvents({
      product_id: productIds,
    } as never)) as Array<{ id: string; seller_id: string; title: string; product_id: string | null }>
    for (const cls of classes) {
      if (!email) continue
      const units = cls.product_id ? unitsByProduct.get(cls.product_id) ?? 0 : 0
      // Seats this order already holds in this class, whatever their status
      // (a seat the vendor cancelled is not quietly re-taken), so a
      // redelivered order.placed registers only what is still owed.
      const held = (await svc.listClassAttendees({
        class_event_id: cls.id,
        order_id: order.id,
      } as never)) as unknown[]

      let registered = 0
      let unseated = 0
      let soldOut = false
      for (let i = held.length; i < units; i++) {
        const result = await svc.registerForClass({
          seller_id: cls.seller_id,
          class_event_id: cls.id,
          email,
          customer_id: (order.customer_id as string) ?? null,
          order_id: order.id as string,
        })
        if (result.full) {
          // Full with no waitlist: no later unit of this line gets a seat.
          unseated = units - i
          break
        }
        if ((result.attendee as { status?: string } | null)?.status === "registered") registered++
        if (result.sold_out) soldOut = true
      }

      if (soldOut) {
        await awardSaleKarma(karma, order.id as string, {
          seller_id: cls.seller_id,
          event_type: "class_sold_out",
          reference_id: `classsold:${cls.id}`,
        })
      }
      if (unseated > 0) {
        log.warn(
          `[wellness-order-placed] order ${order.id}: ${unseated} of ${units} ticket(s) for class ${cls.id} ` +
            `could not be seated (class full, no waitlist); the buyer is not registered for them and has not been told`
        )
      }
      // "You're registered" only to a buyer who now holds a seat. A waitlisted
      // or unseated buyer used to be sent it too.
      if (registered > 0) {
        await automation.runTrigger({
          seller_id: cls.seller_id,
          trigger: "class_registered",
          vars: { name: email, session_type: cls.title },
          recipients: [{ email }],
        })
      }
    }

    // ---- Membership purchases ----
    const tiers = (await svc.listMembershipTiers({
      product_id: productIds,
    } as never)) as Array<{ id: string; seller_id: string; name: string; credits_per_period: number }>
    for (const tier of tiers) {
      if (!email) continue
      // One membership per (seller, email): a unique index. A redelivered
      // order.placed finds the member this order created (metadata.order_id)
      // and stops. A buyer who already holds a membership with this seller
      // from an earlier order gets no second row, which the index would
      // refuse anyway; applying the purchase to it (re-join, tier change) is
      // the vendor's call for now, so it is logged.
      const [existing] = (await svc.listMembers(
        { seller_id: tier.seller_id, email } as never,
        { take: 1 }
      )) as Array<{ id: string; metadata?: Record<string, unknown> | null }>
      if (existing) {
        if (existing.metadata?.order_id !== order.id) {
          log.warn(
            `[wellness-order-placed] order ${order.id} bought membership tier ${tier.id}, but the buyer already ` +
              `holds membership ${existing.id} with this seller; no member created`
          )
        }
        continue
      }
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
        metadata: { order_id: order.id },
      })) as { id: string }

      await awardSaleKarma(karma, order.id as string, {
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
