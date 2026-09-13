import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  actorIsAnyOf,
  actorIsGardenMember,
  forbidden,
} from "../../../shared/community-read-access"
import { actingCustomerId } from "../../../shared/actor-scope"

const VOLUNTEER_MODULE = "volunteerModuleService"

interface VolunteerServiceType {
  createVolunteerLogs: (data: Record<string, unknown>) => Promise<{ id: string }>
}

// Inline credit calculation to avoid service import issues
function calculateTimeCreditValue(hours: number, creditRate: number): number {
  return hours * creditRate
}

/**
 * GET /store/volunteer-logs
 * 
 * List volunteer logs
 */
/**
 * Two readings are allowed, and no third (D10-5):
 *
 * - **Your own history**, `?customer_id=<you>` — the subject reading the
 *   subject.
 * - **A garden's log**, `?garden_id=<g>` — for a member of that garden. Hours
 *   and credits are the shared record a garden verifies against.
 *
 * Neither is optional. The handler used to accept a bare `?customer_id=` from
 * anyone, which returned one named person's entire attendance history — when
 * they turn up, how often, how long they stay — to an unauthenticated caller.
 * With no filter at all it returned every log in every garden.
 *
 * An unscoped request is a 400 rather than a silent cross-garden dump: there
 * is no sensible whole-platform answer to this question, so asking for one is
 * a malformed request, not a forbidden one.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { garden_id, customer_id, status } = req.query

  const gardenId = typeof garden_id === "string" ? garden_id : null
  const subjectId = typeof customer_id === "string" ? customer_id : null

  if (!gardenId && !subjectId) {
    return res.status(400).json({
      message: "Provide garden_id, or customer_id for your own logs.",
      type: "invalid_data",
    })
  }

  const readingOwnHistory = !!subjectId && actorIsAnyOf(req, subjectId)
  if (!readingOwnHistory && !(await actorIsGardenMember(req, gardenId))) {
    return forbidden(res)
  }

  const filters: Record<string, unknown> = {}
  if (garden_id) filters.garden_id = garden_id
  if (customer_id) filters.customer_id = customer_id
  if (status) filters.verification_status = status

  const { data: logs } = await query.graph({
    entity: "volunteer_log",
    fields: [
      "id",
      "garden_id",
      "customer_id",
      "activity_type",
      "description",
      "date",
      "hours",
      "verification_status",
      "verified_by_id",
      "credit_rate",
      "credits_earned",
    ],
    filters,
  })

  res.json({ logs })
}

/**
 * POST /store/volunteer-logs
 * 
 * Log volunteer hours
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const volunteerService = req.scope.resolve(VOLUNTEER_MODULE) as VolunteerServiceType

  const {
    garden_id,
    customer_id,
    membership_id,
    activity_type,
    description,
    date,
    start_time,
    end_time,
    hours,
    work_party_id,
    plot_id,
  } = req.body as Record<string, unknown>

  // SEC: a customer may only log hours for themselves. Bind customer_id to the
  // authenticated actor; non-customer actors fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectiveCustomerId = (actingCustomer ?? customer_id) as string

  // SEC: and a customer must not borrow another member's membership_id, so
  // reject a membership that belongs to someone else.
  if (actingCustomer && membership_id) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
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

  // Calculate default credit rate
  const credit_rate = 15 // $15/hour default
  const credits_earned = calculateTimeCreditValue(hours as number, credit_rate)

  const log = await volunteerService.createVolunteerLogs({
    garden_id,
    customer_id: effectiveCustomerId,
    membership_id,
    activity_type,
    description,
    date: new Date(date as string),
    start_time,
    end_time,
    hours,
    verification_status: "pending",
    credit_rate,
    credits_earned,
    work_party_id,
    plot_id,
  })

  res.status(201).json({ log })
}
