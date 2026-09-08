import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../shared/logger"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import { callerSellerIds } from "./_access"

const log = createLogger("api/vendor/share-box-templates")

/**
 * Share-box templates: the coordinator's half of the CSA scheduler.
 *
 * `createShareBoxTemplate` and the rest of the share-box service surface have
 * existed since the order-cycle module shipped and were called from no route,
 * job, workflow, subscriber or screen — so a coordinator could not define a
 * template, no member could subscribe, and no box was ever generated
 * (`docs/CDFI_COOP_ROADMAP.md` §3.7). These are the first callers.
 *
 * The template is deliberately NOT nested under a cycle. It belongs to a
 * coordinator and is reused across cycles — `generateBoxesForCycle` looks
 * templates up by coordinator, not by cycle — so nesting it under
 * `/vendor/order-cycles/:id` would imply a lifetime it does not have.
 */

// GET /vendor/share-box-templates
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerIds = await callerSellerIds(req)
  if (sellerIds.length === 0) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  const { limit = 50, offset = 0, is_active } = req.query as {
    limit?: number
    offset?: number
    is_active?: string
  }

  // Always scoped to the caller. A template list is not a marketplace
  // directory; another coordinator's box definitions are their own.
  const filters: Record<string, unknown> = { coordinator_seller_id: sellerIds }
  if (is_active === "true") filters.is_active = true
  if (is_active === "false") filters.is_active = false

  try {
    const [templates, count] = await service.listAndCountShareBoxTemplates(
      filters,
      { take: Number(limit), skip: Number(offset), order: { name: "ASC" } }
    )
    res.json({ share_box_templates: templates, count, limit: Number(limit), offset: Number(offset) })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[share-box-templates] list failed", error)
    res.status(500).json({ message })
  }
}

// POST /vendor/share-box-templates
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerIds = await callerSellerIds(req)
  if (sellerIds.length === 0) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const body = (req.body ?? {}) as {
    name?: string
    description?: string
    base_price?: number | null
    currency_code?: string
    slots?: unknown
    metadata?: Record<string, unknown> | null
  }

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return res.status(400).json({ message: "name is required" })
  }
  if (!Array.isArray(body.slots) || body.slots.length === 0) {
    // A template with no slots generates an empty box for every member, which
    // is worse than refusing: the cycle would look scheduled and deliver
    // nothing. `validateSlots` also rejects malformed entries below.
    return res.status(400).json({ message: "slots must be a non-empty array" })
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    const template = await service.createShareBoxTemplate({
      // Never from the body — a coordinator may only create their own.
      coordinator_seller_id: sellerIds[0],
      name: body.name.trim(),
      description: body.description,
      base_price: body.base_price ?? null,
      currency_code: body.currency_code,
      slots: body.slots,
      metadata: body.metadata ?? null,
    })
    res.status(201).json({ share_box_template: template })
  } catch (error: unknown) {
    // `validateSlots` throws on a malformed slot; that is the caller's fault.
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(400).json({ message })
  }
}
