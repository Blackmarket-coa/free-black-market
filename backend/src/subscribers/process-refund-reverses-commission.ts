import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import CreatorAttributionService from "../modules/creator-attribution/service"
import { CommissionStatus } from "../modules/creator-attribution/models"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"

/**
 * Subscriber: when an order is canceled or refunded, reverse any creator
 * commission attached to it.
 *
 * - If the attribution is still `held` (commission has not yet been moved
 *   to creator earnings), simply mark `reversed`.
 * - If the attribution is `approved` or `paid` (the ledger entry exists),
 *   create a reversing ledger entry (creator -> vendor) AND mark the
 *   attribution `reversed`.
 *
 * Subscribes to the same events as the existing `hawala-order-refund`
 * subscriber so the two stay in sync.
 */
export default async function processRefundReversesCommission({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id

  const attributionService = container.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  let webhooksService: MarketplaceWebhooksService | null = null
  try {
    webhooksService = container.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
  } catch {
    webhooksService = null
  }

  try {
    const list = await attributionService.listOrderAttributions({ order_id: orderId })
    const attribution = list[0]
    if (!attribution) return

    if (
      attribution.commission_status === CommissionStatus.REVERSED ||
      attribution.commission_status === CommissionStatus.DISQUALIFIED
    ) {
      return
    }

    const reason = "order_refund_or_cancel"
    const wasCredited =
      attribution.commission_status === CommissionStatus.APPROVED ||
      attribution.commission_status === CommissionStatus.PAID

    if (wasCredited && attribution.vendor_id) {
      try {
        const hawalaService = container.resolve<HawalaLedgerModuleService>(
          HAWALA_LEDGER_MODULE
        )
        await hawalaService.reverseCreatorCommission({
          vendorSellerId: attribution.vendor_id,
          creatorSellerId: attribution.creator_seller_id,
          amountCents: Number(attribution.commission_amount_cents),
          orderId,
          attributionId: attribution.id,
          reason,
          currencyCode: attribution.currency_code,
        })
      } catch (err) {
        console.error(`[refund-reverses-commission] ledger reversal failed for ${attribution.id}:`, err)
      }
    }

    const updated = await attributionService.reverseCommission(attribution.id, reason)

    if (webhooksService) {
      const payload = {
        attribution_id: attribution.id,
        order_id: orderId,
        creator_seller_id: attribution.creator_seller_id,
        vendor_id: attribution.vendor_id,
        commission_amount_cents: Number(attribution.commission_amount_cents),
        reason,
        commission_status: updated.commission_status,
      }
      try {
        await webhooksService.dispatch(
          "creator.commission.reversed",
          attribution.creator_seller_id,
          payload
        )
        if (attribution.vendor_id) {
          await webhooksService.dispatch(
            "creator.commission.reversed",
            attribution.vendor_id,
            payload
          )
        }
      } catch (err) {
        console.error("[refund-reverses-commission] webhook dispatch failed", err)
      }
    }
  } catch (err) {
    console.error(`[refund-reverses-commission] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: ["order.canceled", "order.refund_created"],
}
