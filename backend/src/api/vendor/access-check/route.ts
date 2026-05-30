import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../shared/auth-helpers"
import {
  evaluateFbmAccess,
  resolveMxidForSeller,
  ACCESS_RESOURCE_KINDS,
  ACCESS_ACTIONS,
  AccessResourceKind,
  AccessAction,
} from "../../../shared/access-control"

/**
 * GET /vendor/access-check?resource=<kind>:<id>&action=read|write|admin
 *
 * Example consumer of the internal access-control helper: resolves the
 * authenticated vendor's mxid and evaluates an entitlement-backed access
 * decision. Serves as the documented pattern for gating FBM actions; no
 * existing route is force-converted in this pass.
 *
 * Defaults to `fbm-listing` / `write` when params are omitted, so it doubles as
 * a "can this vendor manage listings?" probe.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  // Parse resource (`<kind>:<id>`) and action, with sensible defaults.
  const resourceParam = String(req.query.resource || "fbm-listing:*").trim()
  const sep = resourceParam.indexOf(":")
  const resourceKind = (sep >= 0 ? resourceParam.slice(0, sep) : resourceParam) as AccessResourceKind
  const resourceId = sep >= 0 ? resourceParam.slice(sep + 1) : "*"
  const action = String(req.query.action || "write").trim() as AccessAction

  if (!ACCESS_RESOURCE_KINDS.includes(resourceKind)) {
    res.status(400).json({
      code: "bad_request",
      message: `resource kind must be one of: ${ACCESS_RESOURCE_KINDS.join(", ")}`,
    })
    return
  }
  if (!ACCESS_ACTIONS.includes(action)) {
    res.status(400).json({
      code: "bad_request",
      message: `action must be one of: ${ACCESS_ACTIONS.join(", ")}`,
    })
    return
  }

  const mxid = await resolveMxidForSeller(req.scope, sellerId)
  if (!mxid) {
    // Not yet provisioned/backfilled — fail closed but explain why.
    res.json({
      allowed: false,
      reasons: [
        { check: "mxid_resolution", outcome: "fail", detail: "seller has no Matrix identity yet" },
      ],
      evaluated_at: new Date().toISOString(),
    })
    return
  }

  const decision = await evaluateFbmAccess(req.scope, {
    mxid,
    resourceKind,
    resourceId,
    action,
  })
  res.json(decision)
}
