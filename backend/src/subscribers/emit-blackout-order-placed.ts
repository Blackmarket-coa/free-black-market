import { createLogger } from "../shared/logger";
const log = createLogger("subscribers/emit-blackout-order-placed");
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa";
import { emitBlackoutEvent } from "../lib/blackout-emit";
import {
  orderSellerId,
  resolveBlackoutUserId,
  resolveSellerMxid,
} from "../lib/blackout-identity";
import {
  isBlackoutPurchaseLine,
  mapEntitlementKindToBlackout,
  BLACKOUT_DEAD_DROP_KINDS,
  BLACKOUT_PURCHASE_KINDS,
  type BlackoutPurchaseKind,
} from "../modules/marketplace-webhooks/models/blackout-events";
import { MARKETPLACE_LISTING_MODULE } from "../modules/marketplace-listing";

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
]);

function buildMetadataEcho(
  orderMetadata: Record<string, unknown>,
): Record<string, string> {
  const echo: Record<string, string> = {};
  for (const [key, value] of Object.entries(orderMetadata)) {
    if (ECHO_EXCLUDED_KEYS.has(key)) continue;
    if (typeof value !== "string" || !value || value.length > 500) continue;
    echo[key] = value;
    if (Object.keys(echo).length >= 20) break;
  }
  return echo;
}

/**
 * Emit Blackout events on order placement:
 *  - §2 `purchase.succeeded` per Blackout purchase line (drives entitlement
 *    grants + the digital dead-drop): a line naming an entitlement kind or a
 *    Blackout catalog listing (`isBlackoutPurchaseLine`). Ordinary
 *    marketplace lines are not purchases Blackout grants anything for.
 *  - §3 `order.created` once per order, routed to the vendor's orders room:
 *    the order's seller through Mercur's link (`seller.id`). An order with no
 *    seller link sends no `order.created`; there is no room to route it to.
 *
 * Identity: `userId` is the BUYER's Blackout user id captured at account-link
 * time, from the customer or the order's legacy link, never the seller's (see
 * below). If it cannot be resolved we SKIP rather than leak a non-Blackout
 * identifier. Idempotent via stable eventIds.
 *
 * This subscriber's order read threw on every order until SD-52, so neither
 * event had ever been enqueued before that fix.
 */
