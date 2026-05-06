import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { ENTITLEMENT_MODULE } from "../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../modules/entitlement/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const activeOnly = String(req.query.active_only ?? "true") !== "false"
  const entitlements = await service.listForCustomer(customerId, { activeOnly })
  return res.json({ entitlements })
}
