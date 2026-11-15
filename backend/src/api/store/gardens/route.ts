import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GARDEN_MODULE } from "../../../modules/garden"
import { actingCustomerId } from "../../../shared/actor-scope"
import { forbidden } from "../../../shared/community-read-access"

export { GARDEN_MODULE }

interface GardenServiceType {
  createGardens: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateGardens: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteGardens: (ids: string | string[]) => Promise<void>
  createGardenPlots: (data: Record<string, unknown>) => Promise<{ id: string }>
  createGardenMemberships: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/gardens
 * 
 * List all public community gardens
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: gardens, metadata } = await query.graph({
    entity: "garden",
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
      "total_sqft",
      "total_plots",
      "producer_type",
      "governance_model",
      "contact_email",
      "cover_image_url",
      "gallery_urls",
      "status",
    ],
    filters: {
      status: "active",
    } as any, // is_public filter may not be in generated types
    pagination: {
      skip: parseInt(req.query.offset as string) || 0,
      take: parseInt(req.query.limit as string) || 20,
    },
  })

  res.json({
    gardens,
    count: metadata?.count || gardens.length,
    offset: parseInt(req.query.offset as string) || 0,
    limit: parseInt(req.query.limit as string) || 20,
  })
}

/**
 * POST /store/gardens
 * 
 * Create a new community garden.
 *
 * The creator becomes the garden's first manager: an active `organizer`
 * membership, which is what `actorManagesGarden` checks on every garden write.
 * A garden never recorded who made it before this, so nobody could be
 * authorized to manage one and every write was open to every account.
 *
 * Customers only. A garden is run by its membership roster, and
 * `garden_membership.customer_id` holds customer ids; a seller or driver id
 * written there would be a manager no route could recognise.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const creatorId = actingCustomerId(req)
  if (!creatorId) {
    return forbidden(res)
  }

  const gardenService = req.scope.resolve(GARDEN_MODULE) as GardenServiceType
  const body = req.body as Record<string, unknown>
  
  const {
    name,
    description,
    address,
    city,
    state,
    zip,
    coordinates,
    total_sqft,
    producer_type,
    governance_model,
    contact_email,
    cover_image_url,
    gallery_urls,
  } = body as Record<string, unknown>

  // Generate slug from name
  const nameStr = String(name)
  const slug = nameStr.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const garden = await gardenService.createGardens({
    name,
    slug,
    description,
    address,
    city,
    state,
    zip,
    coordinates,
    total_sqft: total_sqft || 0,
    producer_type: producer_type || "community",
    governance_model: governance_model || "equal_vote",
    contact_email,
    cover_image_url,
    gallery_urls,
    status: "planning",
    total_plots: 0,
  })

  try {
    await gardenService.createGardenMemberships({
      garden_id: garden.id,
      customer_id: creatorId,
      membership_type: "organizer",
      status: "active",
      roles: [],
      joined_at: new Date(),
      voting_power: 1,
    })
  } catch (error) {
    // A garden with no manager could never be edited again; do not leave one.
    await gardenService.deleteGardens(garden.id).catch(() => undefined)
    throw error
  }

  res.status(201).json({ garden })
}
