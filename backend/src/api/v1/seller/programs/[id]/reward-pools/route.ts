import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../../modules/creator-program"
import type CreatorProgramService from "../../../../../../modules/creator-program/service"
import { CREATOR_REWARDS_MODULE } from "../../../../../../modules/creator-rewards"
import type CreatorRewardsService from "../../../../../../modules/creator-rewards/service"
import { RewardPoolKind } from "../../../../../../modules/creator-rewards/models"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../modules/marketplace-webhooks/service"

const CreateSchema = z.object({
  total_cents: z.number().int().min(100).max(1_000_000_000_000),
  period_start: z.string().datetime().optional(),
  period_end: z.string().datetime(),
  kind: z.nativeEnum(RewardPoolKind).optional(),
  rate_per_kqv_cents: z.number().int().min(0).max(1_000_000).optional().nullable(),
  currency_code: z.string().length(3).optional(),
})

/**
 * POST /v1/seller/programs/:id/reward-pools
 *
 * Vendor opens an engagement reward pool against one of their programs
 * and funds it from their seller-earnings account.
 *
 * GET /v1/seller/programs/:id/reward-pools — list pools on this program.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  if (!programId) {
    return res.status(400).json({ message: "Missing program id", type: "invalid_request" })
  }
  const programService = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const programs = await programService.listCreatorPrograms({
    id: programId,
    vendor_id: sellerId,
  })
  if (programs.length === 0) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  const rewards = req.scope.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
  const pools = await rewards.listRewardPools({ program_id: programId })
  return res.status(200).json({ pools })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  if (!programId) {
    return res.status(400).json({ message: "Missing program id", type: "invalid_request" })
  }
  const parsed = CreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid pool payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const programService = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const programs = await programService.listCreatorPrograms({
    id: programId,
    vendor_id: sellerId,
  })
  const program = programs[0]
  if (!program) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }

  const rewards = req.scope.resolve<CreatorRewardsService>(CREATOR_REWARDS_MODULE)
  const periodStart = parsed.data.period_start
    ? new Date(parsed.data.period_start)
    : new Date()
  const periodEnd = new Date(parsed.data.period_end)

  let pool
  try {
    pool = await rewards.openPool({
      programId,
      funderSellerId: sellerId,
      kind: parsed.data.kind,
      periodStart,
      periodEnd,
      totalCents: parsed.data.total_cents,
      ratePerKqvCents: parsed.data.rate_per_kqv_cents ?? null,
      currencyCode: parsed.data.currency_code ?? program.currency_code,
    })
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message, type: "invalid_request" })
  }

  // Fund the pool from the vendor's seller-earnings account.
  try {
    const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    await hawala.fundCreatorRewardPool({
      poolId: pool.id,
      funderSellerId: sellerId,
      amountCents: parsed.data.total_cents,
      currencyCode: (parsed.data.currency_code ?? program.currency_code).toUpperCase(),
    })
  } catch (err) {
    console.error("[reward-pools] funding failed", err)
    return res.status(402).json({
      message: `Pool created but funding failed: ${(err as Error).message}`,
      type: "funding_failed",
      pool,
    })
  }

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
    const payload = {
      pool_id: pool.id,
      program_id: programId,
      vendor_id: sellerId,
      total_cents: parsed.data.total_cents,
      kind: pool.kind,
      period_start: periodStart,
      period_end: periodEnd,
    }
    await webhooks.dispatch("creator.reward.pool_opened", sellerId, payload)
    await webhooks.dispatch("creator.reward.pool_funded", sellerId, payload)
  } catch (err) {
    console.error("[reward-pools] webhook dispatch failed", err)
  }

  return res.status(201).json({ pool })
}
