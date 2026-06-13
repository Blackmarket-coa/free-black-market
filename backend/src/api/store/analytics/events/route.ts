import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/analytics/events")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../../modules/creator-attribution/service"

/**
 * Canonical funnel events. The storefront emits these via
 * `emitWebsiteEvent` and POSTs them to this endpoint via
 * `navigator.sendBeacon` (or fetch fallback).
 *
 * Adding an event name? Extend this allowlist and the matching
 * `WebsiteEventName` union in `storefront/src/lib/analytics/events.ts`.
 */
const ALLOWED_EVENT_NAMES = new Set<string>([
  "page_view",
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "checkout_started",
  "purchase",
  "share",
  "click_affiliate",
  "signup",
  "subscribe",
  "creator_profile_view",
  "creator_link_clicked",
  // Pre-existing marketing-page events emitted by emitWebsiteEvent.
  "homepage_vendor_type_selected",
  "feature_matrix_viewed",
  "dashboard_showcase_opened",
  "pricing_breakdown_expanded",
  "why_we_exist_cta_clicked",
  "github_transparency_link_clicked",
  "homepage_search_submitted",
  "homepage_quick_filter_used",
  "homepage_primary_cta_clicked",
  "homepage_secondary_cta_clicked",
  "homepage_first_session_progression",
])

const VISITOR_COOKIE = "_fbm_visitor"
const AFF_COOKIE = "_fbm_aff"

function readCookie(req: MedusaRequest, name: string): string | null {
  const header = req.headers["cookie"]
  if (typeof header !== "string") return null
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return decodeURIComponent(v.join("="))
  }
  return null
}

function strOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0 && v.length < 2048) return v
  return null
}

function deviceTypeFromUA(ua: string | undefined | null): string | null {
  if (!ua) return null
  return /mobile|iphone|android.*mobile/i.test(ua) ? "mobile" : "desktop"
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const eventName = strOrNull(body.event_name) ?? strOrNull(body.event)

  if (!eventName) {
    return res
      .status(400)
      .json({ message: "event_name is required" })
  }
  if (!ALLOWED_EVENT_NAMES.has(eventName)) {
    return res
      .status(400)
      .json({ message: `event_name '${eventName}' is not in the allowlist` })
  }

  const service = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )

  // Visitor + affiliate context can come from the body (server-side
  // emitters) or from cookies (browser ingestion via sendBeacon).
  const visitorToken =
    strOrNull(body.visitor_token) ?? readCookie(req, VISITOR_COOKIE)
  const visitorRaw = visitorToken
    ? visitorToken.includes(".")
      ? visitorToken.slice(0, visitorToken.lastIndexOf("."))
      : visitorToken
    : null
  const affiliateShortCode =
    strOrNull(body.affiliate_short_code) ?? readCookie(req, AFF_COOKIE)

  const utm = (body.utm ?? {}) as Record<string, unknown>
  const ua = req.headers["user-agent"]

  try {
    await service.recordAnalyticsEvent({
      eventName,
      visitorToken: visitorRaw,
      customerId: strOrNull(body.customer_id),
      creatorSellerId: strOrNull(body.creator_seller_id),
      affiliateShortCode,
      affiliateLinkId: strOrNull(body.affiliate_link_id),
      orderId: strOrNull(body.order_id),
      productId: strOrNull(body.product_id),
      variantId: strOrNull(body.variant_id),
      utmSource:
        strOrNull(body.utm_source) ?? strOrNull(utm.source),
      utmMedium:
        strOrNull(body.utm_medium) ?? strOrNull(utm.medium),
      utmCampaign:
        strOrNull(body.utm_campaign) ?? strOrNull(utm.campaign),
      utmContent:
        strOrNull(body.utm_content) ?? strOrNull(utm.content),
      path: strOrNull(body.path),
      referrer: strOrNull(body.referrer),
      deviceType:
        strOrNull(body.device_type) ??
        deviceTypeFromUA(typeof ua === "string" ? ua : null),
      country:
        strOrNull(req.headers["cf-ipcountry"] as string) ??
        strOrNull(req.headers["x-vercel-ip-country"] as string),
      payload: (body.payload as Record<string, unknown>) ?? null,
    })
  } catch (err) {
    // Never block the storefront on analytics failure — log and 202.
    log.error("[store/analytics/events] failed:", err)
    return res.status(202).json({ recorded: false })
  }

  return res.status(202).json({ recorded: true })
}
