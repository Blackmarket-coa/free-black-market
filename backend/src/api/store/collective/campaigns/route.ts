import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  BackingMode,
  CAMPAIGN_GOAL_KIND_SHARED_GOAL,
  CampaignType,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../modules/collective-campaign/service"
import { COLLECTIVE_QUEST_MODULE, GoalScopeType } from "../../../../modules/collective-quest"
import type CollectiveQuestModuleService from "../../../../modules/collective-quest/service"
import { centsToCampaignAmount } from "../../../../modules/collective-campaign/money"
import { featureFlagState, PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import { createLogger } from "../../../../shared/logger"

const log = createLogger("api/store/collective/campaigns")

/**
 * The body is a discriminated union on `goal_kind`:
 *   - absent            ⇒ a production campaign (unchanged: material lines
 *                         required, maker fee required);
 *   - `"SHARED_GOAL"`   ⇒ a coalition shared goal (docs/BMC_SURVIVAL_PROGRAMS.md
 *                         Phase 1 item 3): no material lines, no maker fee, the
 *                         goal in integer cents, optional milestones. Dark with
 *                         FF_SHARED_GOAL_COALITION_V1 off (409 feature_disabled).
 */
const goalKindSchema = z
  .object({ goal_kind: z.literal(CAMPAIGN_GOAL_KIND_SHARED_GOAL).optional() })
  .passthrough()

const createSharedGoalCampaignSchema = z.object({
  goal_kind: z.literal(CAMPAIGN_GOAL_KIND_SHARED_GOAL),
  name: z.string().min(1),
  description: z.string().min(1),
  media: z.record(z.string(), z.unknown()).optional(),
  cooperative_id: z.string().min(1).optional(),
  host_partner_org_key: z.string().regex(/^[a-z0-9][a-z0-9_]{1,63}$/).optional(),
  goal_amount_cents: z.number().int().positive(),
  milestones: z
    .array(
      z.object({
        title: z.string().min(1),
        target_amount_cents: z.number().int().positive(),
        unit: z.string().min(1).optional(),
        sort_order: z.number().int().min(0).optional(),
        impact_summary: z.string().optional(),
      })
    )
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const createCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  media: z.record(z.string(), z.unknown()).optional(),
  campaign_type: z.nativeEnum(CampaignType),
  batch_minimum: z.number().int().positive().optional(),
  funding_goal_override: z.number().positive().optional(),
  maker_fee: z.number().min(0),
  estimated_production_days: z.number().int().positive().optional(),
  shipping_per_unit: z.number().min(0).optional(),
  pickup_enabled: z.boolean().optional(),
  return_cap_multiplier: z.number().min(1).optional(),
  material_line_items: z.array(
    z.object({
      item_name: z.string().min(1),
      supplier_url: z.string().url(),
      unit_cost_at_listing: z.number().positive(),
      quantity_per_output_unit: z.number().positive().optional(),
      quantity_per_full_campaign: z.number().positive(),
      auto_purchase_supported: z.boolean().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ).min(1),
  asset_type: z.string().optional(),
  productive_lifespan: z.string().optional(),
  yield_per_cycle: z.number().positive().optional(),
  cycle_frequency: z.string().optional(),
  time_to_first_yield_days: z.number().int().positive().optional(),
  compounding_profile: z.string().optional(),
  projected_return_curve: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const listCampaignSchema = z.object({
  status: z.string().optional(),
  campaign_type: z.nativeEnum(CampaignType).optional(),
  /** `SHARED_GOAL` for coalition shared goals only, `STANDARD` for production campaigns only. */
  goal_kind: z.enum([CAMPAIGN_GOAL_KIND_SHARED_GOAL, "STANDARD"]).optional(),
  limit: z.coerce.number().default(20),
  offset: z.coerce.number().default(0),
})

/**
 * The list filter. With FF_SHARED_GOAL_COALITION_V1 off, shared-goal rows are
 * excluded whatever the caller asked for: this list is deliberately unflagged
 * (middlewares.ts explains why) and a dark feature must not leak into it.
 *
 * Returns `null` when nothing can be listed: a caller who asked for
 * `goal_kind=SHARED_GOAL` while the flag is off gets an EMPTY list, not a
 * silently rewritten query that answers with production campaigns — a
 * storefront whose own flag is on would otherwise render production runs
 * under a "Shared Goals" heading.
 */
export function listCampaignFilters(
  query: { status?: string; campaign_type?: CampaignType; goal_kind?: typeof CAMPAIGN_GOAL_KIND_SHARED_GOAL | "STANDARD" },
  sharedGoalEnabled: boolean
): Record<string, unknown> | null {
  if (!sharedGoalEnabled && query.goal_kind === CAMPAIGN_GOAL_KIND_SHARED_GOAL) {
    return null
  }
  const filters: Record<string, unknown> = {}
  if (query.status) filters.status = query.status
  if (query.campaign_type) filters.campaign_type = query.campaign_type
  if (!sharedGoalEnabled || query.goal_kind === "STANDARD") {
    filters.goal_kind = null
  } else if (query.goal_kind === CAMPAIGN_GOAL_KIND_SHARED_GOAL) {
    filters.goal_kind = CAMPAIGN_GOAL_KIND_SHARED_GOAL
  }
  return filters
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  return "Unknown error"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listCampaignSchema.parse(req.query)
    const filters = listCampaignFilters(query, featureFlagState.isEnabled("SHARED_GOAL_COALITION_V1"))
    if (filters === null) {
      return res.json({ campaigns: [], count: 0, offset: query.offset, limit: query.limit })
    }
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    const campaigns = await service.listCampaigns(filters, {
      take: query.limit,
      skip: query.offset,
    })

    return res.json({ campaigns, count: campaigns.length, offset: query.offset, limit: query.limit })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    return res.status(500).json({ error: getErrorMessage(error) })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const { goal_kind } = goalKindSchema.parse(req.body ?? {})
    if (goal_kind === CAMPAIGN_GOAL_KIND_SHARED_GOAL) {
      // Awaited so a validation or service error lands in this handler's catch.
      return await createSharedGoalCampaign(req, res, vendorId)
    }

    const body = createCampaignSchema.parse(req.body)
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)

    const campaign = await service.createCampaignWithMaterialLineItems({
      campaign: {
        vendor_id: vendorId,
        name: body.name,
        description: body.description,
        media: body.media,
        campaign_type: body.campaign_type,
        batch_minimum: body.batch_minimum,
        funding_goal_override: body.funding_goal_override,
        maker_fee: body.maker_fee,
        estimated_production_days: body.estimated_production_days,
        shipping_per_unit: body.shipping_per_unit,
        pickup_enabled: body.pickup_enabled,
        return_cap_multiplier: body.return_cap_multiplier,
        asset_type: body.asset_type,
        productive_lifespan: body.productive_lifespan,
        yield_per_cycle: body.yield_per_cycle,
        cycle_frequency: body.cycle_frequency,
        time_to_first_yield_days: body.time_to_first_yield_days,
        compounding_profile: body.compounding_profile,
        projected_return_curve: body.projected_return_curve,
        metadata: body.metadata,
      },
      material_line_items: body.material_line_items,
    })

    return res.status(201).json({ campaign, backer_modes: Object.values(BackingMode) })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    return res.status(400).json({ error: getErrorMessage(error) })
  }
}

/**
 * Create a shared-goal campaign. The service creates the HOST participant and
 * any milestones; this handler then creates one `collective_goal` (TREASURY,
 * scope_id = campaign id, den_id = cooperative_id) so the existing
 * coalition/quests Thermometer renders progress by snapshotting
 * `collective_campaign.total_backed_amount` — ADR-0004, aggregate never
 * duplicate, and no collective-quest code changes. The goal is best-effort: a
 * thermometer that cannot be created is logged, not a reason to lose the
 * campaign.
 */
async function createSharedGoalCampaign(req: MedusaRequest, res: MedusaResponse, vendorId: string) {
  if (!featureFlagState.isEnabled("SHARED_GOAL_COALITION_V1")) {
    return res.status(409).json({
      type: "feature_disabled",
      message: `Feature flag ${PHASE0_FEATURE_FLAGS.SHARED_GOAL_COALITION_V1} is disabled`,
    })
  }

  const body = createSharedGoalCampaignSchema.parse(req.body)
  const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)

  const campaign = await service.createSharedGoalCampaign({
    vendor_id: vendorId,
    name: body.name,
    description: body.description,
    media: body.media,
    cooperative_id: body.cooperative_id ?? null,
    host_partner_org_key: body.host_partner_org_key ?? null,
    goal_amount_cents: body.goal_amount_cents,
    milestones: body.milestones,
    metadata: body.metadata,
  })

  let thermometer_goal_id: string | null = null
  try {
    const quests = req.scope.resolve<CollectiveQuestModuleService>(COLLECTIVE_QUEST_MODULE)
    const created = await quests.createCollectiveGoals({
      scope_type: GoalScopeType.TREASURY,
      scope_id: campaign.id,
      den_id: body.cooperative_id ?? null,
      title: body.name,
      description: body.description,
      // collective_goal values are the campaign's unit (major), since recomputeGoal
      // snapshots total_backed_amount as-is.
      target_value: centsToCampaignAmount(body.goal_amount_cents),
      current_value: 0,
      unit: "USD",
      opt_in_leaderboard: false,
    })
    thermometer_goal_id = (Array.isArray(created) ? created[0] : created)?.id ?? null
  } catch (error) {
    log.warn(`shared-goal campaign ${campaign.id}: thermometer goal not created: ${getErrorMessage(error)}`)
  }

  const participants = await service.listParticipants({ campaign_id: campaign.id })
  const milestones = await service.listMilestones({ campaign_id: campaign.id })

  return res.status(201).json({ campaign, participants, milestones, thermometer_goal_id })
}
