import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/progression-volunteer-verified")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

type VolunteerVerifiedPayload = {
  log_id: string
  customer_id: string
  verified_by_id: string
  hours: number
  credits: number
}

/**
 * Award COALITION XP when a volunteer log is verified.
 *
 * The award is weighted by *verified* value (anti-karma-farming): the verifier
 * acts as a peer attester, so XP is granted through the attestation path
 * (`recordAttestedXpEvent`) rather than raw self-reported hours. Additive and
 * isolated by try/catch — XP must never break verification.
 */
export default async function progressionVolunteerVerified({
  event: { data },
  container,
}: SubscriberArgs<VolunteerVerifiedPayload>) {
  try {
    const customerId = data.customer_id
    if (!customerId) return

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const progression = container.resolve(
      PROGRESSION_MODULE
    ) as ProgressionModuleService

    // 10 XP per verified hour; the verifier attests, so self-attestation is
    // rejected by the attestation path.
    const xp = Math.max(1, Math.round(Number(data.hours ?? 0) * 10))

    await progression.recordAttestedXpEvent(
      {
        customer_id: customerId,
        role: Stance.COALITION,
        amount: xp,
        reason: "volunteer-verified",
        source_module: "volunteer_log",
        source_id: data.log_id,
        metadata: { hours: data.hours, credits: data.credits },
      },
      { attesterId: data.verified_by_id }
    )

    await progression.recomputeAggregates(customerId, query as never)
  } catch (error) {
    log.error(
      `[progression-volunteer-verified] Failed to award XP for log ${data.log_id}:`,
      error
    )
    // Swallow — XP failure must not break verification.
  }
}

export const config: SubscriberConfig = {
  event: "volunteer.verified",
}
