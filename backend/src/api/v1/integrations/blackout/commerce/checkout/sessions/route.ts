import { createLogger } from "../../../../../../../shared/logger"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import jwt from "jsonwebtoken"
import { requireCommerceApiKey } from "../../../../../../../lib/blackout-commerce-auth"
import { config } from "../../../../../../../shared/config"
import {
  MARKETPLACE_LISTING_MODULE,
} from "../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../modules/marketplace-listing/service"
import { CreatorListingStatus } from "../../../../../../../modules/marketplace-listing/models"
import {
  CHECKOUT_METADATA_MAX_KEYS,
  sanitizeCheckoutMetadata,
} from "../../../../../../../lib/blackout-checkout"

const log = createLogger("api/v1/integrations/blackout/commerce/checkout/sessions")

const httpsUrl = z.string().url().refine((u) => /^https:\/\//.test(u), {
  message: "url must use https://",
})

const BodySchema = z
  .object({
    userId: z.string().min(1).max(256),
    listingId: z.string().min(1).max(120),
    sku: z.string().min(1).max(120).optional(),
    returnUrl: httpsUrl.optional(),
    embed: z.boolean().optional(),
    embedOrigin: httpsUrl.optional(),
    mxid: z.string().min(1).max(256).optional(),
    metadata: z
      .record(z.string(), z.string().max(500))
      .refine((m) => Object.keys(m).length <= CHECKOUT_METADATA_MAX_KEYS, {
        message: `metadata may carry at most ${CHECKOUT_METADATA_MAX_KEYS} keys`,
      })
      .optional(),
  })
  .strict()

const SESSION_TTL_SECONDS = 30 * 60

type SessionRecord = {
  id: string
  status: string
}

/**
 * §5 POST /v1/checkout/sessions[?embed=1] (idempotency-key header)
 * body { userId, listingId, sku?, returnUrl?, embed?, embedOrigin?, mxid?,
 *        metadata? } -> { url, id }
 *
 * W1b: sessions are now stateful. The row keyed
 * (userId, listingId, idempotency-key) is the idempotency anchor — a retried
 * POST returns the SAME session (and therefore the same cart/order once the
 * page materializes them) instead of a decorative id over a fresh purchase.
 * `metadata` is a bounded echo copied onto the order so Blackout's webhook
 * return leg (`metadata.creatorSubscriptionId` / `canopyPlanCode` / `tipId`)
 * round-trips.
 *
 * The listing must be PUBLISHED and priced; failing that here (not at page
 * render) means Blackout never redirects a member to a dead checkout.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid checkout session payload",
      details: parsed.error.flatten(),
    })
  }

  const secret = config.JWT_SECRET
  if (!secret) {
    return res.status(500).json({ code: "server_error", message: "JWT_SECRET is not configured" })
  }

  const listingService = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )

  const [listing] = await listingService.listCreatorListings({
    id: parsed.data.listingId,
  })
  if (!listing) {
    return res.status(404).json({ code: "listing_not_found", message: "Listing not found" })
  }
  if (
    listing.status !== CreatorListingStatus.PUBLISHED ||
    typeof listing.price_cents !== "number" ||
    listing.price_cents < 1 ||
    !listing.currency
  ) {
    return res.status(409).json({
      code: "listing_not_purchasable",
      message: "Listing is not published with a positive price",
    })
  }

  const embed = parsed.data.embed === true || req.query.embed === "1"
  const idempotencyKeyHeader = req.headers["idempotency-key"]
  const idempotencyKeyRaw = Array.isArray(idempotencyKeyHeader)
    ? idempotencyKeyHeader[0]
    : idempotencyKeyHeader
  const idempotencyKey =
    typeof idempotencyKeyRaw === "string" && idempotencyKeyRaw.length > 0
      ? idempotencyKeyRaw.slice(0, 200)
      : null

  const findExisting = async (): Promise<SessionRecord | null> => {
    if (!idempotencyKey) return null
    const [existing] = await listingService.listBlackoutCheckoutSessions({
      blackout_user_id: parsed.data.userId,
      listing_id: parsed.data.listingId,
      idempotency_key: idempotencyKey,
    })
    return (existing as SessionRecord | undefined) ?? null
  }

  // `sku` rides the metadata echo so the order (and the webhook return leg)
  // records which sku the member picked.
  const echo = sanitizeCheckoutMetadata({
    ...(parsed.data.metadata ?? {}),
    ...(parsed.data.sku ? { sku: parsed.data.sku } : {}),
  })

  let record = await findExisting()
  if (!record) {
    try {
      const created = await listingService.createBlackoutCheckoutSessions({
        blackout_user_id: parsed.data.userId,
        listing_id: parsed.data.listingId,
        idempotency_key: idempotencyKey,
        mxid: parsed.data.mxid ?? null,
        embed,
        embed_origin: parsed.data.embedOrigin ?? null,
        return_url: parsed.data.returnUrl ?? null,
        requested_metadata: echo,
      })
      record = (Array.isArray(created) ? created[0] : created) as SessionRecord
    } catch (error) {
      // Unique-index race on the idempotency key: the concurrent POST won —
      // reuse its session.
      record = await findExisting()
      if (!record) {
        log.error("Failed to create Blackout checkout session:", error)
        return res
          .status(500)
          .json({ code: "server_error", message: "Could not create checkout session" })
      }
    }
  }

  const token = jwt.sign({ sid: record.id }, secret, {
    expiresIn: SESSION_TTL_SECONDS,
    audience: "fbm-blackout-checkout",
  })

  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https"
  const host = req.headers["x-forwarded-host"] || req.headers.host
  const baseUrl = (
    process.env.FREEBLACKMARKET_BASE_URL ||
    process.env.BACKEND_URL ||
    `${protocol}://${host}`
  ).replace(/\/$/, "")

  const url = `${baseUrl}/v1/integrations/blackout/commerce/checkout/sessions/${encodeURIComponent(
    token
  )}/page${embed ? "?embed=1" : ""}`

  return res.status(201).json({ id: record.id, url })
}
