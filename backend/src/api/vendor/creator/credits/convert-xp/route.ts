import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/vendor/creator/credits/convert-xp")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../../shared/auth-helpers"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { PROGRESSION_MODULE } from "../../../../../modules/progression"
import {
  InsufficientXpError,
} from "../../../../../modules/progression/service"
import type ProgressionModuleService from "../../../../../modules/progression/service"
import {
  isCreatorCreditsLive,
  quoteXpConversion,
  XpConversionError,
} from "../../../../../lib/creator-credits"
import {
  getCreatorCreditBalance,
  getOrCreateCcrIssuerAccount,
  getOrCreateCreatorCcrAccount,
  resolveCreatorOwnerCustomerId,
  type CreatorQueryLike,
} from "../../../../../lib/creator-hub"

/**
 * POST /vendor/creator/credits/convert-xp  { xp?: number }
 *
 * Convert spendable XP into Coalition Credits (₡) in whole 1,000 XP → 50₡
 * blocks. Dark unless FBM_CREATOR_CREDITS_LIVE=1 (mirrors the campaign-escrow
 * resolve-escrow precedent — 404 before any service is resolved).
 *
 * Flow (mirrors store/xp/redeem's begin → effect → complete / refund):
 *   1. quote the whole-block conversion (default: max whole blocks affordable).
 *   2. progression.beginXpConversion — atomically debit XP, open a pending
 *      redemption (409 on InsufficientXpError).
 *   3. hawala.createTransfer — mint ₡ from the CCR issuer to the creator's CCR
 *      wallet (entry_type CREDIT_PAYOUT_MINT, idempotency keyed to the
 *      redemption id). On failure the XP is refunded so it is never lost.
 *   4. progression.completeRedemption — mark the redemption fulfilled.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (!isCreatorCreditsLive()) {
    return res.status(404).json({ message: "Not found", type: "not_found" })
  }

  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const { xp } = (req.body as { xp?: number }) ?? {}

  const query = req.scope.resolve<CreatorQueryLike>(ContainerRegistrationKeys.QUERY)
  const customerId = await resolveCreatorOwnerCustomerId(query, sellerId)
  if (!customerId) {
    return res.status(404).json({
      message: "No owner member for this creator",
      type: "not_found",
    })
  }

  const progression = req.scope.resolve<ProgressionModuleService>(PROGRESSION_MODULE)
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  // Default to converting the maximum whole-block amount of the current
  // balance; quoteXpConversion floors any partial block regardless.
  const spendable = await progression.getSpendableXp(customerId)
  const requestedXp = typeof xp === "number" ? xp : spendable

  let quote
  try {
    quote = quoteXpConversion(requestedXp)
  } catch (err) {
    if (err instanceof XpConversionError) {
      return res.status(400).json({ message: err.message, type: "invalid_request" })
    }
    throw err
  }

  // 2. Atomically debit XP (opens a pending redemption).
  let redemptionId: string
  try {
    const { redemption } = await progression.beginXpConversion(customerId, quote.xpDebited)
    redemptionId = redemption.id
  } catch (err) {
    if (err instanceof InsufficientXpError) {
      return res.status(409).json({
        message: "Insufficient spendable XP",
        type: "insufficient_xp",
        required: err.required,
        available: err.available,
      })
    }
    throw err
  }

  // 3. Mint ₡ from the issuer to the creator's CCR wallet.
  try {
    const issuer = await getOrCreateCcrIssuerAccount(hawala)
    const creatorAccount = await getOrCreateCreatorCcrAccount(hawala, sellerId)
    await hawala.createTransfer({
      debit_account_id: issuer.id,
      credit_account_id: creatorAccount.id,
      amount: quote.creditsMinted,
      entry_type: "CREDIT_PAYOUT_MINT",
      // Stable key derived from the debit record — a retry of the same
      // conversion re-uses the same ledger entry instead of double-minting.
      idempotency_key: `xp-convert-${redemptionId}`,
      reference_type: "MANUAL",
      description: "XP conversion",
      metadata: { xp_redemption_id: redemptionId, converted_xp: quote.xpDebited },
    })
  } catch (err) {
    // Ledger move failed after the XP debit — refund so XP is never lost.
    await progression.refundRedemption(redemptionId)
    log.error("CCR mint failed; refunded XP conversion", err)
    return res.status(402).json({
      message: `Credit conversion failed; XP refunded: ${(err as Error).message}`,
      type: "conversion_failed",
    })
  }

  // 4. Mark the redemption fulfilled.
  await progression.completeRedemption(redemptionId)

  const balance = await getCreatorCreditBalance(hawala, sellerId)
  return res.status(200).json({
    converted_xp: quote.xpDebited,
    credits: quote.creditsMinted,
    balance: balance.available_credits,
  })
}
