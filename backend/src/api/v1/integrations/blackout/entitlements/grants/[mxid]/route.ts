import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requireEntitlementsAuth,
  decodeMxid,
} from "../../../../../../../lib/blackout-entitlements-auth"
import { ENTITLEMENT_MODULE } from "../../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../../modules/entitlement/service"
import { EntitlementStatus } from "../../../../../../../modules/entitlement/models"

/**
 * §4 listGrants — GET /entitlements/grants/{mxid}[?status=][&featureKey=]
 *
 * Raw grant rows for a member (the `/entitlements/grants` operation in
 * `docs/contracts/entitlements.yaml`), keyed by `customer_external_id` =
 * mxid. Complements the boolean `access` check: Blackout's settings surfaces
 * and the resync tooling need the full list with provenance and expiry, not
 * a per-feature yes/no.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const mxid = decodeMxid(req.params.mxid)
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined
  const status =
    statusRaw &&
    (Object.values(EntitlementStatus) as string[]).includes(statusRaw)
      ? (statusRaw as EntitlementStatus)
      : undefined
  if (statusRaw && !status) {
    return res.status(400).json({
      code: "bad_request",
      message: `status must be one of ${Object.values(EntitlementStatus).join(", ")}`,
    })
  }
  const featureKey =
    typeof req.query.featureKey === "string" && req.query.featureKey.length > 0
      ? req.query.featureKey
      : undefined

  const grants = await service.listGrantsByMxid(mxid, { status, featureKey })

  return res.json({
    mxid,
    grants: grants.map((g) => ({
      id: g.id,
      featureKey: g.feature_key,
      kind: g.kind,
      status: g.status,
      source: g.source,
      sourceOrderId: g.source_order_id ?? null,
      sourceSubscriptionId: g.source_subscription_id ?? null,
      grantedAt: g.granted_at ? new Date(g.granted_at as unknown as string).toISOString() : null,
      expiresAt: g.expires_at ? new Date(g.expires_at as unknown as string).toISOString() : null,
      revokedAt: g.revoked_at ? new Date(g.revoked_at as unknown as string).toISOString() : null,
      revokedReason: g.revoked_reason ?? null,
    })),
    count: grants.length,
  })
}
