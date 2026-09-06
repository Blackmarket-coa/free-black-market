import { createLogger } from "../../../shared/logger"
import type { VendorRequest } from "../types"
const log = createLogger("api/vendor/order-cycles")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import { resolveVendorSellerId } from "../hawala/seller-context"

/**
 * The cycles a vendor may list: the ones they coordinate and the ones they
 * take part in as an `order_cycle_seller`. Until 2026-09-06 this route
 * filtered on status alone, so any authenticated seller could read every
 * coordinator's draft and closed cycles (`docs/CDFI_COOP_ROADMAP.md` §1a).
 *
 * The vendor middleware rewrites a `sel_*` actor to `mem_*` and keeps the
 * seller id on `_seller_id`; the writing routes on this surface store
 * whichever spelling they saw, so both are matched.
 */
export async function sellerScopedCycleFilters(
  req: MedusaRequest,
  orderCycleService: OrderCycleModuleService,
  actorId: string
): Promise<Record<string, unknown>> {
  const resolved = await resolveVendorSellerId(req)
  const sellerIds = Array.from(
    new Set([actorId, resolved].filter((id): id is string => Boolean(id)))
  )

  const memberships = await orderCycleService.listOrderCycleSellers({
    seller_id: sellerIds,
    is_active: true,
  })
  const participantCycleIds = Array.from(
    new Set(memberships.map((membership) => membership.order_cycle_id))
  )

  if (participantCycleIds.length === 0) {
    return { coordinator_seller_id: sellerIds }
  }

  return {
    $or: [{ coordinator_seller_id: sellerIds }, { id: participantCycleIds }],
  }
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    const actorId = (req as VendorRequest).auth_context?.actor_id
    if (!actorId) {
      return res.status(401).json({ message: "Unauthorized - seller ID not found" })
    }

    const { limit = 20, offset = 0, status } = req.query as {
      status?: string
      limit?: number
      offset?: number
    }

    const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : limit
    const offsetNum = typeof offset === 'string' ? parseInt(offset, 10) : offset

    const filters = await sellerScopedCycleFilters(req, orderCycleService, actorId)
    if (status) {
      filters.status = typeof status === 'string' ? status.split(",") : status
    }

    const orderCycles = await orderCycleService.listOrderCycles(filters, {
      take: limitNum,
      skip: offsetNum,
      order: { created_at: "DESC" },
    })

    const allCycles = await orderCycleService.listOrderCycles(filters)

    res.json({
      order_cycles: orderCycles,
      count: allCycles.length,
      limit: limitNum,
      offset: offsetNum,
    })
  } catch (error) {
    log.error("Error fetching order cycles:", error)
    res.status(500).json({ message: "Failed to fetch order cycles", error: String(error) })
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  try {
    // Get seller ID from authenticated context
    const sellerId = (req as VendorRequest).auth_context?.actor_id
    
    if (!sellerId) {
      return res.status(401).json({ message: "Unauthorized - seller ID not found" })
    }

    const {
      name,
      description,
      opens_at,
      closes_at,
      dispatch_at,
      pickup_instructions,
    } = req.body as {
      name: string
      description?: string
      opens_at: string
      closes_at: string
      dispatch_at?: string
      pickup_instructions?: string
    }

    if (!name || !opens_at || !closes_at) {
      return res.status(400).json({
        message: "Missing required fields: name, opens_at, closes_at",
      })
    }

    const openDate = new Date(opens_at)
    const closeDate = new Date(closes_at)
    // Default dispatch_at to closes_at if not provided
    const dispatchDate = dispatch_at ? new Date(dispatch_at) : new Date(closes_at)

    if (closeDate <= openDate) {
      return res.status(400).json({
        message: "closes_at must be after opens_at",
      })
    }

    const now = new Date()
    let status: "draft" | "upcoming" | "open" = "draft"
    if (openDate <= now && closeDate > now) {
      status = "open"
    } else if (openDate > now) {
      status = "upcoming"
    }

    const orderCycle = await orderCycleService.createOrderCycles({
      name,
      description: description || null,
      opens_at: openDate,
      closes_at: closeDate,
      dispatch_at: dispatchDate,
      status,
      coordinator_seller_id: sellerId,
      pickup_instructions: pickup_instructions || null,
    })

    res.status(201).json({ order_cycle: orderCycle })
  } catch (error) {
    log.error("Error creating order cycle:", error)
    res.status(500).json({ message: "Failed to create order cycle", error: String(error) })
  }
}
