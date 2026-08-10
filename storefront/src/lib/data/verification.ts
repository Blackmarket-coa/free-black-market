"use server"

import { medusaFetch } from "../config"
import { logger } from "../logger"
import type {
  BadgeType,
  VerificationLevel,
} from "@/components/molecules/TrustIndicators/TrustIndicators"

export type SellerTrust = {
  level: VerificationLevel
  levelLabel: string
  trustScore: number
  yearsActive: number
  productionScale: string
  badges: Array<{
    type: BadgeType
    name: string
    description: string
    icon: string
    color: string
  }>
  verificationStatement?: string
}

export type VerificationCriteria = {
  levels: Array<{
    level: VerificationLevel
    label: string
    min_trust_score: number
    summary: string
  }>
  checks: Array<{ check_type: string; description: string }>
  badges: Array<{
    badge_type: BadgeType
    name: string
    description: string
    icon: string
    color: string
    learnMoreUrl?: string
  }>
}

/**
 * A seller's public trust summary.
 *
 * Returns null rather than throwing when the lookup fails: a badge strip is
 * supplementary to a seller page, and a verification blip should not take the
 * storefront down with it. Callers render nothing on null, which degrades to
 * the pre-existing behaviour.
 */
export async function getSellerTrust(
  handle: string
): Promise<SellerTrust | null> {
  try {
    const res = await medusaFetch<{ trust: SellerTrust }>(
      `/store/sellers/${encodeURIComponent(handle)}/trust`,
      { method: "GET", next: { revalidate: 300 } }
    )
    return res.trust ?? null
  } catch (error) {
    logger.error(`[getSellerTrust] failed for ${handle}:`, error)
    return null
  }
}

export type SellerStory = {
  bio: string | null
  niches: string[]
  practices: string[]
  certifications: string[]
  region: string | null
  cuisines: string[]
  website_url: string | null
}

/**
 * A seller's own account of themselves — the "meet the vendor" narrative.
 *
 * Null on failure, like `getSellerTrust`: a missing story should quietly leave
 * the section off the page rather than break the seller's storefront.
 */
export async function getSellerStory(
  handle: string
): Promise<SellerStory | null> {
  try {
    const res = await medusaFetch<{ story: SellerStory }>(
      `/store/sellers/${encodeURIComponent(handle)}/story`,
      { method: "GET", next: { revalidate: 300 } }
    )
    return res.story ?? null
  } catch (error) {
    logger.error(`[getSellerStory] failed for ${handle}:`, error)
    return null
  }
}

/**
 * The published badge and level criteria. Backs `/verification`.
 *
 * Unlike the per-seller summary this one throws on failure — the criteria page
 * has no content without it, and an empty rules page would be worse than an
 * error boundary.
 */
export async function getVerificationCriteria(): Promise<VerificationCriteria> {
  return medusaFetch<VerificationCriteria>("/store/verification-criteria", {
    method: "GET",
    next: { revalidate: 3600 },
  })
}
