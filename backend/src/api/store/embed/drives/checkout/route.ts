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

  // The listing must belong to the drive that named it. Without this, any
  // embed key could point any coalition's drive at any published listing and
  // take money in that coalition's name — the coalition_id and drive_id would
  // be decoration over somebody else's checkout.
  const listingMeta = (listing.metadata ?? {}) as Record<string, unknown>
  if (
    listingMeta.coalition_id !== parsed.data.coalition_id ||
    listingMeta.drive_id !== parsed.data.drive_id
  ) {
    return res.status(409).json({
      code: "listing_not_for_drive",
      message: "That listing does not belong to this drive",
    })
  }

  const units = Math.max(1, Math.round(parsed.data.amount_cents / listing.price_cents))

  // Open a real session on the §5 checkout endpoint — the same one every other
  // embedded purchase uses. The previous version hand-built a URL at
  // `/commerce/checkout/drive`, which is not a route: only `checkout/sessions`
  // exists, so every donate click was a 404. The server's own API key never
  // leaves this process; the visitor is anonymous and never sees it.
  const apiKey = process.env.FREEBLACKMARKET_API_KEY
  if (!apiKey) {
    log.warn("drive checkout unavailable: FREEBLACKMARKET_API_KEY not configured", {
      drive_id: parsed.data.drive_id,
    })
    return res.status(503).json({
      code: "checkout_unavailable",
      message: "Drive checkout is not configured",
    })
  }

  let checkoutUrl: string
  try {
    const response = await fetch(`${apiBase()}/v1/integrations/blackout/commerce/checkout/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // An anonymous supporter on a third-party site: the drive, not a member,
        // is the identity the session carries.
        userId: `drive:${parsed.data.drive_id}`,
        listingId: listing.id,
        embed: true,
        metadata: {
          coalitionId: parsed.data.coalition_id,
          campaignId: parsed.data.drive_id,
          units: String(units),
        },
      }),
    })
    if (!response.ok) {
      log.warn("drive checkout session refused", {
        drive_id: parsed.data.drive_id,
        status: response.status,
      })
      return res.status(502).json({
        code: "checkout_failed",
        message: "Could not open a checkout for this drive",
      })
    }
    const session = (await response.json()) as { url?: string }
    if (!session?.url) {
      return res.status(502).json({
        code: "checkout_failed",
        message: "Could not open a checkout for this drive",
      })
    }
    checkoutUrl = session.url
  } catch (error) {
    log.warn("drive checkout session failed", {
      drive_id: parsed.data.drive_id,
      error: error instanceof Error ? error.name : "unknown",
    })
    return res.status(502).json({
      code: "checkout_failed",
      message: "Could not open a checkout for this drive",
    })
  }

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
