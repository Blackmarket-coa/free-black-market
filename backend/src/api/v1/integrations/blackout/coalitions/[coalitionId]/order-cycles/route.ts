import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createLogger } from "../../../../../../../shared/logger"
import { requireEntitlementsAuth } from "../../../../../../../lib/blackout-entitlements-auth"
import { COOPERATIVE_MODULE } from "../../../../../../../modules/cooperative"
import type CooperativeService from "../../../../../../../modules/cooperative/service"
import { CooperativeMemberRole } from "../../../../../../../modules/cooperative/models/cooperative-member"
import { ORDER_CYCLE_MODULE } from "../../../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../../../modules/order-cycle/service"

const log = createLogger("api/v1/integrations/blackout/coalitions/order-cycles")

const BodySchema = z
  .object({
    /** The Blackout campaign this window belongs to; the idempotency key. */
    campaign_id: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    opens_at: z.string().datetime(),
    closes_at: z.string().datetime(),
    dispatch_at: z.string().datetime(),
    pickup_location: z.string().max(500).optional(),
    pickup_instructions: z.string().max(2000).optional(),
  })
  .strict()

type MemberRow = {
  seller_id?: string | null
  role?: string | null
}

/**
 * POST /v1/integrations/blackout/coalitions/:coalitionId/order-cycles
 *
 * Open the shared batch-ordering window for a coalition goods drive.
 *
 * This is deliberately not a new mechanism. A coalition's shared order window
 * IS an order cycle: the same open/close/dispatch timing, the same incoming
 * exchanges, the same fee engine and the same customer-facing surface every
 * food hub already uses. What this route adds is the membership projection —
 * every coalition member with a shop becomes a participating producer with an
 * incoming exchange, which is what the audit found nothing was writing.
 *
 * Idempotent on `campaign_id`, backed by a unique index: a retried launch
 * returns the existing window and re-materialises any members who joined the
 * coalition since, rather than opening a second window.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const coalitionId = String(req.params.coalitionId || "").trim()
  if (!coalitionId) {
    return res.status(400).json({ code: "bad_request", message: "coalitionId is required" })
  }

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid order cycle payload",
      details: parsed.error.flatten(),
    })
  }
  const body = parsed.data

  const opensAt = new Date(body.opens_at)
  const closesAt = new Date(body.closes_at)
  const dispatchAt = new Date(body.dispatch_at)
  if (!(opensAt < closesAt) || !(closesAt <= dispatchAt)) {
    // A window that closes before it opens would accept no orders and a
    // dispatch before close would ship them before they exist.
    return res.status(400).json({
      code: "invalid_window",
      message: "Requires opens_at < closes_at <= dispatch_at",
    })
  }

  const cooperativeService = req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)
  const [cooperative] = await cooperativeService.listCooperatives({
    blackout_coalition_id: coalitionId,
  })
  if (!cooperative) {
    return res.status(404).json({
      code: "cooperative_unlinked",
      message: "No FBM cooperative is linked to this coalition",
    })
  }

  const members: MemberRow[] = await cooperativeService.listCooperativeMembers({
    cooperative_id: cooperative.id,
    is_active: true,
  })
  const sellerIds = [
    ...new Set(
      members
        .map((m) => m.seller_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ]
  if (sellerIds.length === 0) {
    // Nothing to aggregate. Refusing here is kinder than opening an empty
    // window customers can browse and never order from.
    return res.status(409).json({
      code: "no_member_shops",
      message: "No coalition member has linked a shop yet",
    })
  }

  // The coordinator is an admin member where the coalition has one, so the
  // hub role sits with someone who can actually administer the window.
  const adminSeller = members.find(
    (m) => m.role === CooperativeMemberRole.ADMIN && typeof m.seller_id === "string" && m.seller_id
  )?.seller_id
  const coordinatorSellerId = (adminSeller as string | undefined) ?? sellerIds[0]

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
  const [existing] = await orderCycleService.listOrderCycles({
    blackout_campaign_id: body.campaign_id,
  })

  let cycleId: string
  let created = false
  if (existing) {
    cycleId = existing.id
  } else {
    const cycle = await orderCycleService.createOrderCycles({
      name: body.name,
      description: body.description ?? null,
      opens_at: opensAt,
      closes_at: closesAt,
      dispatch_at: dispatchAt,
      status: opensAt <= new Date() ? "open" : "upcoming",
      coordinator_seller_id: coordinatorSellerId,
      pickup_location: body.pickup_location ?? null,
      pickup_instructions: body.pickup_instructions ?? null,
      blackout_coalition_id: coalitionId,
      blackout_campaign_id: body.campaign_id,
    })
    cycleId = (cycle as { id: string }).id
    created = true
  }

  // Materialise participation for every member shop, on create AND on retry:
  // a member who joined the coalition after the window opened still gets a
  // place in it. Both helpers are idempotent on (cycle, seller).
  for (const sellerId of sellerIds) {
    await orderCycleService.addSellerToOrderCycle(
      cycleId,
      sellerId,
      sellerId === coordinatorSellerId ? "coordinator" : "producer"
    )
    if (sellerId !== coordinatorSellerId) {
      await orderCycleService.createIncomingExchange(cycleId, sellerId, coordinatorSellerId, {
        ...(body.pickup_instructions ? { pickup_instructions: body.pickup_instructions } : {}),
      })
    }
  }

  log.info("coalition order window materialised", {
    coalition_id: coalitionId,
    campaign_id: body.campaign_id,
    order_cycle_id: cycleId,
    seller_count: sellerIds.length,
    created,
  })

  return res.status(created ? 201 : 200).json({
    order_cycle_id: cycleId,
    coalition_id: coalitionId,
    campaign_id: body.campaign_id,
    coordinator_seller_id: coordinatorSellerId,
    seller_ids: sellerIds,
    created,
  })
}
