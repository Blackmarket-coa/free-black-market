import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/sellers/:handle/story
 *
 * The narrative a buyer wants before buying from a stranger: who this is, how
 * they work, where they are.
 *
 * Producers already had this end to end — `producer.story` renders as "Our
 * Story" on `/producers/:handle`, and `cells/FarmStory` puts provenance on
 * product pages. General sellers did not: `seller_metadata.creator_bio` has
 * existed since the creator vendor type shipped and was never returned by any
 * store route, so `/sellers/:handle` could only show the short `description`.
 *
 * Kept separate from `/trust` deliberately. Verification is a claim the
 * platform makes and stands behind; a story is the seller's own account of
 * themselves. Serving them from one endpoint would blur which is which.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = (req.params as { handle?: string })?.handle
  if (!handle) {
    return res
      .status(400)
      .json({ message: "Missing seller handle", type: "invalid_request" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "handle"],
    filters: { handle },
  })

  const seller = sellers?.[0]
  if (!seller) {
    return res.status(404).json({ message: "Seller not found", type: "not_found" })
  }

  const { data: metadata } = await query.graph({
    entity: "seller_metadata",
    fields: [
      "seller_id",
      "creator_bio",
      "creator_niches",
      "farm_practices",
      "certifications",
      "growing_region",
      "cuisine_types",
      "website_url",
    ],
    filters: { seller_id: seller.id },
  })

  const meta = metadata?.[0]

  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
  res.json({
    story: {
      bio: meta?.creator_bio ?? null,
      niches: asStringArray(meta?.creator_niches),
      practices: asStringArray(meta?.farm_practices),
      certifications: asStringArray(meta?.certifications),
      region: meta?.growing_region ?? null,
      cuisines: asStringArray(meta?.cuisine_types),
      website_url: meta?.website_url ?? null,
    },
  })
}

/**
 * These columns are `json` and were populated by several different vendor
 * flows, so they hold arrays in some rows and free text in others. Normalising
 * here keeps the storefront from having to guess — and stops a string being
 * spread into one chip per character.
 */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()]
  }
  return []
}
