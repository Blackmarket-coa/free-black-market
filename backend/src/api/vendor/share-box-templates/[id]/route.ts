import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../modules/order-cycle/service"
import { resolveOwnedTemplate } from "../_access"

/**
 * One share-box template. Every method gates on `resolveOwnedTemplate`, which
 * 404s a template the caller does not coordinate.
 */

// GET /vendor/share-box-templates/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedTemplate(req, res)
  if (!owned) return
  res.json({ share_box_template: owned.template })
}

// POST /vendor/share-box-templates/:id — update
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedTemplate(req, res)
  if (!owned) return

  const body = (req.body ?? {}) as {
    name?: string
    description?: string | null
    base_price?: number | null
    currency_code?: string
    slots?: unknown
    is_active?: boolean
    metadata?: Record<string, unknown> | null
  }

  if (body.slots !== undefined && (!Array.isArray(body.slots) || body.slots.length === 0)) {
    return res.status(400).json({ message: "slots must be a non-empty array" })
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  // `coordinator_seller_id` is not among the fields the service accepts here,
  // so a template cannot be handed to another coordinator through an update.
  // Slot validation happens inside the service, against the same validator the
  // create path uses.
  try {
    const updated = await service.updateShareBoxTemplate(owned.template.id, {
      name: body.name,
      description: body.description,
      base_price: body.base_price,
      currency_code: body.currency_code,
      slots: body.slots,
      is_active: body.is_active === undefined ? undefined : !!body.is_active,
      metadata: body.metadata,
    })
    res.json({ share_box_template: updated })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(400).json({ message })
  }
}

// DELETE /vendor/share-box-templates/:id
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const owned = await resolveOwnedTemplate(req, res)
  if (!owned) return

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  // Deactivate rather than delete when members are still subscribed.
  //
  // `generateBoxesForCycle` reads `is_active`, so deactivating stops future
  // boxes; deleting the row would orphan every `share_box_subscription`
  // pointing at it and lose the record of what those members had signed up
  // for. A coordinator ending a season wants the first; only an unused
  // template is safe to actually remove.
  const subscriptions = await service.listShareBoxSubscriptions({
    share_box_template_id: owned.template.id,
  })

  if ((subscriptions ?? []).length > 0) {
    const deactivated = await service.updateShareBoxTemplate(owned.template.id, {
      is_active: false,
    })
    return res.json({
      share_box_template: deactivated,
      deactivated: true,
      message:
        `Template has ${subscriptions.length} subscription(s) and was ` +
        `deactivated rather than deleted, so the record of what members ` +
        `subscribed to is kept. It will generate no further boxes.`,
    })
  }

  try {
    await service.deleteShareBoxTemplates(owned.template.id)
    res.json({ id: owned.template.id, deleted: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(500).json({ message })
  }
}
