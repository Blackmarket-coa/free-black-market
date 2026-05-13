import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SELL_SIGNUP_MODULE } from "../../../modules/sell-signup"
import type SellSignupModuleService from "../../../modules/sell-signup/service"
import { createLogger } from "../../../shared/logger"

const logger = createLogger("SellSignup")

/**
 * Captures from the storefront "Sell on Free Black Market" landing page.
 * Anonymous endpoint protected by the standard Medusa `x-publishable-api-key`
 * header; the storefront fires this best-effort before redirecting to the
 * vendor-panel registration flow, so abandoned signups still end up in the
 * leads table.
 *
 * Body schema:
 *   - email:      RFC-compliant email, lowercased + trimmed before store
 *   - store_name: free-form string 1..120 chars
 *   - selling:    string[] of chosen sale categories (0..32 entries,
 *                 each 1..80 chars)
 *
 * Network metadata (source IP, user agent, referer) is captured for
 * downstream spam triage. No vendor-panel cookies or session tokens are
 * read.
 */

const MAX_SELLING_CATEGORIES = 32
const MAX_CATEGORY_LENGTH = 80
const MAX_STORE_NAME_LENGTH = 120
const MAX_HEADER_LENGTH = 500

const sellSignupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  store_name: z.string().trim().min(1).max(MAX_STORE_NAME_LENGTH),
  selling: z
    .array(z.string().trim().min(1).max(MAX_CATEGORY_LENGTH))
    .max(MAX_SELLING_CATEGORIES)
    .default([]),
})

function firstForwardedFor(value: string | string[] | undefined): string | null {
  if (!value) return null
  const raw = Array.isArray(value) ? value[0] : value
  const first = raw.split(",")[0]?.trim()
  return first ? first.slice(0, 64) : null
}

function trimmedHeader(value: string | string[] | undefined): string | null {
  if (!value) return null
  const raw = Array.isArray(value) ? value[0] : value
  return raw.slice(0, MAX_HEADER_LENGTH)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = sellSignupSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      type: "invalid_data",
      errors: parsed.error.errors,
    })
  }

  const sellSignupService =
    req.scope.resolve<SellSignupModuleService>(SELL_SIGNUP_MODULE)

  const sourceIp =
    firstForwardedFor(req.headers["x-forwarded-for"]) ||
    (req.ip ? req.ip.slice(0, 64) : null)

  const [signup] = await sellSignupService.createSellSignups([
    {
      email: parsed.data.email,
      store_name: parsed.data.store_name,
      // model.json() column infers `Record<string, unknown>`; the
      // payload is intentionally a string[], so we double-cast to
      // match the column shape without forcing the wider type
      // everywhere upstream. Mirrors the pattern used by
      // payout-breakdown for `breakdown_items: Array<BreakdownItem>`.
      selling: parsed.data.selling as unknown as Record<string, unknown>,
      status: "new",
      source_ip: sourceIp,
      user_agent: trimmedHeader(req.headers["user-agent"]),
      referer: trimmedHeader(req.headers["referer"]),
    },
  ])

  logger.info("sell-signup captured", {
    id: signup.id,
    email: signup.email,
    categories: signup.selling,
  })

  res.status(202).json({ id: signup.id, status: signup.status })
}
