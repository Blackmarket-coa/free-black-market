import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CampaignStatus,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../../modules/collective-campaign/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../modules/hawala-ledger/service"
import { emitBlackoutEvent } from "../../../../../lib/blackout-emit"
import {
  BACKING_REFUND_ENTRY_KEY,
  escrowedCentsForBacking,
  isCampaignEscrowLive,
} from "../../../../../lib/campaign-escrow"

const patchSchema = z.object({
  action: z.enum(["activate", "transition", "release-maker-fee", "mark-failed"]),
  status: z.nativeEnum(CampaignStatus).optional(),
  milestone: z.enum(["MATERIALS_RECEIVED", "FULFILLMENT"]).optional(),
})

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    const dashboard = await service.getCampaignDashboard(req.params.id)
    return res.json({ campaign_dashboard: dashboard })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    return res.status(message.toLowerCase().includes("not found") ? 404 : 500).json({ error: message })
  }
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  try {
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
    const [campaign] = await service.listCampaigns({ id: req.params.id })

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" })
    }

    if (campaign.vendor_id !== vendorId) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const body = patchSchema.parse(req.body)

    if (body.action === "activate") {
      const updated = await service.transitionCampaignStatus(req.params.id, CampaignStatus.ACTIVE)
      return res.json({ campaign: updated })
    }

    if (body.action === "transition") {
      if (!body.status) {
        return res.status(400).json({ error: "status is required for transition action" })
      }
      const updated = await service.transitionCampaignStatus(req.params.id, body.status)
      return res.json({ campaign: updated })
    }

    if (body.action === "release-maker-fee") {
      if (!body.milestone) {
        return res.status(400).json({ error: "milestone is required for release-maker-fee action" })
      }
      const release = await service.releaseMakerFeeByMilestone(req.params.id, body.milestone)
      return res.json({ release })
    }

    // mark-failed: when escrow is live, refund every escrowed PLEDGED
    // backing BEFORE flipping statuses. On any ledger failure nothing is
    // flipped and the 402 lets the caller retry — the deterministic
    // campaign-refund-<backingId> keys make re-runs safe.
    if (isCampaignEscrowLive()) {
      const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
      const pledged = await service.listBackings({
        campaign_id: req.params.id,
        status: "PLEDGED",
      })

      const refunds: { backing_id: string; entry_id: string; amount_cents: number }[] = []
      try {
        for (const backing of pledged) {
          const amountCents = escrowedCentsForBacking(backing)
          if (amountCents == null) {
            // Backed while escrow was dark — no funds were moved, nothing to refund.
            continue
          }
          const entry = await hawala.refundCampaignBackingEscrow({
            campaignId: req.params.id,
            backingId: backing.id,
            backerCustomerId: backing.backer_id,
            amountCents,
            reason: "campaign failed",
          })
          refunds.push({ backing_id: backing.id, entry_id: entry.id, amount_cents: amountCents })
          await service.updateBackings({
            id: backing.id,
            metadata: {
              ...((backing.metadata as Record<string, unknown> | null) ?? {}),
              [BACKING_REFUND_ENTRY_KEY]: entry.id,
            },
          })
        }
      } catch (escrowError) {
        return res
          .status(402)
          .json({ error: `Escrow operation failed: ${getErrorMessage(escrowError)}` })
      }

      const result = await service.markCampaignFailed(req.params.id)

      for (const refund of refunds) {
        await emitBlackoutEvent(
          req.scope,
          "ledger.refund",
          {
            vendorId: campaign.vendor_id,
            orderId: refund.backing_id,
            amountMinorUnits: refund.amount_cents,
            currency: "USD",
            ledgerTxId: refund.entry_id,
          },
          { eventId: `ledger.refund:${refund.backing_id}` }
        )
      }

      return res.json({ ...result, refund_ledger_entries: refunds })
    }

    const result = await service.markCampaignFailed(req.params.id)
    return res.json(result)
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }

    const message = getErrorMessage(error)
    return res.status(400).json({ error: message })
  }
}
