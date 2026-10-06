import { randomBytes } from "crypto"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { createLogger } from "../../../../../../../../../shared/logger"
import { forbidden } from "../../../../../../../../../shared/community-read-access"
import { isBlackoutIntegrationEnabled } from "../../../../../../../../../lib/blackout-oauth"
import {
  actionFromOwnPage,
  csrfNonceFor,
  csrfNonceMatches,
  isJsonRequest,
  isLiveManageSession,
  ownedByManageSession,
  sha256Hex,
  type ManageSessionRow,
} from "../../../../../../../../../lib/blackout-manage-session"
import {
  manageMayCancel,
  manageRowView,
  renderManageExpired,
  renderManagePage,
  renderManageUnavailable,
  renewalPrice,
  type ManageRow,
  type RowInfo,
} from "../../../../../../../../../lib/blackout-manage-page"
import {
  APPROVAL_ANSWER_MESSAGE,
  approvalAnswered,
  dispatchSubscriptionAction,
  subscriptionActionErrorResponse,
} from "../../../../../../../../../lib/subscription-manage"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../../../../../../modules/marketplace-listing/service"
import { SUBSCRIPTION_MODULE } from "../../../../../../../../../modules/subscription"
import type SubscriptionModuleService from "../../../../../../../../../modules/subscription/service"
import type { RenewalCartData } from "../../../../../../../../../workflows/subscription/renew-helpers"
import { consumerSubscriptionsEnabled } from "../../../../../../../../../workflows/subscription/grace-lifecycle"

const log = createLogger(
  "api/v1/integrations/blackout/commerce/subscriptions/manage-sessions/[token]/page"
)

/**
 * The FBM-hosted subscription manage page for a Blackout member
 * (docs/contracts/blackout-integration.md, "Blackout subscription
 * self-service").
 *
 * GET renders the bound customer's subscriptions; POST (JSON, from the page's
 * own script only) performs disable_auto_renew / approve_auto_renew / cancel
 * through the same dispatcher as POST /store/subscriptions/:id. Opened by
 * Blackout in a new tab, never embedded: frame-ancestors 'none'.
 *
 * Both FBM_BLACKOUT_INTEGRATION and FF_CONSUMER_SUBSCRIPTIONS_V1 gate the
 * page and every action, so a link minted before a flag went off renders
 * "unavailable" and can change nothing.
 */

const flagsOn = () => isBlackoutIntegrationEnabled() && consumerSubscriptionsEnabled()

