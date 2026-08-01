import { randomUUID } from "crypto"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../../shared/auth-helpers"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { isCreatorCreditsLive } from "../../../../../lib/creator-credits"
import { getOrCreateCcrIssuerAccount, getOrCreateCreatorCcrAccount } from "../../../../../lib/creator-hub"

/**
 * POST /vendor/creator/credits/withdraw  { credits: number }
 *
 * A closed-loop credit-redemption REQUEST. Under Posture A, Coalition Credits
 * never convert to cash — so this is NOT a cash-out. It burns the requested ₡
 * from the creator's CCR wallet back to the issuer (entry_type
 * CREDIT_REFUND_BURN) and records the burn as pending manual settlement. Dark
 * unless FBM_CREATOR_CREDITS_LIVE=1 (404 before any service is resolved).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (!isCreatorCreditsLive()) {
    return res.status(404).json({ message: "Not found", type: "not_found" })
  }

  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const { credits } = (req.body as { credits?: number }) ?? {}
  const amount = Number(credits)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      message: "credits must be a positive number",
      type: "invalid_request",
    })
  }

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const creatorAccount = await getOrCreateCreatorCcrAccount(hawala, sellerId)
  const issuer = await getOrCreateCcrIssuerAccount(hawala)

  // One request id per redemption request; the idempotency key is a stable
  // function of it (not Date.now/random) so a retried request replays the same
  // ledger entry rather than burning twice.
  const requestId = `cwr_${randomUUID()}`

  try {
    await hawala.createTransfer({
      debit_account_id: creatorAccount.id,
      credit_account_id: issuer.id,
      amount,
      entry_type: "CREDIT_REFUND_BURN",
      idempotency_key: `credit-withdraw-${requestId}`,
      reference_type: "MANUAL",
      description: "Credit withdrawal request",
      metadata: {
        redemption_request: true,
        status: "pending_settlement",
        request_id: requestId,
      },
    })
  } catch (err) {
    const message = (err as Error).message ?? ""
    if (/insufficient balance/i.test(message)) {
      return res.status(409).json({
        message: "Insufficient credit balance for this withdrawal",
        type: "insufficient_balance",
      })
    }
    return res.status(402).json({
      message: `Withdrawal request failed: ${message}`,
      type: "withdrawal_failed",
    })
  }

  return res.status(200).json({
    request_id: requestId,
    credits: amount,
    status: "pending",
  })
}
