import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TENANCY_MODULE } from "../../../../../modules/tenancy"
import type TenancyModuleService from "../../../../../modules/tenancy/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../../modules/creator-attribution"
import type CreatorAttributionService from "../../../../../modules/creator-attribution/service"

/**
 * Capture an affiliate referral after a freshly-authenticated seller lands
 * in the vendor panel. The vendor-panel reads the `_fbm_aff` cookie that
 * was set by the public `/r/:shortCode` redirector and POSTs it here so
 * we can:
 *   1. Record `referred_by_seller_id` on the seller's OnboardingState
 *   2. Seed the seller's primary AffiliateLink with
 *      `referrer_creator_seller_id = referrer.creator_seller_id`
 *
 * This wires Slice C (signup) into Slice B (multi-level referral chain)
 * so the chain is automatically populated for every social-login signup
 * that arrived via an affiliate link.
 */

async function resolveSellerId(
  req: MedusaRequest,
  actorId?: string
): Promise<string | undefined> {
  if (!actorId) return undefined
  if (!actorId.startsWith("mem_")) return actorId
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )
    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
}

function readCookie(req: MedusaRequest, name: string): string | null {
  const header = req.headers["cookie"]
  if (typeof header !== "string") return null
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return decodeURIComponent(v.join("="))
  }
  return null
}

const AFF_COOKIE = "_fbm_aff"

type Body = {
  affiliate_short_code?: string
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const body = (req.validatedBody || req.body || {}) as Body
  const shortCode =
    (typeof body.affiliate_short_code === "string" && body.affiliate_short_code) ||
    readCookie(req, AFF_COOKIE)

  if (!shortCode) {
    return res.status(200).json({ captured: false, reason: "no_short_code" })
  }

  const attribution = req.scope.resolve<CreatorAttributionService>(
    CREATOR_ATTRIBUTION_MODULE
  )
  const tenancy = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)

  const links = await attribution.listAffiliateLinks({ short_code: shortCode })
  const referrerLink = links[0]
  if (!referrerLink) {
    return res.status(200).json({ captured: false, reason: "unknown_short_code" })
  }
  const referrerSellerId = (referrerLink as any).creator_seller_id as string

  if (referrerSellerId === sellerId) {
    // self-referral guard
    return res.status(200).json({ captured: false, reason: "self_referral" })
  }

  // Persist the referrer on the seller's OnboardingState (idempotent —
  // first writer wins, repeat calls are a no-op).
  let onboardingUpdated = false
  try {
    const states = await tenancy.listOnboardingStates({ seller_id: sellerId })
    const state = states[0]
    if (state && !(state as any).referred_by_seller_id) {
      await (tenancy as any).updateOnboardingStates({
        selector: { id: state.id },
        data: { referred_by_seller_id: referrerSellerId },
      })
      onboardingUpdated = true
    }
  } catch (err) {
    console.error("[vendor/me/onboarding/referral-capture] tenancy update failed:", err)
  }

  // Seed a primary AffiliateLink for the new seller pointing back at
  // their referrer, so future affiliate-driven sales for this creator
  // walk the chain via the existing referrer_creator_seller_id field.
  let linkCreated = false
  try {
    const ownLinks = await attribution.listAffiliateLinks({
      creator_seller_id: sellerId,
    })
    const hasReferrer = ownLinks.some(
      (l) => (l as any).referrer_creator_seller_id
    )
    if (!hasReferrer) {
      if (ownLinks.length === 0) {
        await attribution.generateLink({
          creatorSellerId: sellerId,
          metadata: {
            seeded_by: "referral-capture",
            referrer_short_code: shortCode,
          },
        })
      }
      // The newly-created (or existing first) link gets the referrer
      // pointer attached. We re-read so we operate on the persisted row.
      const refreshed = await attribution.listAffiliateLinks({
        creator_seller_id: sellerId,
      })
      const target = refreshed[0]
      if (target && !(target as any).referrer_creator_seller_id) {
        await (attribution as any).updateAffiliateLinks({
          id: target.id,
          referrer_creator_seller_id: referrerSellerId,
        })
        linkCreated = true
      }
    }
  } catch (err) {
    console.error("[vendor/me/onboarding/referral-capture] link seed failed:", err)
  }

  return res.status(200).json({
    captured: true,
    referrer_seller_id: referrerSellerId,
    onboarding_state_updated: onboardingUpdated,
    affiliate_link_seeded: linkCreated,
  })
}
