import { createLogger } from "../../../../shared/logger";
const log = createLogger("api/store/vendors/handle");
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { BOOKING_MODULE } from "../../../../modules/booking";
import type BookingService from "../../../../modules/booking/service";
import { REVIEWS_MODULE } from "../../../../modules/reviews";
import type ReviewsService from "../../../../modules/reviews/service";
import { resolveEmbedFeatures } from "../../../../shared/website-config";

/**
 * GET /store/vendors/:handle  —  FBM Store API (public, website-agnostic)
 * ----------------------------------------------------------------------
 * The clean public contract any website can read to render a vendor's
 * storefront. No auth, no publishable key required — this is the single
 * endpoint the FBM Connect SDK (connect.js) and the launched site template
 * are built on.
 *
 * Query params (all optional):
 *   include          csv of "vendor,products,events"   (default: all)
 *   limit_products   max products to return             (default: 24, max 100)
 *   limit_events     max events to return               (default: 12, max 50)
 *   currency_code    preferred price currency           (default: "usd")
 *
 * Response shape (stable):
 *   {
 *     vendor:   { id, handle, name, description, photo, vendor_type, verified,
 *                 rating, review_count, website_url, social_links, url } | null,
 *     products: [{ id, title, handle, subtitle, description, thumbnail,
 *                  price: { amount, currency_code } | null, variants[], url }],
 *     events:   [{ id, title, handle, thumbnail, dates, venue,
 *                  price: { amount, currency_code } | null, url }],
 *     _meta:    { handle, currency_code, storefront_url, checkout_url,
 *                 generated_at }
 *   }
 */

type Price = { amount: number; currency_code: string } | null;

const DEFAULT_REGION = (
  process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"
).toLowerCase();

function storefrontBase(): string {
  // Backend may be reached at api.* while the storefront lives at the apex.
  const explicit =
    process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return "https://freeblackmarket.com";
}