export default async function emitBlackoutOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id;

  try {
    const query = container.resolve("query") as any;
    // `items.*`, never `items.quantity` (SD-52): Medusa 2.14.2 rewrites
    // `items.quantity` to `items.item.quantity`, a property OrderLineItem does
    // not have, so this read threw for every order and neither event below
    // was ever enqueued. `items.*` returns id, title, quantity, unit_price,
    // product_id, variant_id, variant_sku and metadata.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "customer_id",
        "currency_code",
        "total",
        "metadata",
        // Mercur's seller link. Not `seller_id`: Order has no such property
        // and a read naming it silently returns nothing for it.
        "seller.id",
        "items.*",
      ],
      filters: { id: orderId },
    });

    const order = orders?.[0];
    if (!order) return;

    const metadata = (order.metadata || {}) as Record<string, unknown>;
    // The buyer's id only. resolveBlackoutUserId falls back to a SELLER's
    // Blackout id when handed one; on a purchase that would grant the
    // vendor's own Blackout account what the buyer paid for. That fallback
    // never fired here while the read named the nonexistent `seller_id`, and
    // now that the seller does resolve it must stay off.
    const userId = await resolveBlackoutUserId(container, {
      customerId: order.customer_id ?? null,
      sellerId: null,
      orderMetadata: metadata,
    });

    const sellerId = orderSellerId(order);
    const currency = String(order.currency_code || "USD").toUpperCase();
    const items = (order.items || []) as any[];

    // §2 purchase.succeeded — one per line item. Requires a Blackout user id.
    if (userId) {
      // W1b: echo the checkout-session metadata back (the Blackout return leg
      // dispatches on metadata.creatorSubscriptionId / canopyPlanCode /
      // tipId), and carry the listing's feature bundle so Blackout's primary
      // features.* channel stays webhook-driven.
      const metadataEcho = buildMetadataEcho(metadata);
      const checkoutListingId =
        typeof metadata.creator_listing_id === "string"
          ? (metadata.creator_listing_id as string)
          : null;
      let checkoutListingFeatureKeys: string[] = [];
      if (checkoutListingId) {
        try {
          const listingService = container.resolve(
            MARKETPLACE_LISTING_MODULE,
          ) as {
            listCreatorListings: (
              f: Record<string, unknown>,
            ) => Promise<Array<{ id: string; feature_keys?: unknown }>>;
          };
          const [listing] = await listingService.listCreatorListings({
            id: checkoutListingId,
          });
          if (Array.isArray(listing?.feature_keys)) {
            checkoutListingFeatureKeys = (
              listing.feature_keys as unknown[]
            ).filter((k): k is string => typeof k === "string" && k.length > 0);
          }
        } catch {
          // catalog module unavailable; the echo alone still round-trips
        }
      }

      for (const it of items) {
        if (!isBlackoutPurchaseLine(it.metadata)) continue;
        const itemKind = (it.metadata?.entitlement_kind ?? null) as
          | string
          | null;
        // Catalog listings stamp §2 purchase kinds directly (subscription_tier,
        // privacy_tool, ...) — pass those through verbatim; only internal
        // EntitlementKind values need the mapping.
        const kind =
          itemKind &&
          (BLACKOUT_PURCHASE_KINDS as readonly string[]).includes(itemKind)
            ? (itemKind as BlackoutPurchaseKind)
            : mapEntitlementKindToBlackout(itemKind);
        const digitalDelivery = BLACKOUT_DEAD_DROP_KINDS.includes(kind);
        const itemListingId =
          (it.metadata?.creator_listing_id as string | undefined) ?? null;
        const providerListingId =
          (it.metadata?.listing_id as string | undefined) ??
          itemListingId ??
          it.product_id ??
          it.variant_id ??
          it.id;
        // Blackout-checkout carts carry exactly one item, stamped with the
        // same creator_listing_id as the order; only that item gets the bundle.
        const featureKeys =
          checkoutListingId &&
          (itemListingId ?? checkoutListingId) === checkoutListingId
            ? checkoutListingFeatureKeys
            : [];

        await emitBlackoutEvent(
          container,
          "purchase.succeeded",
          {
            userId,
            providerListingId,
            sku: it.variant_sku ?? null,
            kind,
            // What this line actually charged, so the settling side can confirm
            // the money that moved is the money it predicted. Medusa v2 prices
            // are major units; Blackout's contract is minor units.
            amountCents: Math.round(
              Number(it.unit_price ?? 0) * 100 * Number(it.quantity ?? 1),
            ),
          },
          {
            eventId: `purchase.succeeded:${orderId}:${it.id}`,
            metadata: {
              ...metadataEcho,
              fbmOrderId: orderId,
              digitalDelivery,
              ...(featureKeys.length > 0 ? { featureKeys } : {}),
            },
          },
        );
      }
    }

    // §3 order.created — one per order, routed to the vendor's orders room.
    // Amounts are minor units, as on purchase.succeeded above: Medusa v2
    // prices and totals are major units (12.5 is $12.50).
    if (!sellerId) {
      log.warn(
        `[emit-blackout-order-placed] order ${orderId} has no seller link; order.created not sent`,
      );
      return;
    }
    const vendorMxid = await resolveSellerMxid(container, sellerId);
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
          priceCents: Math.round(Number(it.unit_price ?? 0) * 100),
        })),
        totalCents: Math.round(Number(order.total ?? 0) * 100),
        currency,
        ...(vendorMxid ? { vendorMxid } : {}),
      },
      { eventId: `order.created:${orderId}` },
    );
  } catch (err) {
    log.error(`[emit-blackout-order-placed] failed for order ${orderId}:`, err);
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
