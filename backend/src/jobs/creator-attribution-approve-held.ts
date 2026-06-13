import { createLogger } from "../shared/logger"
const log = createLogger("jobs/creator-attribution-approve-held")
import { MedusaContainer } from "@medusajs/framework/types"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import CreatorAttributionService from "../modules/creator-attribution/service"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

/**
 * Hourly scheduled job that finds creator-attributed commissions whose hold
 * window has expired and credits them to the creator's earnings account via
 * `hawala-ledger.creditCreatorCommission`.
 *
 * The job is idempotent: each ledger entry uses the attribution id as its
 * idempotency key, and the attribution row's `commission_status` gates
 * subsequent runs.
 */
export default async function approveHeldCreatorAttributionsJob(
  container: MedusaContainer
) {
  const attributionService = container.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const hawalaService = container.resolve<HawalaLedgerModuleService>(
    HAWALA_LEDGER_MODULE
  )
  let webhooksService: MarketplaceWebhooksService | null = null
  try {
    webhooksService = container.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
  } catch {
    webhooksService = null
  }

  const due = await attributionService.listHeldAttributionsDue()
  if (due.length === 0) return

  log.info(`[creator-approve-held] processing ${due.length} due attributions`)

  for (const a of due) {
    const amountCents = Number(a.commission_amount_cents)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      // Edge case: nothing to credit (zero-cent attribution).
      try {
        await attributionService.approveCommission(a.id, "")
      } catch (err) {
        log.error(`[creator-approve-held] zero-cent approve failed for ${a.id}`, err)
      }
      continue
    }

    if (!a.vendor_id) {
      // Without a vendor we can't ledger the transfer; mark disqualified
      // rather than blocking forever.
      try {
        await attributionService.disqualifyAttribution(a.id, "missing_vendor_id")
      } catch (err) {
        log.error(`[creator-approve-held] disqualify failed for ${a.id}`, err)
      }
      continue
    }

    try {
      const entry = await hawalaService.creditCreatorCommission({
        vendorSellerId: a.vendor_id,
        creatorSellerId: a.creator_seller_id,
        amountCents,
        orderId: a.order_id,
        attributionId: a.id,
        currencyCode: a.currency_code,
      })
      const updated = await attributionService.approveCommission(a.id, entry.id)
      if (webhooksService) {
        const payload = {
          attribution_id: a.id,
          order_id: a.order_id,
          creator_seller_id: a.creator_seller_id,
          vendor_id: a.vendor_id,
          ledger_entry_id: entry.id,
          commission_amount_cents: amountCents,
          currency_code: a.currency_code,
          commission_status: updated.commission_status,
        }
        try {
          await webhooksService.dispatch(
            "creator.commission.approved",
            a.creator_seller_id,
            payload
          )
          await webhooksService.dispatch(
            "creator.commission.approved",
            a.vendor_id,
            payload
          )
        } catch (err) {
          log.error(`[creator-approve-held] webhook dispatch failed for ${a.id}`, err)
        }
      }
    } catch (err) {
      log.error(`[creator-approve-held] approval failed for ${a.id}`, err)
    }
  }
}

export const config = {
  name: "creator-attribution-approve-held",
  schedule: "0 * * * *", // hourly
}
