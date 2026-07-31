import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/admin/collective/campaigns/[id]/resolve-escrow")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CampaignStatus,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../../../modules/collective-campaign"
import type CollectiveCampaignModuleService from "../../../../../../modules/collective-campaign/service"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../../../modules/hawala-ledger/service"
import { emitBlackoutEvent } from "../../../../../../lib/blackout-emit"
import {
  BACKING_ESCROW_ENTRY_KEY,
  escrowedCentsForBacking,
  isCampaignEscrowLive,
} from "../../../../../../lib/campaign-escrow"

const Schema = z.object({
  // Cents to carve out of the escrowed total for the platform; remainder goes
  // to the vendor. Defaults to 0 (full release to vendor).
  platform_fee_cents: z.number().int().min(0).optional(),
  reason: z.string().max(2000).optional(),
})

// Statuses in which the all-or-nothing gate has NOT been passed — there is no
// funded escrow to release.
const UNRELEASABLE_STATUSES: string[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.ACTIVE,
  CampaignStatus.FAILED,
  CampaignStatus.WIND_DOWN,
]

/**
 * POST /admin/collective/campaigns/:id/resolve-escrow
 *
 * Admin releases a FUNDED campaign's escrowed backings to the vendor's
 * SELLER_EARNINGS (optional platform-fee leg carved out of the total).
 * Dark unless FBM_CAMPAIGN_ESCROW_LIVE=1.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (!isCampaignEscrowLive()) {
    return res.status(404).json({ message: "Not found", type: "not_found" })
  }

  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid resolve-escrow payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
  const [campaign] = await service.listCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ message: "Campaign not found", type: "not_found" })
  }
  if (UNRELEASABLE_STATUSES.includes(campaign.status)) {
    return res.status(400).json({
      message: `Campaign escrow can only be released once the campaign is funded (status: ${campaign.status})`,
      type: "invalid_request",
    })
  }

  // The escrowed total is the sum of what actually moved into escrow — only
  // backings carrying a ledger entry id (pledges made while escrow was dark
  // moved no funds and contribute nothing).
  const pledged = await service.listBackings({ campaign_id: id, status: "PLEDGED" })
  const escrowedBackings = pledged
    .map((backing) => ({ backing, amount_cents: escrowedCentsForBacking(backing) }))
    .filter((entry): entry is { backing: (typeof pledged)[number]; amount_cents: number } =>
      entry.amount_cents != null
    )
  const totalCents = escrowedBackings.reduce((sum, entry) => sum + entry.amount_cents, 0)
  if (totalCents <= 0) {
    return res.status(400).json({
      message: "No escrowed funds to release for this campaign",
      type: "invalid_request",
    })
  }

  const feeCents = parsed.data.platform_fee_cents ?? 0
  if (feeCents >= totalCents) {
    return res.status(400).json({
      message: "platform_fee_cents must be less than the escrowed total",
      type: "invalid_request",
    })
  }

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  let releaseResult: Awaited<ReturnType<HawalaLedgerModuleService["releaseCampaignEscrow"]>>
  try {
    releaseResult = await hawala.releaseCampaignEscrow({
      campaignId: id,
      vendorSellerId: campaign.vendor_id,
      amountCents: totalCents,
      platformFeeCents: feeCents,
    })
  } catch (err) {
    return res.status(402).json({
      message: `Escrow operation failed: ${(err as Error).message}`,
      type: "escrow_failed",
    })
  }

  const releaseCents = totalCents - feeCents
  const ledgerEntries = {
    release_entry_id: releaseResult.release_entry.id,
    fee_entry_id: releaseResult.fee_entry?.id ?? null,
  }

  // Persist entry ids and settle the backings. All PLEDGED backings settle:
  // escrowed ones are now paid out, dark-era ones carry no funds to move.
  for (const backing of pledged) {
    await service.updateBackings({ id: backing.id, status: "SETTLED" })
  }
  await service.updateCampaigns({
    id,
    metadata: {
      ...((campaign.metadata as Record<string, unknown> | null) ?? {}),
      escrow_release_ledger_entry_id: ledgerEntries.release_entry_id,
      escrow_release_fee_ledger_entry_id: ledgerEntries.fee_entry_id,
    },
  })

  await emitBlackoutEvent(
    req.scope,
    "ledger.escrow_released",
    {
      vendorId: campaign.vendor_id,
      orderId: id,
      amountMinorUnits: releaseCents,
      currency: "USD",
      ledgerTxId: ledgerEntries.release_entry_id,
    },
    { eventId: `ledger.escrow_released:${id}` }
  )

  log.info(
    `[resolve-escrow] campaign ${id}: released ${releaseCents}c to ${campaign.vendor_id}, fee ${feeCents}c` +
      (parsed.data.reason ? ` (${parsed.data.reason})` : "")
  )

  return res.status(200).json({
    campaign_id: id,
    release_amount_cents: releaseCents,
    platform_fee_cents: feeCents,
    ledger_entries: ledgerEntries,
    settled_backings: pledged.length,
    escrowed_backings: escrowedBackings.map(({ backing, amount_cents }) => ({
      backing_id: backing.id,
      amount_cents,
      escrow_ledger_entry_id: ((backing.metadata as Record<string, unknown> | null) ?? {})[
        BACKING_ESCROW_ENTRY_KEY
      ],
    })),
  })
}
