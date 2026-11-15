import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HARVEST_MODULE } from "../../../../../modules/harvest"
import { forbidden } from "../../../../../shared/community-read-access"
import { actorManagesGarden } from "../../../../../shared/community-write-access"

interface HarvestServiceType {
  createHarvestAllocations: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateGardenHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
}

type PoolType = "investor" | "volunteer" | "plot_holder" | "communal" | "open_market" | "donation"

function getClaimDeadline(poolType: PoolType, harvestDate: Date): Date {
  const deadlines: Record<PoolType, number> = {
    investor: 14,
    volunteer: 14,
    plot_holder: 14,
    communal: 7,
    open_market: 0,
    donation: 0
  }
  const deadline = new Date(harvestDate)
  deadline.setDate(deadline.getDate() + (deadlines[poolType] || 7))
  return deadline
}

/**
 * GET /store/harvests/:id/allocations
 * 
 * Get allocations for a harvest
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: allocations } = await query.graph({
    entity: "harvest_allocation",
    fields: [
      "id",
      "pool_type",
      "percentage",
      "allocated_quantity",
      "allocated_value",
      "claimed_quantity",
      "remaining_quantity",
      "status",
    ],
    filters: {
      harvest_id: id,
    },
  })

  res.json({ allocations })
}

/**
 * POST /store/harvests/:id/allocations
 * 
 * Create allocations for a harvest. The harvest's garden's active organizers
 * only; a harvest that does not exist is refused the same way.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const harvestService = req.scope.resolve(HARVEST_MODULE) as HarvestServiceType
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get the harvest
  const { data: [harvest] } = await query.graph({
    entity: "garden_harvest",
    fields: ["id", "garden_id", "total_quantity", "total_estimated_value"],
    filters: { id },
  })

  if (!harvest || !(await actorManagesGarden(req, harvest.garden_id as string))) {
    return forbidden(res)
  }

  // Get allocation rules for this garden
  const { data: rules } = await query.graph({
    entity: "allocation_rule",
    fields: ["pool_type", "percentage"],
    filters: {
      garden_id: harvest.garden_id,
      is_active: true,
    },
  })

  // Use default rules if none configured
  const allocationRules = rules.length > 0 
    ? rules as { pool_type: string; percentage: number }[]
    : [
        { pool_type: "investor", percentage: 20 },
        { pool_type: "volunteer", percentage: 20 },
        { pool_type: "plot_holder", percentage: 30 },
        { pool_type: "communal", percentage: 15 },
        { pool_type: "open_market", percentage: 10 },
        { pool_type: "donation", percentage: 5 },
      ]

  const quantity = harvest.total_quantity as number
  const estimatedValue = harvest.total_estimated_value as number

  // Create allocations
  const allocations = await Promise.all(
    allocationRules.map(rule => 
      harvestService.createHarvestAllocations({
        harvest_id: id,
        garden_id: harvest.garden_id,
        pool_type: rule.pool_type,
        percentage: rule.percentage,
        allocated_quantity: (quantity * rule.percentage) / 100,
        allocated_value: (estimatedValue * rule.percentage) / 100,
        claimed_quantity: 0,
        remaining_quantity: (quantity * rule.percentage) / 100,
        status: "open",
        claim_deadline: getClaimDeadline(rule.pool_type as PoolType, new Date()),
      })
    )
  )

  // Update harvest allocation status
  await harvestService.updateGardenHarvests({
    id,
    allocation_status: "allocated",
  })

  res.status(201).json({ allocations })
}
