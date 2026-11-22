import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import OrderCycleModuleService from "../../../../../modules/order-cycle/service"
import { forbidden } from "../../../../../shared/community-read-access"
import { createLogger } from "../../../../../shared/logger"
import { parseRouteInput, recordId, routeFailure } from "../../../../../shared/route-input"
import { resolveCycleAccess } from "../../_access"

const log = createLogger("api/vendor/order-cycles/[id]/fees")

const applyFeeBody = z.object({
  enterprise_fee_id: recordId,
  application_type: z.enum(["coordinator", "incoming", "outgoing"]),
  target_seller_id: recordId.nullable().optional(),
})

// GET /vendor/order-cycles/:id/fees - List fees for order cycle
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    const fees = await orderCycleService.listOrderCycleFees({
      order_cycle_id: id,
    })

    // The template details of each fee, read only from the coordinator's own
    // templates: a fee that names another store's template (attached before
    // the POST checked) is listed without it. As before (the per-fee read
    // swallowed its errors), fees are listed without details when the
    // templates cannot be read.
    const templateIds = [...new Set(fees.map((fee) => fee.enterprise_fee_id))]
    let templates: Awaited<ReturnType<OrderCycleModuleService["listEnterpriseFees"]>> = []
    if (templateIds.length) {
      try {
        templates = await orderCycleService.listEnterpriseFees({
          id: templateIds,
          seller_id: access.orderCycle.coordinator_seller_id,
        })
      } catch (error) {
        log.warn("order cycle fee templates could not be read", { order_cycle_id: id, error })
      }
    }
    const templateById = new Map(templates.map((template) => [template.id, template]))
    const feesWithDetails = fees.map((fee) => {
      const enterprise_fee = templateById.get(fee.enterprise_fee_id)
      return enterprise_fee ? { ...fee, enterprise_fee } : fee
    })

    res.json({ fees: feesWithDetails })
  } catch (error) {
    routeFailure(log, req, res, "Failed to fetch order cycle fees", error)
  }
}

/**
 * POST /vendor/order-cycles/:id/fees — apply one of the coordinator's own fee
 * templates to the cycle.
 *
 * The template must be the caller's store's (`enterprise_fee.seller_id`,
 * "the seller who created this fee template"). This looked the template up by
 * the body's `enterprise_fee_id` alone and answered with it, so a coordinator
 * could attach any store's template and read its name and amount back
 * (SD-158 sweep); and it inserted the cycle fee first, so an id that named
 * nothing left a fee row behind and answered 500 with the lookup's error text.
 * Now a template that is another store's, or missing, is `forbidden()` before
 * anything is written. Applying a participant's own template (OFN's producer
 * fee) is not offered: nothing records that participant's consent, and no
 * screen or calculation uses it yet (`calculateFeesForProduct` has no caller).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const body = parseRouteInput(res, req.body, applyFeeBody)
  if (!body) return
  const { enterprise_fee_id, application_type, target_seller_id } = body

  // Applying a fee changes settlement amounts for the cycle — coordinator only.
  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: true,
  })
  if (!access) return

  // Validate that incoming/outgoing fees have a target seller
  if ((application_type === "incoming" || application_type === "outgoing") && !target_seller_id) {
    return res.status(400).json({
      message: `${application_type} fees require a target_seller_id`,
    })
  }

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    const [enterprise_fee] = await orderCycleService.listEnterpriseFees(
      { id: enterprise_fee_id, seller_id: access.sellerId },
      { take: 1 }
    )
    if (!enterprise_fee) {
      return forbidden(res)
    }

    const fee = await orderCycleService.createOrderCycleFees({
      order_cycle_id: id,
      enterprise_fee_id: enterprise_fee.id,
      application_type,
      target_seller_id: target_seller_id ?? null,
    })

    res.status(201).json({ fee: { ...fee, enterprise_fee } })
  } catch (error) {
    routeFailure(log, req, res, "Failed to apply fee to order cycle", error)
  }
}
