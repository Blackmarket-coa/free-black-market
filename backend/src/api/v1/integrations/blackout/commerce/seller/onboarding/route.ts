import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { requireCommerceApiKey } from "../../../../../../../lib/blackout-commerce-auth"
import { resolveSellerIdByBlackoutUserId } from "../../../../../../../lib/blackout-identity"

const BodySchema = z
  .object({
    sellerUserId: z.string().min(1),
    returnUrl: z.string().url().optional(),
  })
  .strict()

const ONBOARDING_TTL_SECONDS = 24 * 60 * 60

/**
 * §5 POST /v1/seller/onboarding { sellerUserId, returnUrl? } -> { url, expiresAt }
 *
 * Returns a stable onboarding URL for the vendor panel. Mirrors the existing
 * payouts onboarding contract (real payout-provider wiring lands separately).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid onboarding payload",
      details: parsed.error.flatten(),
    })
  }

  // Best-effort: resolve to an FBM seller if the account is already linked.
  const sellerId = await resolveSellerIdByBlackoutUserId(req.scope, parsed.data.sellerUserId)

  const base = (
    process.env.VENDOR_PANEL_URL ||
    process.env.VENDOR_URL ||
    process.env.BACKEND_URL ||
    "https://vendor.freeblackmarket.com"
  ).replace(/\/$/, "")

  const params = new URLSearchParams({ blackout_user_id: parsed.data.sellerUserId })
  if (sellerId) params.set("seller", sellerId)
  if (parsed.data.returnUrl) params.set("return_url", parsed.data.returnUrl)

  const url = `${base}/onboarding?${params.toString()}`
  const expiresAt = new Date(Date.now() + ONBOARDING_TTL_SECONDS * 1000).toISOString()

  return res.json({ url, expiresAt })
}
