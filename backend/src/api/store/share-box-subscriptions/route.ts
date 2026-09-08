import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import { storeCustomerId } from "./_access"

/**
 * A member's share-box subscriptions — the buyer half of the CSA scheduler.
 *
 * `createShareBoxSubscriptionRecord` and the pause/resume/cancel methods have
 * existed since the order-cycle module shipped with no caller anywhere, so no
 * member could subscribe to the templates #840 let coordinators define
 * (`docs/CDFI_COOP_ROADMAP.md` §3.7). These are the first callers.
 */

type TemplateRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveShareBoxTemplate"]>
>

// GET /store/share-box-subscriptions
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = storeCustomerId(req)
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  const { status } = req.query as { status?: string }

  // Always scoped to the caller. A subscription list is nobody else's business.
  const filters: Record<string, unknown> = { customer_id: customerId }
  if (status === "active" || status === "paused" || status === "cancelled") {
    filters.status = status
  }

  try {
    const subscriptions = await service.listShareBoxSubscriptions(filters)
    res.json({ share_box_subscriptions: subscriptions })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(500).json({ message })
  }
}

// POST /store/share-box-subscriptions
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = storeCustomerId(req)
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const body = (req.body ?? {}) as {
    share_box_template_id?: string
    slot_overrides?: Record<string, unknown> | null
    starts_at?: string | null
    ends_at?: string | null
    metadata?: Record<string, unknown> | null
  }

  if (!body.share_box_template_id) {
    return res.status(400).json({ message: "share_box_template_id is required" })
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  let template: TemplateRecord
  try {
    template = await service.retrieveShareBoxTemplate(body.share_box_template_id)
  } catch (_error) {
    return res.status(404).json({ message: "Share box template not found" })
  }

  // A subscription to an inactive template can never produce a box:
  // `generateBoxesForCycle` filters templates on `is_active`, and #840 made
  // deleting a subscribed template deactivate it instead. Accepting this would
  // hand the member a subscription that looks live and delivers nothing.
  if (!template.is_active) {
    return res.status(409).json({
      message:
        "This share box is no longer offered. Its coordinator has closed it, " +
        "so it will not generate any boxes.",
    })
  }

  // `share_box_subscription` has a UNIQUE index on
  // (share_box_template_id, customer_id), so a member can hold exactly one row
  // per template. Creating a second — after they cancelled, say — would trip
  // the index and 500. Revive the row they already have instead.
  const existing = await service.listShareBoxSubscriptions({
    share_box_template_id: template.id,
    customer_id: customerId,
  })
  const prior = (existing ?? [])[0]

  if (prior) {
    if (prior.status === "active") {
      return res.status(409).json({
        message: "You are already subscribed to this share box.",
        share_box_subscription: prior,
      })
    }
    // Paused or cancelled: bring it back, clearing the cancellation stamp so
    // the row does not read `active` while still carrying why it was ended.
    const revived = await service.reactivateShareBoxSubscription(prior.id)
    return res.status(200).json({
      share_box_subscription: revived,
      reactivated: true,
    })
  }

  try {
    const subscription = await service.createShareBoxSubscriptionRecord({
      share_box_template_id: template.id,
      // From the session, never the body — a member subscribes themselves.
      customer_id: customerId,
      slot_overrides: (body.slot_overrides ?? null) as never,
      starts_at: body.starts_at ? new Date(body.starts_at) : null,
      ends_at: body.ends_at ? new Date(body.ends_at) : null,
      metadata: body.metadata ?? null,
    })
    res.status(201).json({ share_box_subscription: subscription })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(400).json({ message })
  }
}
