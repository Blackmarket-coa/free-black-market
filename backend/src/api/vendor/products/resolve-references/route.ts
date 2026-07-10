import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { safeFetch } from "../../../../shared/safe-fetch"

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

const BOT_USER_AGENT =
  "Mozilla/5.0 (compatible; FreeBlackMarketImportBot/1.0; +https://freeblackmarket.com)"

const BLOCKED_BY_BOT_PROTECTION_STATUS = new Set([401, 403, 429])

type FetchProfile = {
  name: string
  headers: Record<string, string>
}

const getHostname = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

const buildFetchProfiles = (): FetchProfile[] => [
  {
    name: "browser",
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
    },
  },
  {
    name: "bot",
    headers: {
      "User-Agent": BOT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  },
]

const fetchHtmlWithRetryProfiles = async (reference: string) => {
  let lastStatus: number | undefined

  for (const profile of buildFetchProfiles()) {
    // `safeFetch` validates the URL (and every redirect hop) against the SSRF
    // guard, enforces a timeout, and caps the response size. `allowHttp` is on
    // because product pages are arbitrary public sites, some still on http; the
    // private-address block is what protects internal targets.
    const result = await safeFetch(reference, {
      headers: profile.headers,
      allowHttp: true,
    })

    if (result.ok) {
      return {
        finalUrl: result.url,
        html: result.text,
      }
    }

    lastStatus = result.status

    if (!BLOCKED_BY_BOT_PROTECTION_STATUS.has(result.status)) {
      throw new Error(`Source returned ${result.status}`)
    }
  }

  const host = getHostname(reference)

  throw new Error(
    `Source returned ${lastStatus ?? "unknown"}. ${
      host ? `${host} appears to block automated fetches` : "The source appears to block automated fetches"
    }`
  )
}

const sanitizeHandlePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

const decodeEntities = (value: string) =>
  value
    // &amp; decoded LAST so "&amp;lt;" isn't double-unescaped into "<"
    // (CodeQL: double unescaping).
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")

const stripTags = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()

const stripTrackingParams = (url: URL) => {
  const allowed = new URL(url.toString())
  const keep = new Set(["id", "variant", "product_id", "sku"])

  ;[...allowed.searchParams.keys()].forEach((key) => {
    if (!keep.has(key.toLowerCase())) {
      allowed.searchParams.delete(key)
    }
  })

  return allowed.toString()
}

const firstMatch = (html: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      return decodeEntities(match[1]).trim()
    }
  }

  return ""
}

const getMetaContent = (html: string, property: string) => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  return firstMatch(html, [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ])
}

const getJsonLdCandidates = (html: string) => {
  const matches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]

  return matches
    .map((match) => match[1]?.trim())
    .filter((content): content is string => !!content)
}

const findProductObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductObject(item)
      if (found) {
        return found
      }
    }
    return null
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const typeValue = obj["@type"]

    if (
      typeValue === "Product" ||
      (Array.isArray(typeValue) && typeValue.includes("Product"))
    ) {
      return obj
    }

    for (const child of Object.values(obj)) {
      const found = findProductObject(child)
      if (found) {
        return found
      }
    }
  }

  return null
}

const buildHandle = (resolvedUrl: URL, title: string) => {
  const hostName = sanitizeHandlePart(resolvedUrl.hostname.replace(/^www\./, "")) || "online-store"
  const pathLastSegment = resolvedUrl.pathname.split("/").filter(Boolean).pop() || "product"
  const slugSource = sanitizeHandlePart(pathLastSegment) || sanitizeHandlePart(title) || "product"

  return `${hostName}-${slugSource}`.slice(0, 120)
}

const extractDescription = (html: string) => {
  const fromMeta = getMetaContent(html, "description") || getMetaContent(html, "og:description")
  if (fromMeta) {
    return fromMeta
  }

  const article = firstMatch(html, [/<article[^>]*>([\s\S]{0,1500})<\/article>/i])
  if (article) {
    return stripTags(article).slice(0, 400)
  }

  return ""
}

const resolveReference = async (reference: string) => {
  const parsed = new URL(reference)
  const { finalUrl, html } = await fetchHtmlWithRetryProfiles(reference)

  const canonical =
    getMetaContent(html, "og:url") ||
    firstMatch(html, [/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i]) ||
    finalUrl ||
    reference

  const canonicalUrl = new URL(canonical, parsed)
  const cleanUrl = stripTrackingParams(canonicalUrl)

  let title = getMetaContent(html, "og:title") || ""
  let image = getMetaContent(html, "og:image") || ""
  let priceAmount = ""

  const jsonLdBlocks = getJsonLdCandidates(html)

  for (const block of jsonLdBlocks) {
    try {
      const parsedJson = JSON.parse(block)
      const productObject = findProductObject(parsedJson)

      if (!productObject) {
        continue
      }

      if (!title && typeof productObject.name === "string") {
        title = productObject.name
      }

      if (!image) {
        const productImage = productObject.image
        if (typeof productImage === "string") {
          image = productImage
        } else if (Array.isArray(productImage)) {
          const firstImage = productImage.find((item) => typeof item === "string")
          if (typeof firstImage === "string") {
            image = firstImage
          }
        }
      }

      if (!priceAmount) {
        const offers = productObject.offers as Record<string, unknown> | Record<string, unknown>[] | undefined
        const offer = Array.isArray(offers) ? offers[0] : offers

        if (offer && typeof offer.price === "string") {
          priceAmount = offer.price
        } else if (offer && typeof offer.price === "number") {
          priceAmount = String(offer.price)
        }
      }

      if (title && image && priceAmount) {
        break
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  if (!title) {
    title = firstMatch(html, [/<title[^>]*>([^<]+)<\/title>/i])
  }

  const description = extractDescription(html)
  const handle = buildHandle(canonicalUrl, title)

  return {
    reference,
    resolved_reference: cleanUrl,
    title: title || `Product from ${cleanUrl}`,
    handle,
    description,
    image,
    price_amount: priceAmount,
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as { references?: unknown }
  const references = Array.isArray(body.references)
    ? body.references.filter((item): item is string => typeof item === "string")
    : []

  if (!references.length) {
    return res.status(400).json({
      message: "At least one source reference is required.",
    })
  }

  const limitedReferences = references.slice(0, 25)

  const results = await Promise.all(
    limitedReferences.map(async (reference) => {
      try {
        const trimmed = reference.trim()
        if (!trimmed) {
          throw new Error("Reference is empty")
        }

        const normalizedUrl = new URL(trimmed)
        const resolved = await resolveReference(normalizedUrl.toString())

        return {
          ok: true,
          ...resolved,
        }
      } catch (error) {
        return {
          ok: false,
          reference,
          message: error instanceof Error ? error.message : "Failed to resolve reference",
        }
      }
    })
  )

  return res.status(200).json({
    products: results,
  })
}
