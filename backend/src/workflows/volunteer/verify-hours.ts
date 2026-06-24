import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"

const VOLUNTEER_MODULE = "volunteerModuleService"
const GARDEN_MODULE = "gardenModuleService"

interface VolunteerServiceType {
  updateVolunteerLogs: (data: Record<string, unknown>) => Promise<{ id: string }>
  createTimeCredits: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteTimeCredits: (id: string) => Promise<void>
}

interface GardenServiceType {
  updateGardenMemberships: (data: Record<string, unknown>) => Promise<{ id: string }>
}

type CompensationContext = {
  logId: string
  creditId?: string
  previousStatus: string
  membershipId?: string
  creditsIssued?: number
}

/**
 * Verify Volunteer Hours Workflow
 * 
 * Verifies volunteer hours and issues time credits.
 */

type VerifyHoursInput = {
  log_id: string
  verified_by_id: string
  approved: boolean
  adjustment_hours?: number
  notes?: string
}

const verifyHoursStep = createStep(
  "verify-volunteer-hours-step",
  async (input: VerifyHoursInput, { container }) => {
    const volunteerService = container.resolve(VOLUNTEER_MODULE) as VolunteerServiceType
    const gardenService = container.resolve(GARDEN_MODULE) as GardenServiceType
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Get log first
    const { data: [log] } = await query.graph({
      entity: "volunteer_log",
      fields: [
        "id",
        "garden_id",
        "customer_id",
        "membership_id",
        "hours",
        "credits_earned",
        "credit_rate",
        "verification_status",
      ],
      filters: { id: input.log_id },
    })

    if (!log) {
      throw new Error("Volunteer log not found")
    }

    const logMembershipId = log.membership_id as string
    const { data: [membership] } = await query.graph({
      entity: "garden_membership",
      fields: ["id", "harvest_credits_balance", "volunteer_hours_balance"],
      filters: { id: logMembershipId },
    })

    if (!membership) {
      throw new Error("Membership not found")
    }

    if (log.verification_status !== "pending") {
      throw new Error("Log has already been processed")
    }

    const previousStatus = log.verification_status as string
    const logHours = log.hours as number
    const logCreditRate = log.credit_rate as number

    if (!input.approved) {
      // Rejected - update status and revert hours
      await volunteerService.updateVolunteerLogs({
        id: input.log_id,
        verification_status: "rejected",
        verified_by_id: input.verified_by_id,
        verified_at: new Date(),
        verification_notes: input.notes,
      })

      await gardenService.updateGardenMemberships({
        id: logMembershipId,
        volunteer_hours_balance: Math.max(0, ((membership.volunteer_hours_balance as number) || 0) - logHours),
      })

      return new StepResponse({
        log_id: input.log_id,
        status: "rejected",
        credits_issued: 0,
      }, { logId: input.log_id, previousStatus } as CompensationContext)
    } else {
      // Approved - calculate final credits
      const finalHours = input.adjustment_hours ?? logHours
      const finalCredits = finalHours * logCreditRate

      await volunteerService.updateVolunteerLogs({
        id: input.log_id,
        verification_status: "verified",
        verified_by_id: input.verified_by_id,
        verified_at: new Date(),
        verification_notes: input.notes,
        hours: finalHours,
        credits_earned: finalCredits,
      })

      const credit = await volunteerService.createTimeCredits({
        garden_id: log.garden_id,
        customer_id: log.customer_id,
        membership_id: logMembershipId,
        source_type: "volunteer_log",
        source_id: input.log_id,
        hours_equivalent: finalHours,
        credit_value: finalCredits,
        earned_at: new Date(),
        expires_at: null, // Credits don't expire
        status: "active",
        balance: finalCredits,
      })

      // Adjust hours if different
      const hoursDiff = finalHours - logHours
      await gardenService.updateGardenMemberships({
        id: logMembershipId,
        harvest_credits_balance: ((membership.harvest_credits_balance as number) || 0) + finalCredits,
        volunteer_hours_balance: ((membership.volunteer_hours_balance as number) || 0) + hoursDiff,
      })

      // Emit a domain event so the progression layer can award COALITION XP,
      // weighted by the verifier as a peer attestation. Best-effort: an
      // event-bus failure must not roll back a verified contribution.
      try {
        const eventBus = container.resolve(
          Modules.EVENT_BUS
        ) as IEventBusModuleService
        await eventBus.emit({
          name: "volunteer.verified",
          data: {
            log_id: input.log_id,
            customer_id: log.customer_id,
            verified_by_id: input.verified_by_id,
            hours: finalHours,
            credits: finalCredits,
          },
        })
      } catch {
        /* event emission is best-effort */
      }

      return new StepResponse({
        log_id: input.log_id,
        status: "verified",
        credits_issued: finalCredits,
        credit_id: credit.id,
      }, { 
        logId: input.log_id, 
        creditId: credit.id,
        previousStatus,
        membershipId: logMembershipId,
        creditsIssued: finalCredits,
      } as CompensationContext)
    }
  },
  async (context: CompensationContext | undefined, { container }) => {
    if (!context) return
    
    const volunteerService = container.resolve(VOLUNTEER_MODULE) as VolunteerServiceType
    
    // Revert log status
    await volunteerService.updateVolunteerLogs({
      id: context.logId,
      verification_status: context.previousStatus,
      verified_by_id: null,
      verified_at: null,
    })

    // Delete credit if created
    if (context.creditId) {
      await volunteerService.deleteTimeCredits(context.creditId)
    }
  }
)

export const verifyVolunteerHoursWorkflow = createWorkflow(
  "verify-volunteer-hours-workflow",
  (input: VerifyHoursInput) => {
    const result = verifyHoursStep(input)
    return new WorkflowResponse(result)
  }
)
