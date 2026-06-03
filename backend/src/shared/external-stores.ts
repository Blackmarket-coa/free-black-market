/**
 * Normalizes a seller's `storefront_links` (the StorefrontLinks shape on
 * seller_metadata) into a flat, display-ready list of external stores for the
 * Commerce Hub directory + producer profiles. Pure + shared so the producer
 * detail route and the directory route stay consistent.
 */

export type ExternalStore = {
  platform: string
  name: string
  url: string
}

const PLATFORM_LABELS: Record<string, string> = {
  website: "Website",
  etsy: "Etsy",
  amazon: "Amazon",
  shopify: "Shopify",
  ebay: "eBay",
  farmers_market: "Farmers Market",
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim())
}

export function normalizeStorefrontLinks(
  storefrontLinks: unknown,
  websiteUrl?: unknown
): ExternalStore[] {
  const out: ExternalStore[] = []
  const seen = new Set<string>()

  const push = (platform: string, name: string, url: unknown) => {
    if (!isHttpUrl(url)) {
      return
    }
    const trimmed = (url as string).trim()
    const key = `${platform}:${trimmed}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    out.push({ platform, name, url: trimmed })
  }

  const links = (storefrontLinks ?? {}) as Record<string, unknown>
  for (const [key, label] of Object.entries(PLATFORM_LABELS)) {
    push(key, label, links[key])
  }

  // `other` is an array of { name, url } for arbitrary platforms.
  if (Array.isArray(links.other)) {
    for (const entry of links.other as Array<Record<string, unknown>>) {
      if (entry && typeof entry === "object") {
        const name =
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : "Other"
        push("other", name, entry.url)
      }
    }
  }

  // Quick-access primary website as a fallback if not already present.
  if (!out.some((s) => s.platform === "website")) {
    push("website", "Website", websiteUrl)
  }

  return out
}
