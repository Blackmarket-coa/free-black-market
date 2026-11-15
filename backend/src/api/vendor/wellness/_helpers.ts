import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../shared"
import { WELLNESS_MODULE } from "../../../modules/wellness"
import type WellnessModuleService from "../../../modules/wellness/service"
import { sellerOwnsProduct } from "../../../shared/product-sellers"

/** Resolve the wellness module service from the request scope. */
export function wellnessService(
  req: AuthenticatedMedusaRequest
): WellnessModuleService {
  return req.scope.resolve(WELLNESS_MODULE) as WellnessModuleService
}

/** Require the authenticated seller id (sends 401 + returns null on failure). */
export async function sellerId(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<string | null> {
  return requireSellerId(req, res)
}

/** Standard 500 response with a logged message. */
export function fail(
  res: MedusaResponse,
  log: { error: (...a: unknown[]) => void },
  scope: string,
  error: unknown
) {
  const msg = error instanceof Error ? error.message : "Unknown error"
  log.error(`[${scope}] failed:`, msg)
  return res.status(500).json({ message: `Failed: ${scope}`, type: "server_error" })
}

export function body<T = Record<string, unknown>>(req: AuthenticatedMedusaRequest): T {
  return (req.body ?? {}) as T
}

/**
 * The fields of `src` named in `keys` that are present (not undefined), and
 * nothing else. The class and membership-tier updates used to spread the
 * whole request body into the row, so a vendor could write any column,
 * `product_id` included (SD-52 re-review).
 */
export function pickFields<K extends string>(
  src: Record<string, unknown>,
  keys: readonly K[]
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {}
  for (const k of keys) {
    if (src[k] !== undefined) out[k] = src[k]
  }
  return out
}

/**
 * A `product_id` from a vendor request, checked against the calling seller.
 * `null` or `""` unlinks (`{ ok: true, value: null }`). Anything else must be a
 * product linked to `seller` through Mercur's seller–product link; a product
 * of another seller, a product that does not exist and a non-string all
 * answer `{ ok: false }`, which the caller sends as `forbidden()` (403, the
 * same for "not yours" and "no such product", so the check is no oracle).
 *
 * Product ids are public. Before this a vendor could link another seller's
 * product to their own class or tier and be handed that seller's buyers
 * (SD-52 re-review; the order subscriber checks the same link).
 */
export async function ownedProductId(
  req: AuthenticatedMedusaRequest,
  seller: string,
  productId: unknown
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (productId === null || productId === "") return { ok: true, value: null }
  if (typeof productId !== "string") return { ok: false }
  return (await sellerOwnsProduct(req.scope, seller, productId)) ? { ok: true, value: productId } : { ok: false }
}
