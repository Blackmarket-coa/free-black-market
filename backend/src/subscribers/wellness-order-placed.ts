import { createLogger } from "../shared/logger"
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { WELLNESS_MODULE } from "../modules/wellness"
import type WellnessModuleService from "../modules/wellness/service"
import { WellnessKarmaService } from "../modules/wellness/karma"
import { WellnessAutomationService } from "../modules/wellness/automation-service"
import type { EmitWellnessKarmaInput } from "../modules/wellness/karma"
import { featureFlagState } from "../shared/feature-flags"
import { LIVE_CLASS_STATUSES } from "../modules/wellness/class-registration"

const log = createLogger("subscribers/wellness-order-placed")

type LiveClass = { id: string; seller_id: string; title: string; product_id: string | null }

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
 *     `class_registered` message only when a seat was actually taken. Only a
 *     live, future class takes a seat (status in LIVE_CLASS_STATUSES, ends_at
 *     ahead); a product shared by several live classes seats nobody unless
 *     the line's metadata.class_event_id names one of them.
 *   - A membership purchase → create/activate the member, allocate the first
 *     period's credits, award `membership_first_signup` KARMA, and fire the
 *     welcome automation.
 * Both KARMA awards wait on WELLNESS_SALE_KARMA_V1 (operator-gated, SD-52).
 *
 * Safe to redeliver: seats are counted per (class, order) and a member row
 * created for this order is recognised, so a second `order.placed` for the
 * same order takes no further seats and sends no second message.
 *
 * NOT handled, and logged at warn: a ticket that takes no seat because its
 * class is full with no waitlist, cancelled, completed or over, or because its
 * product is shared by several live classes and the line names none. The
 * buyer has paid, is not registered, and is not told; there is no buyer or
 * vendor notification or refund for it yet (SD-52 follow-up). Before SD-52
 * fixed the read below, every buyer was in that position.
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

    type OrderLine = { product_id?: string | null; quantity?: unknown; metadata?: Record<string, unknown> | null }
    const lines = ((order.items ?? []) as Array<OrderLine | null>).flatMap((it) => {
      if (!it?.product_id) return []
      // A class line of quantity 2 is two seats.
      const units = Math.max(0, Math.floor(Number(it.quantity ?? 0)))
      return units > 0 ? [{ productId: it.product_id, units, metadata: it.metadata ?? null }] : []
    })
    const productIds = [...new Set(lines.map((l) => l.productId))]
    if (!productIds.length) return

    const svc = container.resolve(WELLNESS_MODULE) as WellnessModuleService
    const karma = new WellnessKarmaService(container)
    const automation = new WellnessAutomationService(container)
    const email = (order.email as string) || ""

    // ---- Class ticket purchases ----
    // Only live, future classes: the statuses the reminder job treats as live
    // and an end time still ahead. The vendor DELETE soft-cancels a class and
    // leaves its ticket product linked, and a finished class keeps its link,
    // so an unfiltered lookup seated a buyer in a cancelled or past class (and
    // registerForClass wrote it back to "open"). registerForClass refuses
    // those too; this keeps a dead session from making a live one ambiguous.
    const now = new Date()
    const liveClasses = (await svc.listClassEvents({
      product_id: productIds,
      status: [...LIVE_CLASS_STATUSES],
      ends_at: { $gt: now },
    } as never)) as LiveClass[]
    const liveByProduct = new Map<string, LiveClass[]>()
    for (const c of liveClasses) {
      if (!c.product_id) continue
      liveByProduct.set(c.product_id, [...(liveByProduct.get(c.product_id) ?? []), c])
    }

    // Which class each ticket line is for. One live class on the product: that
    // one. Several (sessions sharing one drop-in product): only the class the
    // line names in metadata.class_event_id, else none, since a ticket is one
    // seat in one session, not a seat in each. No first-party client sets
    // class_event_id today; it is honoured only when it names one of this
    // product's live classes, so a line cannot pick another product's class.
    const seatsByClass = new Map<string, { cls: LiveClass; units: number }>()
    const unmatched = new Map<string, number>()
    for (const line of lines) {
      const candidates = liveByProduct.get(line.productId) ?? []
      const pinned = typeof line.metadata?.class_event_id === "string" ? line.metadata.class_event_id : null
      let cls: LiveClass | undefined
      if (pinned) {
        cls = candidates.find((c) => c.id === pinned)
        if (!cls) {
          log.warn(
            `[wellness-order-placed] order ${order.id}: a line names class ${pinned}, which is not a live, future class ` +
              `for product ${line.productId}; ${line.units} ticket(s) not seated, and the buyer has not been told`
          )
          continue
        }
      } else if (candidates.length === 1) {
        cls = candidates[0]
      } else if (candidates.length > 1) {
        log.warn(
          `[wellness-order-placed] order ${order.id}: product ${line.productId} is the ticket for ${candidates.length} live ` +
            `classes (${candidates.map((c) => c.id).join(", ")}) and the line names none (metadata.class_event_id); ` +
            `${line.units} ticket(s) not seated, and the buyer has not been told`
        )
        continue
      } else {
        unmatched.set(line.productId, (unmatched.get(line.productId) ?? 0) + line.units)
        continue
      }
      const owed = seatsByClass.get(cls.id) ?? { cls, units: 0 }
      owed.units += line.units
      seatsByClass.set(cls.id, owed)
    }

    // A paid ticket whose product has classes but none live (cancelled,
    // completed or over) is logged, as an unseated ticket for a full class is.
    // For an ordinary order this read finds nothing (bounded, newest first).
    if (unmatched.size) {
      const dead = (await svc.listClassEvents(
        { product_id: [...unmatched.keys()] } as never,
        { select: ["id", "product_id", "status"], take: 20, order: { ends_at: "DESC" } }
      )) as Array<{ id: string; product_id: string | null; status: string }>
      const deadByProduct = new Map<string, string[]>()
      for (const c of dead) {
        if (!c.product_id) continue
        deadByProduct.set(c.product_id, [...(deadByProduct.get(c.product_id) ?? []), `${c.id} (${c.status})`])
      }
      for (const [productId, units] of unmatched) {
        const classes = deadByProduct.get(productId)
        if (!classes) continue
        log.warn(
          `[wellness-order-placed] order ${order.id}: ${units} ticket(s) for product ${productId}, whose classes ` +
            `[${classes.join(", ")}] are cancelled, completed or over; not seated, and the buyer has not been told`
        )
      }
    }

    for (const { cls, units } of seatsByClass.values()) {
      if (!email) continue
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
        if (result.refused) {
          // Cancelled or ended between the lookup above and now: no seat.
          log.warn(
            `[wellness-order-placed] order ${order.id}: class ${cls.id} refused registration (${result.refused}); ` +
              `${units - i} ticket(s) not seated, and the buyer has not been told`
          )
          break
        }
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