/** No framing, no caching, no Referer (the token is in the path). */
function applyManageHeaders(res: MedusaResponse, scriptNonce?: string) {
  const script = scriptNonce ? `'nonce-${scriptNonce}'` : "'none'"
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src ${script}; style-src 'unsafe-inline'; connect-src 'self'; ` +
      `img-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`
  )
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("X-Content-Type-Options", "nosniff")
}

async function loadLiveSession(req: MedusaRequest): Promise<ManageSessionRow | null> {
  const token = String(req.params.token || "")
  if (!token || token.length > 128) return null
  const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)
  const [row] = await service.listBlackoutManageSessions({ token_hash: sha256Hex(token) }, { take: 1 })
  if (!row) return null
  const session = row as unknown as ManageSessionRow
  return isLiveManageSession(session) ? session : null
}

type ListingRow = { id: string; title?: string | null }

type GraphQuery = {
  graph: (q: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

type RenewalSource = { id: string; quantity?: number | null; cart?: RenewalCartData | null }

/**
 * Per row: the listing title, and the price a renewal of THAT row would
 * charge — read from its template cart (`renewalPrice`), never from the
 * listing's current price, which the re-approval disclosure would otherwise
 * misstate for a row bought at a custom amount or before a price change.
 * A failed lookup leaves the price unknown, which hides re-approval.
 */
async function rowInfo(req: MedusaRequest, subs: ManageRow[]): Promise<Map<string, RowInfo>> {
  const listingIds = [
    ...new Set(
      subs
        .map((s) => s.metadata?.creator_listing_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ]
  const titles = new Map<string, string>()
  if (listingIds.length) {
    const service = req.scope.resolve<MarketplaceListingService>(MARKETPLACE_LISTING_MODULE)
    const listings = (await service.listCreatorListings({ id: listingIds })) as unknown as ListingRow[]
    for (const l of listings) titles.set(l.id, l.title || "Subscription")
  }

  const prices = new Map<string, string | null>()
  if (subs.length) {
    try {
      const query = req.scope.resolve<GraphQuery>(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "subscription",
        fields: [
          "id",
          "quantity",
          "cart.currency_code",
          "cart.items.variant_id",
          "cart.items.quantity",
          "cart.items.unit_price",
        ],
        filters: { id: subs.map((s) => s.id) },
      })
      for (const row of (data ?? []) as RenewalSource[]) prices.set(row.id, renewalPrice(row))
    } catch (error) {
      log.warn(`Renewal price lookup failed: ${(error as Error)?.message ?? error}`)
    }
  }

  const out = new Map<string, RowInfo>()
  for (const s of subs) {
    const listingId = s.metadata?.creator_listing_id
    const title = typeof listingId === "string" ? titles.get(listingId) : undefined
    out.set(s.id, { title: title ?? "Subscription", price: prices.get(s.id) ?? null })
  }
  return out
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const scriptNonce = randomBytes(16).toString("base64url")
  applyManageHeaders(res, scriptNonce)
  if (!flagsOn()) {
    res.status(404).type("text/html").send(renderManageUnavailable())
    return
  }

  const session = await loadLiveSession(req)
  if (!session) {
    res.status(401).type("text/html").send(renderManageExpired())
    return
  }

  let owned: ManageRow[] = []
  if (session.customer_id) {
    const subscriptions = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
    const rows = (await subscriptions.listSubscriptions(
      { customer_id: session.customer_id },
      { order: { created_at: "DESC" } }
    )) as unknown as ManageRow[]
    owned = rows.filter((row) => ownedByManageSession(row, session))
  }

  const info = await rowInfo(req, owned)
  const now = new Date()
  const views = owned.map((row) =>
    manageRowView(row, info.get(row.id) ?? { title: "Subscription", price: null }, now)
  )

  res
    .status(200)
    .type("text/html")
    .send(
      renderManagePage({
        rows: views,
        csrf: csrfNonceFor(String(req.params.token)),
        scriptNonce,
        returnUrl: session.return_url,
      })
    )
}

const ActionSchema = z
  .object({
    action: z.enum(["disable_auto_renew", "approve_auto_renew", "cancel"]),
    subscription_id: z.string().min(1).max(120),
    csrf: z.string().min(1).max(128),
    auto_renew_approved: z.literal(true).optional(),
    auto_renew_disclosure_version: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine(approvalAnswered, { error: APPROVAL_ANSWER_MESSAGE, path: ["auto_renew_approved"] })

const CSRF_REFUSAL = { code: "csrf_rejected", message: "This request did not come from the manage page." }

/**
 * POST — one action. Checked in this order, each refusal writing nothing:
 *   1. flags (404 feature_disabled);
 *   2. same-origin + JSON (403 csrf_rejected);
 *   3. a live session (401 session_expired);
 *   4. the session's CSRF nonce (403 csrf_rejected);
 *   5. the body (400, as the store route);
 *   6. ownership of the subscription (forbidden() 403 — missing and not
 *      owned are the same answer);
 *   7. the page's own offer: cancel only from a status the page offers it
 *      for (409 subscription_transition_not_allowed), and approve_auto_renew
 *      only for a row the page renders the re-approval disclosure for —
 *      never a legacy fixed-horizon row, never one whose renewal price is
 *      unknown (409 auto_renew_not_available) — so an approval is never
 *      recorded against text that was not shown for that row;
 *   8. then the shared dispatcher, whose refusals are the store route's
 *      (409 subscription_transition_not_allowed / 409 auto_renew_*).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  applyManageHeaders(res)
  if (!flagsOn()) {
    res.status(404).json({ code: "feature_disabled", message: "Subscription management is not available" })
    return
  }
  const headers = req.headers as Record<string, string | string[] | undefined>
  if (!actionFromOwnPage(headers) || !isJsonRequest(headers)) {
    res.status(403).json(CSRF_REFUSAL)
    return
  }

  const session = await loadLiveSession(req)
  if (!session) {
    res.status(401).json({ code: "session_expired", message: "This link has expired." })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  if (!csrfNonceMatches(session.csrf_nonce_hash, body.csrf)) {
    res.status(403).json(CSRF_REFUSAL)
    return
  }

  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: parsed.error.issues })
    return
  }
  const data = parsed.data

  const subscriptions = req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE)
  const [existing] = (await subscriptions.listSubscriptions(
    { id: data.subscription_id },
    { take: 1 }
  )) as unknown as ManageRow[]
  if (!existing || !ownedByManageSession(existing, session)) {
    forbidden(res)
    return
  }

  // cancelSubscriptions has no status guard of its own; a cancel of a row the
  // page would not offer it for (already ended) is refused with the store
  // route's transition code rather than re-stamped.
  if (data.action === "cancel" && !manageMayCancel(existing.status)) {
    res.status(409).json({
      message: `Cannot cancel subscription ${existing.id}: status is "${existing.status}".`,
      type: "subscription_transition_not_allowed",
    })
    return
  }

  if (data.action === "approve_auto_renew") {
    const info = await rowInfo(req, [existing])
    const view = manageRowView(existing, info.get(existing.id) ?? { title: "Subscription", price: null })
    if (!view.approve) {
      res.status(409).json({
        message: `Automatic renewal cannot be turned on for subscription ${existing.id} here.`,
        type: "auto_renew_not_available",
      })
      return
    }
  }

  try {
    const result = await dispatchSubscriptionAction(req.scope, existing, {
      action: data.action,
      auto_renew_disclosure_version: data.auto_renew_disclosure_version,
    })
    res.status(200).json({ action: result.action, success: result.success })
  } catch (error) {
    const refusal = subscriptionActionErrorResponse(error)
    if (refusal) {
      res.status(refusal.status).json(refusal.body)
      return
    }
    log.error("Manage session action failed:", error)
    res.status(500).json({ code: "server_error", message: "That change could not be made." })
  }
}
