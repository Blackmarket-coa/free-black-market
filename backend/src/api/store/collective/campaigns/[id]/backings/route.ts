import { randomUUID } from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { z } from "zod"
import {
  BackingMode,
  CampaignStatus,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../../../modules/collective-campaign"
import CollectiveCampaignModuleService from "../../../../../../modules/collective-campaign/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import {
  BACKING_ESCROW_CENTS_KEY,
  BACKING_ESCROW_ENTRY_KEY,
  campaignAmountToCents,
  isCampaignEscrowLive,
} from "../../../../../../lib/campaign-escrow"

const createBackingSchema = z.object({
  mode: z.nativeEnum(BackingMode),
  amount: z.number().positive(),
  units_reserved: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const backerId = (req as any).auth_context?.actor_id
    if (!backerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const body = createBackingSchema.parse(req.body)
    const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)

    // All-or-nothing escrow (dark unless FBM_CAMPAIGN_ESCROW_LIVE=1): move the
    // backing amount into the campaign's escrow BEFORE persisting the backing,
    // so a backing row never exists without funds behind it. Ledger failure
    // returns 402 and no backing is created.
    const escrowLive = isCampaignEscrowLive()
    let backingId: string | undefined
    let backingMetadata = body.metadata

    if (escrowLive) {
      const [campaign] = await service.listCampaigns({ id: req.params.id })
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" })
      }
      if (campaign.status !== CampaignStatus.ACTIVE) {
        return res.status(400).json({ error: "Backings can only be added to ACTIVE campaigns" })
      }

      const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
      // Backing.amount is major units (dollars); the ledger wrappers take cents.
      const amountCents = campaignAmountToCents(body.amount)
      // Mint the backing id up front so the escrow idempotency key
      // (campaign-backing-<backingId>) exists before the row does.
      backingId = `cbck_${randomUUID()}`

      let escrowEntry: { id: string }
      try {
        escrowEntry = await hawala.openCampaignBackingEscrow({
          campaignId: req.params.id,
          backingId,
          backerCustomerId: backerId,
          amountCents,
        })
      } catch (escrowError) {
        return res
          .status(402)
          .json({ error: `Escrow operation failed: ${getErrorMessage(escrowError)}` })
      }

      backingMetadata = {
        ...(body.metadata ?? {}),
        [BACKING_ESCROW_ENTRY_KEY]: escrowEntry.id,
        [BACKING_ESCROW_CENTS_KEY]: amountCents,
      }
    }

    let backing
    try {
      backing = await service.addBacking({
        ...(backingId ? { id: backingId } : {}),
        campaign_id: req.params.id,
        backer_id: backerId,
        mode: body.mode,
        amount: body.amount,
        units_reserved: body.units_reserved,
        metadata: backingMetadata,
      })
    } catch (error) {
      if (escrowLive && backingId) {
        // Compensate so a failed insert never strands escrowed funds. The
        // deterministic campaign-refund-<backingId> key keeps retries safe.
        try {
          const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
          await hawala.refundCampaignBackingEscrow({
            campaignId: req.params.id,
            backingId,
            backerCustomerId: backerId,
            amountCents: campaignAmountToCents(body.amount),
            reason: "backing creation failed",
          })
        } catch {
          /* funds remain in campaign escrow; failure surfaces below */
        }
      }
      throw error
    }

    // Emit a domain event so the progression layer can award INVESTOR XP.
    // Isolated so an event-bus hiccup never fails the backing itself.
    try {
      const eventBus = req.scope.resolve<IEventBusModuleService>(
        Modules.EVENT_BUS
      )
      await eventBus.emit({
        name: "campaign.backed",
        data: {
          backing_id: backing.id,
          campaign_id: req.params.id,
          backer_id: backerId,
          mode: body.mode,
          amount: body.amount,
        },
      })
    } catch {
      /* event emission is best-effort */
    }

    return res.status(201).json({ backing })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }

    const message = getErrorMessage(error)
    return res.status(message.toLowerCase().includes("not found") ? 404 : 400).json({ error: message })
  }
}
