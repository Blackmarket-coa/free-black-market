import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/attribute-order-on-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import CreatorAttributionService from "../modules/creator-attribution/service"
import { CommissionStatus } from "../modules/creator-attribution/models"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"
import { resolveSellerBlackoutUserId } from "../lib/blackout-identity"
import { emitReferralAttributed } from "../lib/blackout-stub-emitters"
import { buildReferralAttributedArgs } from "../lib/blackout-wire-helpers"

/**
 * Subscriber: attribute the order to a creator (if applicable) and emit
 * `creator.commission.earned` webhook. The storefront stamps the visitor's
 * `_fbm_visitor` cookie value into `order.metadata.fbm_visitor_token` at
 * cart-completion time, so we read it from there.
 *
 * This subscriber transitions the new attribution from `pending` -> `held`
 * with a hold window (default 7 days) so refunds can short-circuit payout.
 */
export default async function attributeOrderOnPlacedSubscriber({
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
    const query = container.resolve("query") as any

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "subtotal",
        "total",
        "currency_code",
        "customer_id",
        "metadata",
        "promotions.code",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) {
      return
    }

    const md = (order.metadata || {}) as Record<string, unknown>
    const visitorToken = (md.fbm_visitor_token as string) || null
    const shortCode = (md.fbm_short_code as string) || null
    const promotions = (order.promotions || []) as Array<{ code?: string | null }>
    const appliedPromoCodes = promotions.map((p) => p.code).filter((c): c is string => !!c)

    const subtotalCents = Number(order.subtotal ?? order.total ?? 0)
    if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) {
      return
    }

    const attribution = await attributionService.attributeOrder({
      orderId,
      customerId: order.customer_id ?? null,
      visitorToken: visitorToken ?? null,
      shortCode,
      appliedPromoCodes,
      subtotalCents,
      currencyCode: order.currency_code || "usd",
    })

    if (!attribution) return

    // Transition pending -> held with the configured window
    const holdDays = Number(process.env.CREATOR_ATTRIBUTION_DEFAULT_HOLD_DAYS || 7)
    let attributionAfter = attribution
    if (attribution.commission_status === CommissionStatus.PENDING) {
      attributionAfter = await attributionService.holdAttribution(attribution.id, holdDays)
    }

    // Emit `creator.commission.earned` webhook to both sides if subscribed
    if (webhooksService) {
      const payload = {
        attribution_id: attributionAfter.id,
        order_id: orderId,
        creator_seller_id: attributionAfter.creator_seller_id,
        vendor_id: attributionAfter.vendor_id,
        program_id: attributionAfter.program_id,
        deal_id: attributionAfter.deal_id,
        source: attributionAfter.source,
        commission_amount_cents: Number(attributionAfter.commission_amount_cents),
        commission_basis_cents: Number(attributionAfter.commission_basis_cents),
        currency_code: attributionAfter.currency_code,
        commission_status: attributionAfter.commission_status,
        hold_until: attributionAfter.hold_until,
      }
      try {
        await webhooksService.dispatch(
          "creator.commission.earned",
          attributionAfter.creator_seller_id,
          payload
        )
        if (attributionAfter.vendor_id) {
          await webhooksService.dispatch(
            "creator.commission.earned",
            attributionAfter.vendor_id,
            payload
          )
        }
      } catch (err) {
        log.error("[attribute-order-on-placed] webhook dispatch failed", err)
      }
    }

    // §3 Blackout `referral.attributed` — notify the referrer's Blackout
    // identity that their link earned a commission. Requires a resolvable
    // Blackout user id for the creator; SKIP rather than leak a non-Blackout
    // identifier. Fire-and-forget (emit swallows its own errors).
    try {
      const referrerBlackoutUserId = await resolveSellerBlackoutUserId(
        container,
        attributionAfter.creator_seller_id
      )
      if (referrerBlackoutUserId) {
        await emitReferralAttributed(
          container,
          buildReferralAttributedArgs({
            userId: referrerBlackoutUserId,
            orderId,
            attribution: attributionAfter,
          })
        )
      }
    } catch (err) {
      log.error("[attribute-order-on-placed] referral.attributed emit failed", err)
    }
  } catch (err) {
    // Never fail the order placement because attribution failed.
    log.error(`[attribute-order-on-placed] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