/** Cheapest price across a product's variants for the requested currency. */
function cheapestPrice(variants: any[], currency: string): Price {
  const wanted = currency.toLowerCase();
  let best: { amount: number; currency_code: string } | null = null;
  for (const v of variants || []) {
    const prices: any[] = v?.prices || [];
    // Prefer an exact currency match, else fall back to the first price.
    const match =
      prices.find((p) => String(p?.currency_code).toLowerCase() === wanted) ||
      prices[0];
    if (match && typeof match.amount === "number") {
      if (!best || match.amount < best.amount) {
        best = { amount: match.amount, currency_code: match.currency_code };
      }
    }
  }
  return best;
}

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = parseInt(String(value ?? ""), 10);
  if (isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve("query");
  const handle = req.params.handle;

  const include = String(req.query.include || "vendor,products,events")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const wantVendor = include.includes("vendor");
  const wantProducts = include.includes("products");
  const wantEvents = include.includes("events");

  const currency_code = String(req.query.currency_code || "usd").toLowerCase();
  const limitProducts = clampInt(req.query.limit_products, 24, 100);
  const limitEvents = clampInt(req.query.limit_events, 12, 50);

  const storefront = storefrontBase();
  const productUrl = (h: string) =>
    `${storefront}/${DEFAULT_REGION}/products/${h}`;

  try {
    // 1) Resolve the seller by its unique handle (slug).
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: [
        "id",
        "name",
        "handle",
        "description",
        "photo",
        "email",
        "created_at",
      ],
      filters: { handle } as any,
    });
    const seller = sellers?.[0];

    if (!seller) {
      return res.status(404).json({
        message: `No vendor found for handle "${handle}"`,
        type: "not_found",
      });
    }

    // 2) Seller metadata (vendor type, trust signals, public links).
    let meta: any = null;
    try {
      const { data: metaRows } = await query.graph({
        entity: "seller_metadata",
        fields: [
          "vendor_type",
          "verified",
          "featured",
          "rating",
          "review_count",
          "website_url",
          "social_links",
          "mxid",
          "blackout_user_id",
          "embed_features",
        ],
        filters: { seller_id: seller.id },
      });
      meta = metaRows?.[0] || null;
    } catch (err) {
      log.warn(`seller_metadata lookup failed for ${seller.id}`, err);
    }

    // Vendor-controlled embed toggles. Null/missing ⇒ all surfaces on, so
    // existing embeds are unchanged. These gate the public response below in
    // addition to the data-presence checks, so a turned-off surface never
    // leaves the server even if a host page still has the markup.
    const features = resolveEmbedFeatures(meta?.embed_features);

    // Chat is offered when the vendor has a reachable Blackout/Matrix identity
    // AND the vendor has not turned the chat surface off.
    const chatEnabled =
      Boolean(meta?.mxid || meta?.blackout_user_id) && features.chat;

    // Rating and review count come from the reviews module, not from the
    // `seller_metadata.rating` / `.review_count` columns. Those columns are
    // declared and defaulted to 0 but never written by anything (C3), so this
    // endpoint — the public contract connect.js is built on — published "0
    // reviews" for every vendor no matter how many they had. The aggregate is
    // the same one `/store/vendors/:handle/reviews` already reports, so the two
    // endpoints can no longer disagree.
    let ratingSummary: { average: number | null; count: number } | null = null;
    if (wantVendor && features.vendor) {
      try {
        const reviews = req.scope.resolve(REVIEWS_MODULE) as ReviewsService;
        ratingSummary = await reviews.getSellerAggregate(seller.id);
      } catch (err) {
        // Reviews are a nice-to-have on this endpoint; a failure here must not
        // take down the whole vendor payload. Fall through to the stale
        // metadata columns rather than 500.
        log.warn(`review aggregate lookup failed for ${seller.id}`, err);
      }
    }

    const vendor = wantVendor && features.vendor
      ? {
          id: seller.id,
          handle: seller.handle,
          name: seller.name,
          description: seller.description ?? null,
          photo: seller.photo ?? null,
          vendor_type: meta?.vendor_type ?? null,
          verified: !!meta?.verified,
          featured: !!meta?.featured,
          rating: ratingSummary ? ratingSummary.average : meta?.rating ?? null,
          review_count: ratingSummary
            ? ratingSummary.count
            : Number(meta?.review_count ?? 0),
          website_url: meta?.website_url ?? null,
          social_links: meta?.social_links ?? null,
          url: `${storefront}/${DEFAULT_REGION}/sellers/${seller.handle}`,
          created_at: seller.created_at,
        }
      : undefined;

    // 3) Published products for this seller (with variant prices).
    // Fetch when the caller asked for products AND at least one product-backed
    // surface (flat grid, digital, or services) is enabled — digital/services
    // are derived from the same query.
    const fetchProducts =
      wantProducts &&
      (features.products || features.digital || features.services);
    let products: any[] = [];
    if (fetchProducts) {
      try {
        const { data: rows } = await query.graph({
          entity: "product",
          fields: [
            "id",
            "title",
            "subtitle",
            "handle",
            "thumbnail",
            "description",
            "status",
            "variants.id",
            "variants.title",
            "variants.prices.amount",
            "variants.prices.currency_code",
          ],
          filters: {
            // The "seller.id" join key is resolved at runtime; the typed
            // RemoteQueryFilters<"product"> doesn't model it.
            "seller.id": seller.id,
            status: "published",
          } as any,
          pagination: { take: limitProducts },
        });
        products = (rows || []).map((p: any) => ({
          id: p.id,
          title: p.title,
          subtitle: p.subtitle ?? null,
          handle: p.handle,
          description: p.description ?? null,
          thumbnail: p.thumbnail ?? null,
          price: cheapestPrice(p.variants, currency_code),
          variants: (p.variants || []).map((v: any) => ({
            id: v.id,
            title: v.title,
            price: cheapestPrice([v], currency_code),
          })),
          url: productUrl(p.handle),
          // Classified below; defaults to "physical" when no listing-type link.
          type: "physical" as string,
        }));

        // Classify products by their linked listing-type so connect.js can
        // render dedicated digital/services grids. Done as a separate, isolated
        // query so a missing link or schema change can never break the catalog.
        try {
          const { data: typeRows } = await query.graph({
            entity: "product",
            fields: ["id", "listing_type.catalog_id"],
            filters: {
              "seller.id": seller.id,
              status: "published",
            } as any,
            pagination: { take: limitProducts },
          });
          const catalogById = new Map<string, string>();
          for (const r of typeRows || []) {
            const cid = (r as any)?.listing_type?.catalog_id;
            if (cid) catalogById.set((r as any).id, String(cid));
          }
          for (const p of products) {
            const cid = catalogById.get(p.id);
            if (cid === "digital") p.type = "digital";
            else if (cid === "bookable") p.type = "service";
            else if (cid === "event") p.type = "event";
            else if (cid === "physical_product") p.type = "physical";
            else if (cid) p.type = cid;
          }
        } catch (err) {
          log.warn(`listing-type classification failed for ${seller.id}`, err);
        }
      } catch (err) {
        log.warn(`product lookup failed for ${seller.id}`, err);
      }
    }

    // Attach booking config to bookable products so the embed can render a
    // booking widget without a second round-trip. Isolated + best-effort.
    if (products.length) {
      try {
        const bookingService = req.scope.resolve(
          BOOKING_MODULE
        ) as BookingService;
        const configs = await bookingService.listProductBookingConfigs({
          seller_id: seller.id,
          is_active: true,
        });
        const configByProduct = new Map<string, any>();
        for (const c of configs || []) configByProduct.set(c.product_id, c);
        for (const p of products) {
          const c = configByProduct.get(p.id);
          if (c) {
            p.type = "service";
            (p as any).booking_config = {
              duration_minutes: c.duration_minutes,
              buffer_minutes: c.buffer_minutes,
              timezone: c.timezone,
              advance_days: c.advance_days,
              min_notice_hours: c.min_notice_hours,
            };
          }
        }
      } catch (err) {
        log.warn(`booking config lookup failed for ${seller.id}`, err);
      }
    }

    // Grouped views for the specialized connect.js components. The flat
    // `products` array above stays the back-compat contract; these are additive.
    const productGroups = {
      digital: features.digital
        ? products.filter((p) => p.type === "digital")
        : [],
      services: features.services
        ? products.filter((p) => p.type === "service")
        : [],
      physical: features.products
        ? products.filter((p) => p.type === "physical")
        : [],
    };

    // 4) Events (ticket products) for this seller — best effort. Skipped when
    // the vendor has turned the events surface off.
    const fetchEvents = wantEvents && features.events;
    let events: any[] = [];
    if (fetchEvents) {
      try {
        const { data: ticketRows } = await query.graph({
          entity: "ticket_product",
          fields: ["id", "product_id", "dates", "venue.name", "venue.address"],
          filters: { seller_id: seller.id } as any,
          pagination: { take: limitEvents },
        });

        const ticketProducts = ticketRows || [];
        const productIds = ticketProducts
          .map((t: any) => t.product_id)
          .filter(Boolean);

        // Hydrate event titles / images / prices from the linked products.
        const productById = new Map<string, any>();
        if (productIds.length) {
          const { data: eventProducts } = await query.graph({
            entity: "product",
            fields: [
              "id",
              "title",
              "handle",
              "thumbnail",
              "variants.prices.amount",
              "variants.prices.currency_code",
            ],
            filters: { id: productIds } as any,
          });
          for (const ep of eventProducts || []) {
            productById.set(ep.id, ep);
          }
        }

        events = ticketProducts.map((t: any) => {
          const p = productById.get(t.product_id);
          return {
            id: t.id,
            title: p?.title ?? "Event",
            handle: p?.handle ?? null,
            thumbnail: p?.thumbnail ?? null,
            dates: t.dates ?? [],
            venue: t.venue
              ? { name: t.venue.name, address: t.venue.address ?? null }
              : null,
            price: p ? cheapestPrice(p.variants, currency_code) : null,
            url: p?.handle ? productUrl(p.handle) : null,
          };
        });
      } catch (err) {
        // Ticketing is optional; never fail the whole response on its account.
        log.warn(`event lookup failed for ${seller.id}`, err);
        events = [];
      }
    }

    // This is a public, read-only catalog embedded on arbitrary third-party
    // sites — make it cacheable so browsers/CDNs absorb embed traffic instead
    // of hitting the DB on every page load. Short browser TTL, longer shared
    // (CDN) TTL, with stale-while-revalidate for a smooth refresh.
    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    );

    return res.json({
      vendor,
      // The flat list backs the general product grid (`data-fbm="products"`).
      // Emptied when the vendor turns the products surface off; digital and
      // services still arrive via product_groups below.
      products: wantProducts ? (features.products ? products : []) : undefined,
      // Additive grouped view; `events` stays its own top-level array for
      // back-compat. Mirrors it under product_groups.events for symmetry.
      product_groups: wantProducts
        ? { ...productGroups, events: fetchEvents ? events : [] }
        : undefined,
      events: wantEvents ? events : undefined,
      // Capability flags so an embed can decide which widgets to render without
      // a second request. Each is the vendor's toggle AND-ed with data
      // availability, so a disabled surface is always false here.
      capabilities: {
        vendor_enabled: features.vendor,
        products_enabled: features.products,
        digital_enabled: features.digital,
        services_enabled: features.services,
        events_enabled: features.events,
        reviews_enabled: features.reviews,
        chat_enabled: chatEnabled,
        booking_enabled: productGroups.services.length > 0 && features.booking,
      },
      reviews_summary: {
        average: meta?.rating ?? null,
        count: meta?.review_count ?? 0,
      },
      _meta: {
        handle: seller.handle,
        currency_code,
        storefront_url: storefront,
        checkout_url: `${storefront}/${DEFAULT_REGION}/cart`,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    log.error(`Failed to build vendor storefront for "${handle}"`, error);
    return res.status(500).json({
      message: "Failed to load vendor",
      type: "server_error",
    });
  }
}
