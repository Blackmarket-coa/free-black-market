import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../shared/actor-scope"

const VOLUNTEER_MODULE = "volunteerModuleService"

interface VolunteerServiceType {
  createWorkPartys: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/work-parties
 * 
 * List work parties
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { garden_id, status, upcoming } = req.query

  const filters: Record<string, unknown> = {}
  if (garden_id) filters.garden_id = garden_id
  if (status) filters.status = status

  const { data: workParties } = await query.graph({
    entity: "work_party",
    fields: [
      "id",
      "garden_id",
      "title",
      "description",
      "scheduled_date",
      "start_time",
      "end_time",
      "expected_hours",
      "max_participants",
      "current_signups",
      "activity_types",
      "credit_multiplier",
      "status",
      "location_notes",
      "requirements",
      "provides",
    ],
    filters,
  })

  // Filter upcoming if requested
  let result = workParties
  if (upcoming === "true") {
    const now = new Date()
    result = workParties.filter((wp: { scheduled_date: string | Date }) => new Date(wp.scheduled_date) >= now)
  }

  res.json({ work_parties: result })
}

/**
 * POST /store/work-parties
 * 
 * Create a new work party
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const volunteerService = req.scope.resolve(VOLUNTEER_MODULE) as unknown as VolunteerServiceType

  const {
    garden_id,
    title,
    description,
    scheduled_date,
    start_time,
    end_time,
    expected_hours,
    max_participants,
    activity_types,
    credit_multiplier,
    location_notes,
    requirements,
    provides,
    organizer_id,
  } = req.body as Record<string, unknown>

  // SEC: bind the work party's organizer to the authenticated customer so a
  // logged-in customer cannot create one under someone else's id. Non-customer
  // actors (seller/driver) fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectiveOrganizerId = (actingCustomer ?? organizer_id) as string

  const workParty = await volunteerService.createWorkPartys({
    garden_id,
    title,
    description,
    scheduled_date: new Date(scheduled_date as string),
    start_time,
    end_time,
    expected_hours,
    max_participants,
    current_signups: 0,
    activity_types: (activity_types as string[]) || [],
    credit_multiplier: (credit_multiplier as number) || 1.0,
    status: "scheduled",
    location_notes,
    requirements,
    provides,
    organizer_id: effectiveOrganizerId,
  })

  res.status(201).json({ work_party: workParty })
}
