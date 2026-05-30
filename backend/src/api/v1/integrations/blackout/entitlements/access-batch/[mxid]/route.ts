import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  requireEntitlementsAuth,
  decodeMxid,
} from "../../../../../../../lib/blackout-entitlements-auth"
import { ENTITLEMENT_MODULE } from "../../../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../../../modules/entitlement/service"

const BodySchema = z.object({
  checks: z
    .array(
      z.object({
        urn: z.string().min(1),
        action: z.enum(["read", "write", "administer"]),
      })
    )
    .min(1)
    .max(100),
})

/**
 * §4 checkAccessBatch — POST /entitlements/access-batch/{mxid}
 * Body `{ checks: [{ urn, action }] }`; returns `[{ allowed, source }]` in the
 * SAME ORDER as the input.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!requireEntitlementsAuth(req, res)) return

  const mxid = decodeMxid(req.params.mxid)
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      code: "bad_request",
      message: "Invalid access-batch payload",
      details: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const results = await service.checkAccessBatch(mxid, parsed.data.checks)
  return res.json(results)
}
