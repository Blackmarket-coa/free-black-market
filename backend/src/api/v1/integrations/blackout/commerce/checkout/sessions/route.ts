import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import jwt from "jsonwebtoken"
import { createHash, randomUUID } from "crypto"
import { requireCommerceApiKey } from "../../../../../../../lib/blackout-commerce-auth"
import { config } from "../../../../../../../shared/config"

const httpsUrl = z.string().url().refine((u) => /^https:\/\//.test(u), {
  message: "url must use https://",
})

const BodySchema = z
  .object({
    userId: z.string().min(1).max(256),
    listingId: z.string().min(1).max(120),
    sku: z.string().min(1).max(120).optional(),
    returnUrl: httpsUrl.optional(),
    embed: z.boolean().optional(),
  })
  .strict()

const SESSION_TTL_SECONDS = 30 * 60

/**
 * §5 POST /v1/checkout/sessions[?embed=1] (idempotency-key header)
 * body { userId, listingId, sku?, returnUrl?, embed? } -> { url, id }
 *
 * Returns a hosted FBM checkout URL that posts back via the §2 webhook once
 * the purchase settles. `idempotency-key`, when supplied, yields a stable `id`
 * for safe retries.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireCommerceApiKey(req, res)) return

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid checkout session payload",
      details: parsed.error.flatten(),
    })
  }

  const secret = config.JWT_SECRET
  if (!secret) {
    return res.status(500).json({ code: "server_error", message: "JWT_SECRET is not configured" })
  }

  const embed = parsed.data.embed === true || req.query.embed === "1"
  const idempotencyKeyHeader = req.headers["idempotency-key"]
  const idempotencyKey = Array.isArray(idempotencyKeyHeader)
    ? idempotencyKeyHeader[0]
    : idempotencyKeyHeader

  const id = idempotencyKey
    ? `cs_${createHash("sha256").update(String(idempotencyKey)).digest("hex").slice(0, 32)}`
    : `cs_${randomUUID().replace(/-/g, "")}`

  const token = jwt.sign(
    {
      id,
      userId: parsed.data.userId,
      listingId: parsed.data.listingId,
      sku: parsed.data.sku ?? null,
      embed,
      returnUrl: parsed.data.returnUrl ?? null,
    },
    secret,
    { expiresIn: SESSION_TTL_SECONDS, audience: "fbm-blackout-checkout" }
  )

  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https"
  const host = req.headers["x-forwarded-host"] || req.headers.host
  const baseUrl = (
    process.env.FREEBLACKMARKET_BASE_URL ||
    process.env.BACKEND_URL ||
    `${protocol}://${host}`
  ).replace(/\/$/, "")

  const url = `${baseUrl}/v1/integrations/blackout/commerce/checkout/sessions/${encodeURIComponent(
    token
  )}/page${embed ? "?embed=1" : ""}`

  return res.status(201).json({ id, url })
}
