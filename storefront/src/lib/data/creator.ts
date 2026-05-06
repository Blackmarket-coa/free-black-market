import { sdk } from "../config"

export interface CreatorProfile {
  seller_id: string
  handle: string
  bio: string | null
  niches: string[]
  total_followers: number
  audience_geo: Record<string, number> | null
  social_links: Record<string, string> | null
  verified: boolean
  featured: boolean
  rating: number | null
  review_count: number
}

/**
 * Fetch a creator's public profile by handle. Returns null if not found.
 *
 * Hits the marketplace public API at `/v1/marketplace/creators/:handle`
 * (no auth, only verified creator-vendor-type sellers are returned).
 */
export const getCreatorByHandle = async (
  handle: string
): Promise<CreatorProfile | null> => {
  return sdk.client
    .fetch<{ creator: CreatorProfile }>(`/v1/marketplace/creators/${handle}`, {
      cache: "no-cache",
    })
    .then(({ creator }) => creator ?? null)
    .catch(() => null)
}
