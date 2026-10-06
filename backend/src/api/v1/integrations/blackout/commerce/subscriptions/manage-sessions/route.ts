import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createLogger } from "../../../../../../../shared/logger"
import { requireCommerceApiKey } from "../../../../../../../lib/blackout-commerce-auth"
import { isBlackoutIntegrationEnabled } from "../../../../../../../lib/blackout-oauth"
import { resolveCustomerForBlackoutUserReadOnly } from "../../../../../../../lib/blackout-identity"
import {
  MANAGE_SESSIONS_PATH,
  MANAGE_SESSION_TTL_SECONDS,
  acceptedReturnUrl,
  csrfNonceFor,
  newManageToken,
  sha256Hex,
} from "../../../../../../../lib/blackout-manage-session"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../modules/marketplace-listing/service"
import { consumerSubscriptionsEnabled } from "../../../../../../../workflows/subscription/grace-lifecycle"

const log = createLogger("api/v1/integrations/blackout/commerce/subscriptions/manage-sessions")

/**
 * Strict: the caller names the Blackout member and nothing else. No mxid, no
 * customer id, no subscription id — the session binds to whatever FBM
 * customer carries that Blackout id, read-only, or to none.
 */
const BodySchema = z
  .object({
    blackout_user_id: z.string().min(1).max(256),
    return_url: z.string().min(1).max(2048).optional(),
  })
  .strict()

const featureDisabled = (res: MedusaResponse) =>
  res.status(404).json({ code: "feature_disabled", message: "Subscription management is not available" })

/**
 * POST /v1/integrations/blackout/commerce/subscriptions/manage-sessions
 * body { blackout_user_id, return_url? } → 201 { url, expires_at }
 *
 * Server to server: Blackout's API calls it with the same FREEBLACKMARKET_API_KEY
 * bearer as the checkout mint (requireCommerceApiKey), for the member it has
 * authenticated. Refusals:
 *   - 404 feature_disabled — FBM_BLACKOUT_INTEGRATION or FF_CONSUMER_SUBSCRIPTIONS_V1 off;
 *   - 401 — missing or wrong API key;
 *   - 400 — any other body;
 *   - 409 identity_ambiguous — more than one FBM customer carries that
 *     Blackout id (fail closed; an operator fixes the data).
 * No matching customer is still a 201: the page shows "No subscriptions".
 * Nothing here creates a customer.
 *
 * A new mint revokes every earlier session of the same member.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!isBlackoutIntegrationEnabled()) return featureDisabled(res)
  if (!requireCommerceApiKey(req, res)) return
  if (!consumerSubscriptionsEnabled()) return featureDisabled(res)

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid manage session payload",
      details: parsed.error.flatten(),
    })
  }
  const blackoutUserId = parsed.data.blackout_user_id

  let customerId: string | null
  try {
    const resolution = await resolveCustomerForBlackoutUserReadOnly(req.scope, blackoutUserId)
    if (resolution.kind === "ambiguous") {
      log.warn(
        `Manage session refused: more than one customer carries metadata.blackout_user_id=${blackoutUserId}; an operator must resolve the duplicate`
      )
      return res.status(409).json({
        code: "identity_ambiguous",
        message: "More than one account matches this member",
      })
    }
    customerId = resolution.kind === "one" ? resolution.customerId : null
  } catch (error) {
    log.error("Manage session: customer lookup failed:", error)
    return res.status(500).json({ code: "server_error", message: "Could not create manage session" })
  }

  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)

  const token = newManageToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + MANAGE_SESSION_TTL_SECONDS * 1000)
  const row = {
    blackout_user_id: blackoutUserId,
    customer_id: customerId,
    token_hash: sha256Hex(token),
    csrf_nonce_hash: sha256Hex(csrfNonceFor(token)),
    expires_at: expiresAt,
    revoked_at: null,
    return_url: acceptedReturnUrl(parsed.data.return_url),
  }

  const revokeEarlier = async () => {
    const live = await service.listBlackoutManageSessions({
      blackout_user_id: blackoutUserId,
      revoked_at: null,
    })
    if (live.length > 0) {
      await service.updateBlackoutManageSessions({
        selector: { id: live.map((r) => r.id) },
        data: { revoked_at: now },
      })
    }
  }

  // The partial unique index (one unrevoked row per member) turns a concurrent
  // mint into a create error; revoke again and retry once.
  let created = false
  for (let attempt = 0; attempt < 2 && !created; attempt++) {
    try {
      await revokeEarlier()
      await service.createBlackoutManageSessions(row)
      created = true
    } catch (error) {
      if (attempt === 1) {
        log.error("Failed to create Blackout manage session:", error)
      }
    }
  }
  if (!created) {
    return res.status(500).json({ code: "server_error", message: "Could not create manage session" })
  }

  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https"
  const host = req.headers["x-forwarded-host"] || req.headers.host
  const baseUrl = (
    process.env.FREEBLACKMARKET_BASE_URL ||
    process.env.BACKEND_URL ||
    `${protocol}://${host}`
  ).replace(/\/$/, "")

  return res.status(201).json({
    url: `${baseUrl}${MANAGE_SESSIONS_PATH}/${encodeURIComponent(token)}/page`,
    expires_at: expiresAt.toISOString(),
  })
}
