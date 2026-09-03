import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { ORDER_DISPUTE_MODULE } from "../../../modules/order-dispute"
import type OrderDisputeService from "../../../modules/order-dispute/service"
import {
  CLAIM_METADATA_KEYS,
  claimReasonToDisputeReason,
  toLegacyClaim,
} from "../../../modules/order-dispute/claims-compat"
import { DEFAULT_FILING_WINDOW_DAYS } from "../../../modules/order-dispute/resolution"
import { orderClaimPayloadSchema, REQUEST_TYPES } from "../../../modules/request/validators"
import { requireCustomerId } from "../../../shared"
import { openDisputeForOrder } from "../../../shared/order-dispute-intake"

/**
 * Buyer claims: "it never arrived", "it isn't what was described".
 *
 * Medusa's returns flow presupposes the item is in the buyer's hands, so the
 * most common complaint — a parcel that never showed up — had no path at all,
 * while `/how-it-works` promised buyers "we'll step in to make it right". This
 * is the mechanism behind that promise.
 *
 * **Now backed by `order-dispute`, not `request`.** This route was originally
 * built on the generic `request` model, and its docblock warned that "a
 * parallel claims module would duplicate all of it". A parallel module was
 * then built anyway — `modules/order-dispute`, with per-vendor scoping, claim
 * and award amounts, a vendor right of reply and an audit log, none of which
 * fit the request shell. The operator chose order-dispute as the single engine
 * on 2026-09-03. This route keeps its path, its request body and its response
 * shape so the storefront's `OrderClaimSection` and `/buyer-protection` page
 * keep working unchanged; underneath, a claim is a dispute.
 *
 * Admin triage moved with it: claims no longer appear in `/admin/requests`,
 * they are worked from `/admin/disputes`.
 */

/**
 * How long after an order a claim can be filed.
 *
 * Published on `/buyer-protection`. This is no longer a value of its own — it
 * IS the dispute filing window, so the two systems cannot publish different
 * numbers again. The storefront's copy in `lib/constants/order-claims.ts`
 * mirrors it for rendering the policy page.
 */
export const CLAIM_WINDOW_DAYS = DEFAULT_FILING_WINDOW_DAYS

/**
 * GET /store/order-claims
 * The claims this customer has filed, with their current status.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const rows = (await service.listOrderDisputes(
    { customer_id: customerId },
    { order: { created_at: "DESC" } }
  )) as unknown as Parameters<typeof toLegacyClaim>[0][]

  const claims = rows.map(toLegacyClaim)
  res.json({ claims, count: claims.length })
}

/**
 * POST /store/order-claims
 * File a claim against one of your own orders.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = requireCustomerId(req, res)
  if (!customerId) return

  const parsed = orderClaimPayloadSchema.safeParse({
    ...(req.body as Record<string, unknown>),
    type: REQUEST_TYPES.ORDER_CLAIM,
  })

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid claim",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const body = req.body as { seller_id?: unknown }

  const result = await openDisputeForOrder(req.scope, {
    customerId,
    orderId: parsed.data.order_id,
    sellerId: typeof body.seller_id === "string" ? body.seller_id : null,
    reason: claimReasonToDisputeReason(parsed.data.reason),
    description: parsed.data.description,
    windowDays: CLAIM_WINDOW_DAYS,
    metadata: {
      // The original claim vocabulary, so the round-trip through the claims
      // surface is lossless — see `toLegacyClaim`.
      [CLAIM_METADATA_KEYS.reason]: parsed.data.reason,
      [CLAIM_METADATA_KEYS.evidenceUrls]: parsed.data.evidence_urls ?? [],
      [CLAIM_METADATA_KEYS.contactedSeller]: parsed.data.contacted_seller ?? false,
      [CLAIM_METADATA_KEYS.source]: "store/order-claims",
    },
  })

  if (!result.ok) {
    return res.status(result.status).json(result.body)
  }

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const [fresh] = (await service.listOrderDisputes({
    id: result.dispute.id,
  })) as unknown as Parameters<typeof toLegacyClaim>[0][]

  res.status(201).json({ claim: toLegacyClaim(fresh ?? result.dispute) })
}
