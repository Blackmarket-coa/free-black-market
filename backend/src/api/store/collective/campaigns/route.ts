import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  BackingMode,
  CampaignType,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../modules/collective-campaign/service"

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
  limit: z.coerce.number().default(20),
  offset: z.coerce.number().default(0),
})

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
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    const campaigns = await service.listCampaigns({
      status: query.status,
      campaign_type: query.campaign_type,
    }, {
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
