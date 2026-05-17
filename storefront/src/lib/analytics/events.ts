export type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>

/**
 * Canonical funnel events used across creator commerce surfaces. Keep this
 * union in sync with the allowlist in
 * `backend/src/api/store/analytics/events/route.ts`.
 */
export type CanonicalEventName =
  | "page_view"
  | "product_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "checkout_started"
  | "purchase"
  | "share"
  | "click_affiliate"
  | "signup"
  | "subscribe"
  | "creator_profile_view"
  | "creator_link_clicked"

export type MarketingEventName =
  | "homepage_vendor_type_selected"
  | "feature_matrix_viewed"
  | "dashboard_showcase_opened"
  | "pricing_breakdown_expanded"
  | "why_we_exist_cta_clicked"
  | "github_transparency_link_clicked"
  | "homepage_search_submitted"
  | "homepage_quick_filter_used"
  | "homepage_primary_cta_clicked"
  | "homepage_secondary_cta_clicked"
  | "homepage_first_session_progression"

export type WebsiteEventName = CanonicalEventName | MarketingEventName

const VISITOR_COOKIE = "_fbm_visitor"
const AFF_COOKIE = "_fbm_aff"

const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
  )
  return match ? decodeURIComponent(match[1]) : null
}

const stripCookieSignature = (signed: string | null): string | null => {
  if (!signed) return null
  const idx = signed.lastIndexOf(".")
  return idx > 0 ? signed.slice(0, idx) : signed
}

const readUrlContext = (): {
  path: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
} => {
  if (typeof window === "undefined") {
    return {
      path: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
    }
  }
  const params = new URLSearchParams(window.location.search)
  return {
    path: window.location.pathname,
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    utm_content: params.get("utm_content"),
  }
}

const readCreatorContext = (): {
  creator_handle: string | null
  affiliate_short_code: string | null
} => {
  // The storefront marks creator-aware containers with
  // `data-creator-handle`. Walk up from the active element if available.
  if (typeof document === "undefined") {
    return { creator_handle: null, affiliate_short_code: null }
  }
  const root = document.querySelector("[data-creator-handle]")
  const creator_handle = root?.getAttribute("data-creator-handle") ?? null
  return {
    creator_handle,
    affiliate_short_code: stripCookieSignature(readCookie(AFF_COOKIE)),
  }
}

/**
 * Build the enriched payload that ships with every event. Pulls in
 * visitor token, affiliate code, UTM params, creator handle, and device
 * type so callers don't need to remember to pass them.
 */
export const enrichWithContext = (
  payload: AnalyticsPayload = {}
): AnalyticsPayload => {
  if (typeof window === "undefined") return { ...payload }

  const deviceType = window.matchMedia("(max-width: 768px)").matches
    ? "mobile"
    : "desktop"
  const visitorToken = stripCookieSignature(readCookie(VISITOR_COOKIE))
  const url = readUrlContext()
  const creator = readCreatorContext()

  return {
    timestamp: new Date().toISOString(),
    deviceType,
    visitor_token: visitorToken,
    affiliate_short_code: creator.affiliate_short_code,
    creator_handle: creator.creator_handle,
    path: url.path,
    utm_source: url.utm_source,
    utm_medium: url.utm_medium,
    utm_campaign: url.utm_campaign,
    utm_content: url.utm_content,
    ...payload,
  }
}

const CANONICAL_EVENTS = new Set<CanonicalEventName>([
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
])

const isCanonical = (name: WebsiteEventName): name is CanonicalEventName =>
  CANONICAL_EVENTS.has(name as CanonicalEventName)

const postToBackend = (eventName: CanonicalEventName, payload: AnalyticsPayload) => {
  if (typeof window === "undefined") return

  const body = JSON.stringify({
    event_name: eventName,
    visitor_token: payload.visitor_token ?? null,
    customer_id: payload.customer_id ?? null,
    creator_seller_id: payload.creator_seller_id ?? null,
    affiliate_short_code: payload.affiliate_short_code ?? null,
    affiliate_link_id: payload.affiliate_link_id ?? null,
    order_id: payload.order_id ?? null,
    product_id: payload.product_id ?? null,
    variant_id: payload.variant_id ?? null,
    utm_source: payload.utm_source ?? null,
    utm_medium: payload.utm_medium ?? null,
    utm_campaign: payload.utm_campaign ?? null,
    utm_content: payload.utm_content ?? null,
    path: payload.path ?? null,
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
    device_type: payload.deviceType ?? null,
    payload,
  })

  const url = "/store/analytics/events"

  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" })
      const ok = navigator.sendBeacon(url, blob)
      if (ok) return
    }
    void fetch(url, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {})
  } catch {
    // Never let analytics break the page.
  }
}

export const emitWebsiteEvent = (
  name: WebsiteEventName,
  payload: AnalyticsPayload = {}
) => {
  if (typeof window === "undefined") return

  const enriched = enrichWithContext(payload)
  const eventPayload = {
    event: name,
    ...enriched,
  }

  // Keep this interoperable with common analytics integrations.
  const windowWithDataLayer = window as Window & {
    dataLayer?: Record<string, unknown>[]
  }

  windowWithDataLayer.dataLayer = windowWithDataLayer.dataLayer || []
  windowWithDataLayer.dataLayer.push(eventPayload)

  window.dispatchEvent(
    new CustomEvent("website-analytics-event", {
      detail: eventPayload,
    })
  )

  if (isCanonical(name)) {
    postToBackend(name, enriched)
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[analytics]", eventPayload)
  }
}
