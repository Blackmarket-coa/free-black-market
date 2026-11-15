import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { KITCHEN_MODULE } from "../../../modules/kitchen"
import { requireSellerActor } from "../../../shared/community-write-access"

export { KITCHEN_MODULE }

interface KitchenServiceType {
  createKitchens: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateKitchens: (data: Record<string, unknown>) => Promise<{ id: string }>
  createKitchenSpaces: (data: Record<string, unknown>) => Promise<{ id: string }>
  createKitchenMemberships: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/kitchens
 *
 * List all public commercial community kitchens
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: kitchens, metadata } = await query.graph({
    entity: "kitchen",
    fields: [
      "id",
      "name",
      "slug",
      "description",
      "address",
      "city",
      "state",
      "zip",
      "coordinates",
      "kitchen_type",
      "total_sqft",
      "total_stations",
      "max_concurrent_users",
      "certifications",
      "status",
      "hourly_rate",
      "monthly_membership_fee",
      "amenities",
      "operating_hours",
      "contact_email",
      "contact_phone",
      "website",
      "cover_image_url",
      "gallery_urls",
    ],
    filters: {
      status: "active",
    },
    pagination: {
      skip: parseInt(req.query.offset as string) || 0,
      take: parseInt(req.query.limit as string) || 20,
    },
  })

  res.json({
    kitchens,
    count: metadata?.count || kitchens.length,
    offset: parseInt(req.query.offset as string) || 0,
    limit: parseInt(req.query.limit as string) || 20,
  })
}

/**
 * POST /store/kitchens
 *
 * Create a new commercial community kitchen.
 *
 * Sellers only, and the kitchen is stamped with the creating vendor in
 * `managing_org_id` (the model's "links to vendor if org-managed" column). A
 * kitchen is a business that rents stations at an hourly rate; before this any
 * signed-in account could create one, and none recorded who did, so no later
 * route could ever tell its operator from a stranger.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerActor(req, res)
  if (!sellerId) return

  const kitchenService = req.scope.resolve(KITCHEN_MODULE) as KitchenServiceType
  const body = req.body as Record<string, unknown>

  const {
    name,
    description,
    address,
    city,
    state,
    zip,
    coordinates,
    kitchen_type,
    total_sqft,
    total_stations,
    max_concurrent_users,
    certifications,
    governance_model,
    hourly_rate,
    monthly_membership_fee,
    deposit_required,
    amenities,
    operating_hours,
    contact_email,
    contact_phone,
    website,
    cover_image_url,
    gallery_urls,
  } = body

  // Generate slug from name
  const nameStr = String(name)
  const slug = nameStr.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const kitchen = await kitchenService.createKitchens({
    name,
    slug,
    description,
    address,
    city,
    state,
    zip,
    coordinates,
    kitchen_type: kitchen_type || "community",
    total_sqft: total_sqft || 0,
    total_stations: total_stations || 0,
    max_concurrent_users: max_concurrent_users || 1,
    certifications,
    status: "planning",
    governance_model: governance_model || "equal_vote",
    hourly_rate,
    monthly_membership_fee,
    deposit_required,
    amenities,
    operating_hours,
    contact_email,
    contact_phone,
    website,
    cover_image_url,
    gallery_urls,
    managing_org_id: sellerId,
  })

  res.status(201).json({ kitchen })
}
