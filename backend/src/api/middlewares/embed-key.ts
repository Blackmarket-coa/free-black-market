import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import cors from "cors"
import { createLogger } from "../../shared/logger"
import { extractEmbedKey, originAllowed } from "../../shared/embed-auth"
import { meterEmbedRequest } from "../../shared/usage-metering"
import { EMBED_KEYS_MODULE } from "../../modules/embed-keys"
import type EmbedKeysService from "../../modules/embed-keys/service"

const log = createLogger("api/middlewares/embed-key")

/**
 * Request fields populated by the embed-key middleware. Consumed by the
 * `/store/embed/*` handlers and the per-key rate limiter.
 */
export type EmbedRequest = MedusaRequest & {
  embed_seller_id?: string
  embed_key_id?: string
  embed_origin?: string | null
}

/**
 * Open CORS for embed endpoints.
 *
 * connect.js runs on arbitrary third-party sites and sends an `Authorization`
 * header, so we reflect any origin and allow the header. This is NOT the
 * security boundary — every real request is still gated by `requireEmbedKey`,
 * which validates the publishable key AND that the request Origin is in the
 * vendor's `connect_domains` allow-list. CORS only governs what the browser
 * lets the page read back.
 */
export function embedCorsMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  return cors({
    origin: true, // reflect any origin
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })(req, res, next)
}

/** Resolve a request's publishable key to a seller, enforcing the origin allow-list. */
async function resolveEmbedContext(
  req: MedusaRequest
): Promise<
  | { ok: true; seller_id: string; key_id: string }
  | { ok: false; status: 401 | 403; message: string }
  | { ok: "absent" }
> {
  const plaintext = extractEmbedKey(req.headers.authorization)
  if (!plaintext) {
    return { ok: "absent" }
  }

  const embedKeys = req.scope.resolve(EMBED_KEYS_MODULE) as EmbedKeysService
  const resolution = await embedKeys.verifyKey(plaintext)
  if (!resolution) {
    return { ok: false, status: 401, message: "Invalid or revoked embed key" }
  }

  // Origin must be whitelisted in the vendor's connect_domains. The Origin
  // header is the trustworthy signal for browser requests; fall back to Referer.
  const origin =
    (req.headers.origin as string | undefined) ||
    (req.headers.referer as string | undefined) ||
    ""

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: metaRows } = await query.graph({
    entity: "seller_metadata",
    fields: ["connect_domains"],
    filters: { seller_id: resolution.seller_id },
  })
  const domains = (metaRows?.[0]?.connect_domains as unknown) ?? []

  if (!originAllowed(origin, domains)) {
    return {
      ok: false,
      status: 403,
      message: "Origin not allowed for this embed key",
    }
  }

  return { ok: true, seller_id: resolution.seller_id, key_id: resolution.id }
}

/**
 * Hard gate for `/store/embed/*`: a valid publishable key from an allowed
 * origin is required. Attaches `embed_seller_id`/`embed_key_id`/`embed_origin`.
 */
export async function requireEmbedKey(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method === "OPTIONS") return next()

  try {
    const ctx = await resolveEmbedContext(req)
    if (ctx.ok === "absent") {
      return res.status(401).json({
        message: "Missing embed key (Authorization: PublishableKey pk_live_…)",
        type: "unauthorized",
      })
    }
    if (ctx.ok === false) {
      return res
        .status(ctx.status)
        .json({ message: ctx.message, type: ctx.status === 401 ? "unauthorized" : "not_allowed" })
    }
    const r = req as EmbedRequest
    r.embed_seller_id = ctx.seller_id
    r.embed_key_id = ctx.key_id
    r.embed_origin =
      (req.headers.origin as string | undefined) ?? null

    // Meter the request for monthly overage billing. Counted here — after the
    // key resolves, before the handler runs — so what is billed is
    // authenticated traffic, and a handler that later errors still counts: the
    // vendor's site did drive the call, and only counting successes would let a
    // misbehaving integration hammer the platform for free.
    //
    // Fire-and-forget by design; see `shared/usage-metering.ts`.
    meterEmbedRequest(req.scope, ctx.seller_id)

    return next()
  } catch (err) {
    log.error("requireEmbedKey failed", err)
    return res
      .status(500)
      .json({ message: "Embed authentication failed", type: "server_error" })
  }
}

/**
 * Soft gate for `/store/vendors/:handle`: keeps the keyless public path working
 * (cacheable, IP rate-limited) while validating the key + origin when one is
 * present. An invalid key or disallowed origin is still rejected so a key, once
 * used, is held to the same contract as the hard path.
 */
export async function optionalEmbedKey(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method === "OPTIONS") return next()

  try {
    const ctx = await resolveEmbedContext(req)
    if (ctx.ok === "absent") {
      return next() // keyless fallback — unchanged public behavior
    }
    if (ctx.ok === false) {
      return res
        .status(ctx.status)
        .json({ message: ctx.message, type: ctx.status === 401 ? "unauthorized" : "not_allowed" })
    }
    const r = req as EmbedRequest
    r.embed_seller_id = ctx.seller_id
    r.embed_key_id = ctx.key_id
    r.embed_origin = (req.headers.origin as string | undefined) ?? null
    return next()
  } catch (err) {
    // Never break the public catalog because key resolution hiccuped.
    log.warn("optionalEmbedKey soft-failed; continuing keyless", err)
    return next()
  }
}
