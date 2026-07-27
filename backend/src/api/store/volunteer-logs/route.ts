import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { garden_id, customer_id, status } = req.query

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
