import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/emit-blackout-order-placed")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import {
  resolveBlackoutUserId,
  resolveSellerMxid,
} from "../lib/blackout-identity"
import {
  mapEntitlementKindToBlackout,
  BLACKOUT_DEAD_DROP_KINDS,
} from "../modules/marketplace-webhooks/models/blackout-events"
import { MARKETPLACE_LISTING_MODULE } from "../modules/marketplace-listing"

/**
 * Order-metadata keys that are FBM-internal identity/infra stamps, excluded
 * from the `purchase.succeeded` metadata echo. Everything else round-trips to
 * Blackout — the return leg matches on `metadata.creatorSubscriptionId` /
 * `canopyPlanCode` / `tipId` supplied at checkout-session creation.
 */
const ECHO_EXCLUDED_KEYS = new Set([
  "fbm_external_customer_id",
  "blackout_user_id",
  "mxid",
  "subscription_id",
  "renewal",
  "order_channel",
])

function buildMetadataEcho(
  orderMetadata: Record<string, unknown>
): Record<string, string> {
  const echo: Record<string, string> = {}
  for (const [key, value] of Object.entries(orderMetadata)) {
    if (ECHO_EXCLUDED_KEYS.has(key)) continue
    if (typeof value !== "string" || !value || value.length > 500) continue
    echo[key] = value
    if (Object.keys(echo).length >= 20) break
  }
  return echo
}

/**
 * Emit Blackout events on order placement:
 *  - §2 `purchase.succeeded` per line item (drives entitlement grants + the
 *    digital dead-drop), and
 *  - §3 `order.created` once per order (routed to the vendor's orders room).
 *
 * Identity: `userId` is the Blackout user id captured at account-link time
 * (resolveBlackoutUserId). If it cannot be resolved we SKIP rather than leak a
 * non-Blackout identifier. Idempotent via stable eventIds.
 */
export default async function emitBlackoutOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id

  try {
    const query = container.resolve("query") as any
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "customer_id",
        "currency_code",
        "total",
        "metadata",
        "seller_id",
        "items.id",
        "items.title",
        "items.quantity",
        "items.unit_price",
        "items.product_id",
        "items.variant_id",
        "items.variant_sku",
        "items.metadata",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) return

    const metadata = (order.metadata || {}) as Record<string, unknown>
    const userId = await resolveBlackoutUserId(container, {
      customerId: order.customer_id ?? null,
      sellerId: (order as any).seller_id ?? null,
      orderMetadata: metadata,
    })

    const sellerId = (order as any).seller_id || "default-seller"
    const vendorMxid = await resolveSellerMxid(container, sellerId)
    const currency = String(order.currency_code || "USD").toUpperCase()
    const items = (order.items || []) as any[]

    // §2 purchase.succeeded — one per line item. Requires a Blackout user id.
    if (userId) {
      // W1b: echo the checkout-session metadata back (the Blackout return leg
      // dispatches on metadata.creatorSubscriptionId / canopyPlanCode /
      // tipId), and carry the listing's feature bundle so Blackout's primary
      // features.* channel stays webhook-driven.
      const metadataEcho = buildMetadataEcho(metadata)
      const checkoutListingId =
        typeof metadata.creator_listing_id === "string"
          ? (metadata.creator_listing_id as string)
          : null
      let checkoutListingFeatureKeys: string[] = []
      if (checkoutListingId) {
        try {
          const listingService = container.resolve(
            MARKETPLACE_LISTING_MODULE
          ) as {
            listCreatorListings: (
              f: Record<string, unknown>
            ) => Promise<Array<{ id: string; feature_keys?: unknown }>>
          }
          const [listing] = await listingService.listCreatorListings({
            id: checkoutListingId,
          })
          if (Array.isArray(listing?.feature_keys)) {
            checkoutListingFeatureKeys = (listing.feature_keys as unknown[]).filter(
              (k): k is string => typeof k === "string" && k.length > 0
            )
          }
        } catch {
          // catalog module unavailable; the echo alone still round-trips
        }
      }

      for (const it of items) {
        const itemKind = (it.metadata?.entitlement_kind ?? null) as string | null
        const kind = mapEntitlementKindToBlackout(itemKind)
        const digitalDelivery = BLACKOUT_DEAD_DROP_KINDS.includes(kind)
        const itemListingId =
          (it.metadata?.creator_listing_id as string | undefined) ?? null
        const providerListingId =
          (it.metadata?.listing_id as string | undefined) ??
          itemListingId ??
          it.product_id ??
          it.variant_id ??
          it.id
        // Blackout-checkout carts carry exactly one item, stamped with the
        // same creator_listing_id as the order; only that item gets the bundle.
        const featureKeys =
          checkoutListingId && (itemListingId ?? checkoutListingId) === checkoutListingId
            ? checkoutListingFeatureKeys
            : []

        await emitBlackoutEvent(
          container,
          "purchase.succeeded",
          {
            userId,
            providerListingId,
            sku: it.variant_sku ?? null,
            kind,
          },
          {
            eventId: `purchase.succeeded:${orderId}:${it.id}`,
            metadata: {
              ...metadataEcho,
              fbmOrderId: orderId,
              digitalDelivery,
              ...(featureKeys.length > 0 ? { featureKeys } : {}),
            },
          }
        )
      }
    }

    // §3 order.created — one per order, routed to the vendor's orders room.
    await emitBlackoutEvent(
      container,
      "order.created",
      {
        vendorId: sellerId,
        ...(userId ? { userId } : {}),
        orderId,
        items: items.map((it) => ({
          sku: it.variant_sku ?? null,
          title: it.title ?? "",
          qty: Number(it.quantity ?? 0),
          priceCents: Math.round(Number(it.unit_price ?? 0)),
        })),
        totalCents: Math.round(Number(order.total ?? 0)),
        currency,
        ...(vendorMxid ? { vendorMxid } : {}),
      },
      { eventId: `order.created:${orderId}` }
    )
  } catch (err) {
    log.error(`[emit-blackout-order-placed] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
