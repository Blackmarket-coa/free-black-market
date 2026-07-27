import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../../../shared/actor-scope"

const GARDEN_MODULE = "gardenModuleService"

interface GardenServiceType {
  createGardenMemberships: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/gardens/:id/members
 * 
 * List members of a garden
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: members } = await query.graph({
    entity: "garden_membership",
    fields: [
      "id",
      "customer_id",
      "membership_type",
      "status",
      "roles",
      "joined_at",
      "volunteer_hours_balance",
      "investment_balance",
      "voting_power",
    ],
    filters: {
      garden_id: id,
      status: ["active", "suspended"] as any, // on_leave may not be in generated enum
    },
  })

  res.json({ members })
}

/**
 * POST /store/gardens/:id/members
 * 
 * Join a garden as a member
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const gardenService = req.scope.resolve(GARDEN_MODULE) as GardenServiceType

  const {
    customer_id,
    membership_type,
    initial_investment,
  } = req.body as Record<string, unknown>

  // SEC: bind the new membership's owner to the authenticated customer so a
  // logged-in customer cannot join a garden as someone else. Non-customer
  // actors (seller/driver) fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectiveCustomerId = (actingCustomer ?? customer_id) as string

  const membership = await gardenService.createGardenMemberships({
    garden_id: id,
    customer_id: effectiveCustomerId,
    membership_type: membership_type || "volunteer",
    status: "pending",
    roles: [],
    joined_at: new Date(),
    total_labor_hours: 0,
    total_investment: initial_investment || 0,
    time_credit_balance: 0,
    harvest_credit_balance: 0,
    voting_power: 1, // Base voting power
  })

  res.status(201).json({ membership })
}
