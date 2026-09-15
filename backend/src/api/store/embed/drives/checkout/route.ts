import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createLogger } from "../../../../../shared/logger"
import type { EmbedRequest } from "../../../../middlewares/embed-key"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../modules/marketplace-listing/models"

const log = createLogger("api/store/embed/drives/checkout")

const BodySchema = z
  .object({
    coalition_id: z.string().min(1).max(120),
    drive_id: z.string().min(1).max(120),
    listing_id: z.string().min(1).max(120),
    amount_cents: z.number().int().min(100).max(10_000_00),
  })
  .strict()

function apiBase(): string {
  const explicit = process.env.FBM_API_URL || process.env.MEDUSA_BACKEND_URL
  return (explicit || "https://api.freeblackmarket.com").replace(/\/$/, "")
}

/**
 * POST /store/embed/drives/checkout  (publishable key required)
 *
 * Mints a donation checkout for a coalition drive embedded through connect.js.
 *
 * Two things this route deliberately does NOT do:
 *
 *  - It does not trust the embed key for money. A publishable key is public
 *    and an Origin header is spoofable, so the key only gates *access to the
 *    endpoint* (plus its rate limits and metering). The real gate is the
 *    payment step on the hosted checkout page, and every field that decides
 *    where money goes is re-read from the listing here rather than taken from
 *    the caller.
 *  - It does not invent a payment rail. The response points at the same
 *    hosted Blackout checkout session every other embedded purchase uses, so
 *    the flat 3% commission, the ledger legs and the `fbm-checkout`
 *    postMessage protocol are the ones already in production.
 *
 * Body: { coalition_id, drive_id, listing_id, amount_cents }
 * Returns: { checkout_url }
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Any valid embed key may open a drive checkout — a drive belongs to a
  // coalition, not to the vendor whose key embedded it — but a key must be
  // present so the endpoint keeps its rate limits and usage accounting.
  const embedKeyId = (req as EmbedRequest).embed_key_id
  if (!embedKeyId) {
    return res
      .status(401)
      .json({ message: "Missing embed context", type: "unauthorized" })
  }

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid drive checkout payload",
      details: parsed.error.flatten(),
    })
  }

  const listingService = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )
  const [listing] = await listingService.listCreatorListings({
    id: parsed.data.listing_id,
  })
  if (!listing) {
    return res
      .status(404)
      .json({ code: "listing_not_found", message: "Drive listing not found" })
  }
  if (
    listing.status !== CreatorListingStatus.PUBLISHED ||
    typeof listing.price_cents !== "number" ||
    listing.price_cents < 1
  ) {
    return res.status(409).json({
      code: "listing_not_purchasable",
      message: "This drive is not taking contributions right now",
    })
  }

  // The visitor is anonymous on a third-party site, so the session is opened
  // against the storefront checkout for the drive's listing rather than a
  // Blackout member id. Quantity carries the chosen amount: a contribution of
  // N units of the drive's contribution-unit listing.
  const units = Math.max(1, Math.round(parsed.data.amount_cents / listing.price_cents))
  const checkoutUrl =
    `${apiBase()}/v1/integrations/blackout/commerce/checkout/drive` +
    `?listing=${encodeURIComponent(listing.id)}` +
    `&drive=${encodeURIComponent(parsed.data.drive_id)}` +
    `&coalition=${encodeURIComponent(parsed.data.coalition_id)}` +
    `&units=${units}` +
    `&embed=1`

  log.info("drive checkout minted", {
    drive_id: parsed.data.drive_id,
    coalition_id: parsed.data.coalition_id,
    listing_id: listing.id,
    units,
  })

  return res.status(201).json({
    checkout_url: checkoutUrl,
    unit_price_cents: listing.price_cents,
    units,
    amount_cents: units * listing.price_cents,
  })
}
