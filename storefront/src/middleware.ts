import { logger } from "@/lib/logger"
import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"
import { detectEmbedContext } from "./lib/runtime/embed-context"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || ""
const PUBLISHABLE_API_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us"

const regionMapCache = {
  regionMap: new Map<string, HttpTypes.StoreRegion>(),
  regionMapUpdated: Date.now(),
}

async function getRegionMap(cacheId: string) {
  const { regionMap, regionMapUpdated } = regionMapCache

  if (!BACKEND_URL || !PUBLISHABLE_API_KEY) {
    if (process.env.NODE_ENV === "development") {
      logger.warn(
        "Middleware.ts: MEDUSA_BACKEND_URL/NEXT_PUBLIC_MEDUSA_BACKEND_URL or NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY missing; skipping dynamic region fetch."
      )
    }
    return regionMap
  }

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    // Fetch regions from Medusa. We can't use the JS client here because middleware is running on Edge and the client needs a Node environment.
    // Fail-soft: a backend error must never throw out of middleware (that would
    // 500 every route). On failure we return the (possibly empty) map and the
    // caller serves the page without a locale redirect.
    try {
      const { regions } = await fetch(`${BACKEND_URL}/store/regions`, {
        headers: {
          "x-publishable-api-key": PUBLISHABLE_API_KEY!,
        },
        next: {
          revalidate: 3600,
          tags: [`regions-${cacheId}`],
        },
        cache: "force-cache",
      }).then(async (response) => {
        const json = await response.json()

        if (!response.ok) {
          throw new Error(json.message)
        }

        return json
      })

      if (regions?.length) {
        // Create a map of country codes to regions.
        regions.forEach((region: HttpTypes.StoreRegion) => {
          region.countries?.forEach((c) => {
            regionMapCache.regionMap.set(c.iso_2 ?? "", region)
          })
        })

        // Fallback: if no countries are assigned to any region, map the default
        // region code to the first region so locale routing still resolves.
        if (!regionMapCache.regionMap.size) {
          regionMapCache.regionMap.set(DEFAULT_REGION, regions[0])
        }

        regionMapCache.regionMapUpdated = Date.now()
      }
    } catch (error) {
      logger.error(
        "Middleware.ts: failed to load regions; serving without locale redirect.",
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  return regionMapCache.regionMap
}

async function getCountryCode(
  request: NextRequest,
  regionMap: Map<string, HttpTypes.StoreRegion | number>
) {
  try {
    let countryCode

    const vercelCountryCode = request.headers
      .get("x-vercel-ip-country")
      ?.toLowerCase()

    const urlCountryCode = request.nextUrl.pathname.split("/")[1]?.toLowerCase()

    if (urlCountryCode && regionMap.has(urlCountryCode)) {
      countryCode = urlCountryCode
    } else if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      countryCode = vercelCountryCode
    } else if (regionMap.has(DEFAULT_REGION)) {
      countryCode = DEFAULT_REGION
    } else if (regionMap.keys().next().value) {
      countryCode = regionMap.keys().next().value
    }

    return countryCode
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      logger.error(
        "Middleware.ts: Error getting the country code. Did you set up regions in your Medusa Admin and define a MEDUSA_BACKEND_URL environment variable? Note that the variable is no longer named NEXT_PUBLIC_MEDUSA_BACKEND_URL."
      )
    }
  }
}

/**
 * Apply creator-attribution cookies (visitor token + affiliate code) to the
 * given response. Idempotent: existing visitor cookies are reused; the
 * affiliate cookie is only refreshed when `?fbm_ref=<code>` is present.
 */
