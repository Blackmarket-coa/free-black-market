import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HARVEST_MODULE } from "../../../../../modules/harvest"
import { forbidden } from "../../../../../shared/community-read-access"
import { actorManagesGarden } from "../../../../../shared/community-write-access"

type AllocationRuleRow = { pool_type: string; percentage: unknown; priority?: number | null }

interface HarvestServiceType {
  listAllocationRules: (filters: Record<string, unknown>) => Promise<AllocationRuleRow[]>
  listHarvestAllocations: (
    filters: Record<string, unknown>,
    config?: { select?: string[] }
  ) => Promise<Array<Record<string, unknown>>>
  createHarvestAllocations: (
    data: Record<string, unknown>[]
  ) => Promise<Array<{ id: string }>>
}

/** The slice of the knex connection this route uses. */
type PgConnection = {
  raw: (sql: string, bindings: unknown[]) => Promise<{ rows: Array<{ id: string }> }>
}

/**
 * Claim the harvest for allocation in one statement: pending -> allocated,
 * true only for the request that moved it. Postgres re-checks the WHERE after
 * a concurrent writer commits, so of two simultaneous organizer requests
 * exactly one gets the row; reading `allocation_status` and then writing it
 * let both through, and the harvest was offered to claimants twice.
 */
async function claimHarvestForAllocation(conn: PgConnection, id: string): Promise<boolean> {
  const { rows } = await conn.raw(
    `UPDATE garden_harvest
        SET allocation_status = 'allocated', updated_at = now()
      WHERE id = ? AND deleted_at IS NULL
        AND (allocation_status = 'pending' OR allocation_status IS NULL)
      RETURNING id`,
    [id]
  )
  return rows.length === 1
}

async function releaseHarvestClaim(conn: PgConnection, id: string): Promise<void> {
  await conn.raw(
    `UPDATE garden_harvest SET allocation_status = 'pending', updated_at = now()
      WHERE id = ? AND allocation_status = 'allocated'
        AND NOT EXISTS (
          SELECT 1 FROM garden_harvest_allocation
           WHERE harvest_id = ? AND deleted_at IS NULL
        )`,
    [id, id]
  )
}

/** The pools a harvest is split into when the garden has configured none. */
const DEFAULT_ALLOCATION_RULES: ReadonlyArray<{ pool_type: string; percentage: number }> = [
  { pool_type: "investor", percentage: 20 },
  { pool_type: "volunteer", percentage: 20 },
  { pool_type: "plot_holder", percentage: 30 },
  { pool_type: "communal", percentage: 15 },
  { pool_type: "open_market", percentage: 10 },
  { pool_type: "donation", percentage: 5 },
]

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
  const harvestService = req.scope.resolve(HARVEST_MODULE) as HarvestServiceType

  // This read asked Query for `harvest_allocation`, which is not an entity,
  // and for `allocated_*` / `claimed_quantity` / `remaining_quantity`, which
  // are not columns, so it threw on every call. It reads through the module:
  // the service registers the model as `HarvestAllocation`, so Query's
  // `garden_harvest_allocation` entry point resolves to a list method the
  // service does not have. The fields stay off the donation recipient columns.
  const allocations = await harvestService.listHarvestAllocations(
    { harvest_id: id },
    {
      select: [
        "id",
        "pool_type",
        "percentage",
        "quantity",
        "unit",
        "estimated_value",
        "status",
        "claim_deadline",
      ],
    }
  )

  res.json({ allocations })
}

/**
 * POST /store/harvests/:id/allocations
 * 
 * Create allocations for a harvest. The harvest's garden's active organizers
 * only; a harvest that does not exist is refused the same way. A harvest is
 * allocated once: a second call is a 409, not a second set of pools.
 *
 * This route had never worked against a migrated database. It read rules from
 * `allocation_rule`, which is not a registered entity, so the organizer's
 * request threw before writing;
 * and the rows it would have written carried `allocated_quantity`,
 * `claimed_quantity`, `remaining_quantity` and status `open`, none of which
 * `garden_harvest_allocation` has, while omitting its required `quantity` and
 * `unit`.
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
    fields: [
      "id",
      "garden_id",
      "total_quantity",
      "unit",
      "total_estimated_value",
      "allocation_status",
    ],
    filters: { id },
  })

  if (!harvest || !(await actorManagesGarden(req, harvest.garden_id as string))) {
    return forbidden(res)
  }

  const alreadyAllocated = () =>
    res.status(409).json({
      message: "This harvest has already been allocated",
      type: "duplicate_error",
    })

  if (harvest.allocation_status && harvest.allocation_status !== "pending") {
    return alreadyAllocated()
  }

  // The garden's active allocation rules, through the module rather than
  // Query. `garden_allocation_rule` is a Query entry point, but the service
  // registers the model as `AllocationRule`, so Query's
  // `listGardenAllocationRules` does not exist and the graph call throws.
  const rules = await harvestService.listAllocationRules({
    garden_id: harvest.garden_id,
    is_active: true,
  })

  // Use default rules if none configured
  const allocationRules: ReadonlyArray<AllocationRuleRow> =
    rules.length > 0 ? rules : DEFAULT_ALLOCATION_RULES

  const quantity = Number(harvest.total_quantity ?? 0)
  const estimatedValue =
    harvest.total_estimated_value == null ? null : Number(harvest.total_estimated_value)
  const unit = harvest.unit as string

  const conn = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as PgConnection
  if (!(await claimHarvestForAllocation(conn, id))) {
    return alreadyAllocated()
  }

  // Create allocations, in one call so a failure leaves no partial set. If it
  // fails, hand the harvest back to pending so the organizer can retry.
  let allocations: Array<{ id: string }>
  try {
    allocations = await harvestService.createHarvestAllocations(
      allocationRules.map((rule) => {
        const percentage = Number(rule.percentage)
        return {
          harvest_id: id,
          garden_id: harvest.garden_id,
          pool_type: rule.pool_type,
          percentage,
          quantity: (quantity * percentage) / 100,
          unit,
          estimated_value:
            estimatedValue == null ? null : (estimatedValue * percentage) / 100,
          priority: typeof rule.priority === "number" ? rule.priority : 1,
          status: "allocated",
          claim_deadline: getClaimDeadline(rule.pool_type as PoolType, new Date()),
        }
      })
    )
  } catch (error) {
    await releaseHarvestClaim(conn, id)
    throw error
  }

  res.status(201).json({ allocations })
}
