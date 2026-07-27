import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../../../shared/actor-scope"

const HARVEST_MODULE = "harvestModuleService"

interface HarvestServiceType {
  createHarvestClaims: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateHarvestAllocations: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/harvests/:id/claims
 * 
 * Get claims for a harvest
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: claims } = await query.graph({
    entity: "harvest_claim",
    fields: [
      "id",
      "allocation_id",
      "customer_id",
      "membership_id",
      "quantity_claimed",
      "value_claimed",
      "status",
      "claimed_at",
      "collected_at",
    ],
    filters: {
      harvest_id: id,
    },
  })

  res.json({ claims })
}

/**
 * POST /store/harvests/:id/claims
 * 
 * Claim a share of a harvest
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const harvestService = req.scope.resolve(HARVEST_MODULE) as HarvestServiceType
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    allocation_id,
    customer_id,
    membership_id,
    quantity_requested,
  } = req.body as Record<string, unknown>

  // SEC: a customer may only claim a share for themselves. Bind customer_id to
  // the authenticated actor; non-customer actors fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectiveCustomerId = (actingCustomer ?? customer_id) as string

  // SEC: and a customer must not borrow another member's membership_id, so
  // reject a membership that belongs to someone else.
  if (actingCustomer && membership_id) {
    const { data: [membership] } = await query.graph({
      entity: "garden_membership",
      fields: ["id", "customer_id"],
      filters: { id: membership_id as string },
    })
    if (membership && membership.customer_id && membership.customer_id !== actingCustomer) {
      res.status(403).json({ message: "That membership is not yours" })
      return
    }
  }

  // Get the allocation
  const { data: [allocation] } = await query.graph({
    entity: "harvest_allocation",
    fields: ["id", "remaining_quantity", "allocated_value", "allocated_quantity", "status"],
    filters: { id: allocation_id },
  })

  if (!allocation) {
    res.status(404).json({ message: "Allocation not found" })
    return
  }

  if (allocation.status !== "open") {
    res.status(400).json({ message: "Allocation is not open for claims" })
    return
  }

  const remainingQty = allocation.remaining_quantity as number
  const allocatedQty = allocation.allocated_quantity as number
  const allocatedValue = allocation.allocated_value as number

  const quantity_claimed = Math.min(quantity_requested as number, remainingQty)
  const value_claimed = (quantity_claimed / allocatedQty) * allocatedValue

  const claim = await harvestService.createHarvestClaims({
    harvest_id: id,
    allocation_id,
    customer_id: effectiveCustomerId,
    membership_id,
    quantity_claimed,
    value_claimed,
    status: "pending",
    claimed_at: new Date(),
  })

  // Update allocation remaining quantity
  await harvestService.updateHarvestAllocations({
    id: allocation_id,
    remaining_quantity: remainingQty - quantity_claimed,
    claimed_quantity: (allocatedQty - remainingQty) + quantity_claimed,
  })

  res.status(201).json({ claim })
}