function applyAttributionCookies(request: NextRequest, response: NextResponse) {
  const VISITOR_COOKIE = "_fbm_visitor"
  const AFF_COOKIE = "_fbm_aff"
  const COOKIE_MAX_AGE_DAYS = 90
  const AFF_MAX_AGE_DAYS =
    parseInt(process.env.NEXT_PUBLIC_CREATOR_ATTRIBUTION_DEFAULT_COOKIE_DAYS || "7", 10) || 7

  // Visitor cookie: ensure one exists and is 90 days fresh.
  if (!request.cookies.get(VISITOR_COOKIE)) {
    response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
      maxAge: COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
      sameSite: "lax",
      path: "/",
    })
  }

  // Affiliate cookie: pin if `?fbm_ref=<short_code>` present in the URL.
  const fbmRef = request.nextUrl.searchParams.get("fbm_ref")
  if (fbmRef) {
    response.cookies.set(AFF_COOKIE, `${fbmRef}.${Date.now()}`, {
      maxAge: AFF_MAX_AGE_DAYS * 24 * 60 * 60,
      sameSite: "lax",
      path: "/",
    })
  }
}

/**
 * Capacitor / in-app webview embed support per
 * AGGRESSIVE_OPERATIONS_GUIDE.md §2.8 and §5.1. When the request
 * carries `X-FBM-Embed-Origin` and the origin is allowlisted via
 * `BLACKOUT_EMBED_ALLOWED_ORIGINS`, swap the default
 * `X-Frame-Options: SAMEORIGIN` for a `frame-ancestors` CSP that names
 * the embed origin. Origins outside the allowlist do not get the
 * relaxed headers, so a malicious origin cannot opt itself in.
 */
function applyEmbedHeaders(request: NextRequest, response: NextResponse) {
  const ctx = detectEmbedContext({
    get: (name) => request.headers.get(name),
  })
  if (!ctx.isEmbedded || !ctx.isAllowedOrigin || !ctx.origin) return

  // Override the default X-Frame-Options applied via next.config.ts
  // headers(); modern browsers honor frame-ancestors over X-Frame-Options
  // when both are present.
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${ctx.origin}`
  )
  // Echo the resolved origin for debugging the handshake from inside
  // the webview without exposing it to non-embed callers.
  response.headers.set("X-FBM-Embed-Origin-Echo", ctx.origin)
}

export async function middleware(request: NextRequest) {
  // Short-circuit static assets
  if (request.nextUrl.pathname.includes(".")) {
    return NextResponse.next()
  }

  const cacheIdCookie = request.cookies.get("_medusa_cache_id")
  const urlSegment = request.nextUrl.pathname.split("/")[1]
  const looksLikeLocale = /^[a-z]{2}$/i.test(urlSegment || "")

  // Fast path: URL already has a locale segment and cache cookie exists.
  // Still apply creator attribution cookies so /r/* redirects through the
  // backend redirector or any direct ?fbm_ref= param keeps attributing.
  if (looksLikeLocale && cacheIdCookie) {
    const fastResponse = NextResponse.next()
    applyAttributionCookies(request, fastResponse)
    applyEmbedHeaders(request, fastResponse)
    return fastResponse
  }

  let response = NextResponse.next()

  // Ensure cache id cookie exists (set without redirect)
  const cacheId = cacheIdCookie?.value || crypto.randomUUID()
  if (!cacheIdCookie) {
    response.cookies.set("_medusa_cache_id", cacheId, {
      maxAge: 60 * 60 * 24,
    })
  }

  applyAttributionCookies(request, response)
  applyEmbedHeaders(request, response)

  const regionMap = await getRegionMap(cacheId)
  if (!regionMap.size) {
    return response
  }

  const countryCode = await getCountryCode(request, regionMap)

  const urlHasCountryCode =
    countryCode && request.nextUrl.pathname.split("/")[1].includes(countryCode)

  // If no country code in URL but we can resolve one, redirect to locale-prefixed path
  if (!urlHasCountryCode && countryCode) {
    const redirectPath =
      request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname
    const queryString = request.nextUrl.search ? request.nextUrl.search : ""
    const redirectUrl = `${request.nextUrl.origin}/${countryCode}${redirectPath}${queryString}`
    return NextResponse.redirect(redirectUrl, 307)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
}
