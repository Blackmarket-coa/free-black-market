import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createLogger } from "../../../../../../shared/logger"
import { requireEntitlementsAuth } from "../../../../../../lib/blackout-entitlements-auth"
import { resolveOrCreateCustomerForBlackoutUser } from "../../../../../../lib/blackout-identity"
import { PROGRESSION_MODULE } from "../../../../../../modules/progression"
import type ProgressionModuleService from "../../../../../../modules/progression/service"
import {
  COALITION_KARMA_DELTAS,
  COALITION_KARMA_SOURCE_MODULE,
  COALITION_KARMA_STANCE,
  coalitionKarmaReason,
  coalitionKarmaSourceId,
  isCoalitionKarmaEventType,
} from "../../../../../../modules/progression/coalition-karma"

const log = createLogger("api/v1/integrations/blackout/reputation/events")

const BodySchema = z
  .object({
    blackoutUserId: z.string().min(1).max(120),
    mxid: z.string().min(3).max(255).optional(),
    eventType: z.string().min(1).max(64),
    /** Stable Blackout-side id for this logical event; the replay key. */
    referenceId: z.string().min(1).max(200),
    coalitionId: z.string().min(1).max(120),
    occurredAt: z.string().datetime().optional(),
  })
  .strict()

/**
 * POST /v1/integrations/blackout/reputation/events
 *
 * The inbound path by which Blackout coalition activity earns KARMA on the one
 * ecosystem ladder. Service-token authenticated, like every other §4 route.
 *
 * The delta is chosen HERE from a fixed table, never taken from the caller:
 * Blackout says *what happened*, FBM decides *what it is worth*. That keeps the
 * reputation economy in one place and means a compromised or buggy caller
 * cannot mint reputation.
 *
 * Deltas are flat and never scale with money, because reputation and capital
 * are required to stay structurally separate (see
 * `modules/progression/coalition-karma.ts` and `thresholds.ts`). Nothing
 * awarded here touches pricing, commission or offering access — if that ever
 * changes, it needs legal review before it ships, not after.
 *
 * Idempotent: `(source_module, source_id)` dedupes at the canonical karma log.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid reputation event payload",
      details: parsed.error.flatten(),
    })
  }

  const { blackoutUserId, mxid, eventType, referenceId, coalitionId } = parsed.data

  if (!isCoalitionKarmaEventType(eventType)) {
    // An unknown event type is a contract drift, not a reason to guess a value.
    return res.status(400).json({
      code: "unknown_event_type",
      message: `Unknown coalition reputation event "${eventType}"`,
      known: Object.keys(COALITION_KARMA_DELTAS),
    })
  }

  const resolved = await resolveOrCreateCustomerForBlackoutUser(req.scope, {
    blackoutUserId,
    mxid: mxid ?? null,
  })
  const customerId = resolved?.customerId
  if (!customerId) {
    // No identity to award: say so plainly rather than dropping it silently,
    // so Blackout can retry once the member has linked their account.
    return res.status(404).json({
      code: "identity_unresolved",
      message: "No FBM customer for this Blackout user",
    })
  }

  const progression = req.scope.resolve<ProgressionModuleService>(PROGRESSION_MODULE)
  const amount = COALITION_KARMA_DELTAS[eventType]
  const sourceId = coalitionKarmaSourceId(eventType, referenceId)

  try {
    await progression.recordXpEvent({
      customer_id: customerId,
      role: COALITION_KARMA_STANCE,
      amount,
      reason: coalitionKarmaReason(eventType),
      source_module: COALITION_KARMA_SOURCE_MODULE,
      source_id: sourceId,
      metadata: {
        coalition_id: coalitionId,
        blackout_user_id: blackoutUserId,
        occurred_at: parsed.data.occurredAt ?? new Date().toISOString(),
      },
    })
  } catch (error) {
    // Reputation must never break the originating flow on Blackout's side, so
    // the failure is reported rather than thrown — Blackout treats a non-2xx
    // as "retry later", and the dedupe key makes that safe.
    log.warn("coalition karma award failed", {
      event_type: eventType,
      source_id: sourceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return res.status(502).json({
      code: "award_failed",
      message: "Could not record the reputation event",
    })
  }

  log.info("coalition karma awarded", {
    event_type: eventType,
    amount,
    source_id: sourceId,
    coalition_id: coalitionId,
  })

  return res.status(202).json({
    recorded: true,
    stance: COALITION_KARMA_STANCE,
    amount,
    reason: coalitionKarmaReason(eventType),
    sourceModule: COALITION_KARMA_SOURCE_MODULE,
    sourceId,
  })
}
