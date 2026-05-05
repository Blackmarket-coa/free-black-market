import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import jwt from "jsonwebtoken"
import { config } from "../../../../shared/config"

const httpsUrl = z.string().url().refine((u) => /^https:\/\//.test(u), {
  message: "url must use https://",
})

const BodySchema = z
  .object({
    cart_id: z.string().min(1).max(80),
    return_url: httpsUrl.optional(),
    embed: z.boolean().optional(),
    embed_origin: httpsUrl.optional(),
  })
  .strict()
  .refine((d) => !d.embed || !!d.embed_origin, {
    message: "embed_origin is required when embed=true",
    path: ["embed_origin"],
  })

const SESSION_TTL_SECONDS = 30 * 60 // 30 minutes

interface SessionTokenPayload {
  cart_id: string
  embed: boolean
  embed_origin?: string
  return_url?: string
}

function getJwtSecret(): string {
  const secret = config.JWT_SECRET
  if (!secret) {
    throw new Error("JWT_SECRET is required to issue checkout session tokens")
  }
  return secret
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid checkout session payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const payload: SessionTokenPayload = {
    cart_id: parsed.data.cart_id,
    embed: parsed.data.embed === true,
    embed_origin: parsed.data.embed_origin,
    return_url: parsed.data.return_url,
  }

  const token = (jwt.sign as any)(payload, getJwtSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
    audience: "fbm-checkout",
  })

  const protocol =
    (req.headers["x-forwarded-proto"] as string) || req.protocol || "https"
  const host = req.headers["x-forwarded-host"] || req.headers.host
  const baseUrl = (process.env.BACKEND_URL || `${protocol}://${host}`).replace(
    /\/$/,
    ""
  )

  const url = `${baseUrl}/v1/checkout/sessions/${encodeURIComponent(token)}/page${
    parsed.data.embed ? "?embed=1" : ""
  }`

  return res.status(201).json({
    session_id: token,
    url,
    expires_in: SESSION_TTL_SECONDS,
    embed: payload.embed,
  })
}
