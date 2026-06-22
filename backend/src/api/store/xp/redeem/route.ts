import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/xp/redeem")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PROGRESSION_MODULE } from "../../../../modules/progression"
import { InsufficientXpError } from "../../../../modules/progression/service"
import type ProgressionModuleService from "../../../../modules/progression/service"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import {
  EntitlementKind,
  EntitlementSource,
} from "../../../../modules/entitlement/models"
import type EntitlementModuleService from "../../../../modules/entitlement/service"

/**
 * POST /store/xp/redeem  { reward_key }
 *
 * Redeems spendable XP for a catalog reward. Flow:
 *   1. progression.beginRedemption — validate balance, debit XP, open a
 *      `pending` redemption (throws InsufficientXpError if too poor).
 *   2. entitlement.grant — grant the perk / digital-download entitlement.
 *   3. progression.completeRedemption — mark fulfilled with the entitlement id;
 *      on a grant failure, progression.refundRedemption credits the XP back.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const { reward_key } = (req.body as { reward_key?: string }) ?? {}
  if (!reward_key || typeof reward_key !== "string") {
    return res.status(400).json({ error: "reward_key is required" })
  }

  const progression = req.scope.resolve<ProgressionModuleService>(
    PROGRESSION_MODULE
  )
  const entitlement = req.scope.resolve<EntitlementModuleService>(
    ENTITLEMENT_MODULE
  )

  try {
    const { redemption, reward } = await progression.beginRedemption(
      customerId,
      reward_key
    )

    try {
      const expires_at = reward.durationDays
        ? new Date(Date.now() + reward.durationDays * 24 * 60 * 60 * 1000)
        : null

      const grant = await entitlement.grant({
        customer_id: customerId,
        feature_key: reward.featureKey,
        kind: reward.entitlementKind as EntitlementKind,
        source: EntitlementSource.MANUAL,
        expires_at,
        metadata: {
          redeemed_with_xp: true,
          reward_key: reward.key,
          xp_cost: reward.xpCost,
          redemption_id: redemption.id,
        },
      })

      await progression.completeRedemption(redemption.id, grant.id)

      const balance = await progression.getSpendableXp(customerId)
      return res.json({
        success: true,
        balance,
        redemption: { ...redemption, status: "fulfilled", entitlement_id: grant.id },
        entitlement: grant,
      })
    } catch (grantError) {
      // Granting failed — refund the XP so it is never lost.
      log.error("Entitlement grant failed; refunding XP redemption:", grantError)
      await progression.refundRedemption(redemption.id)
      const balance = await progression.getSpendableXp(customerId)
      return res
        .status(502)
        .json({ error: "Failed to grant reward; XP refunded", balance })
    }
  } catch (error) {
    if (error instanceof InsufficientXpError) {
      return res.status(409).json({
        error: "Insufficient spendable XP",
        required: error.required,
        available: error.available,
      })
    }
    if (error instanceof Error && error.message.startsWith("Unknown reward")) {
      return res.status(404).json({ error: "Unknown reward" })
    }
    log.error("Error redeeming XP:", error)
    return res.status(500).json({ error: "Failed to redeem XP" })
  }
}
