import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { actingCustomerId } from "../../../../../shared/actor-scope"

const VOLUNTEER_MODULE = "volunteerModuleService"

interface VolunteerServiceType {
  createWorkPartySignups: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateWorkPartys: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * GET /store/work-parties/:id/signups
 * 
 * Get signups for a work party
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: signups } = await query.graph({
    entity: "work_party_signup",
    fields: [
      "id",
      "customer_id",
      "membership_id",
      "status",
      "signed_up_at",
      "check_in_time",
      "check_out_time",
      "actual_hours",
      "notes",
    ],
    filters: {
      work_party_id: id,
    },
  })

  res.json({ signups })
}

/**
 * POST /store/work-parties/:id/signups
 * 
 * Sign up for a work party
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const volunteerService = req.scope.resolve(VOLUNTEER_MODULE) as unknown as VolunteerServiceType
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { customer_id, membership_id, notes } = req.body as Record<string, unknown>

  // SEC: a customer may only sign themselves up. Bind customer_id to the
  // authenticated actor; non-customer actors fall back to the body value.
  const actingCustomer = actingCustomerId(req)
  const effectiveCustomerId = (actingCustomer ?? customer_id) as string

  // SEC: and a customer must not borrow another member's membership_id, so
  // reject a membership that belongs to someone else.
  if (actingCustomer && membership_id) {
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

  // Check capacity
  const { data: [workParty] } = await query.graph({
    entity: "work_party",
    fields: ["id", "max_participants", "current_signups", "status"],
    filters: { id },
  })

  if (!workParty) {
    res.status(404).json({ message: "Work party not found" })
    return
  }

  if (workParty.status !== "scheduled") {
    res.status(400).json({ message: "Work party is not open for signups" })
    return
  }

  const maxParticipants = workParty.max_participants as number | null
  const currentSignups = workParty.current_signups as number

  if (maxParticipants && currentSignups >= maxParticipants) {
    res.status(400).json({ message: "Work party is at capacity" })
    return
  }

  const signup = await volunteerService.createWorkPartySignups({
    work_party_id: id,
    customer_id: effectiveCustomerId,
    membership_id,
    status: "signed_up",
    signed_up_at: new Date(),
    notes,
  })

  // Update signup count
  await volunteerService.updateWorkPartys({
    id,
    current_signups: currentSignups + 1,
  })

  res.status(201).json({ signup })
}
