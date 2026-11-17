import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import type TenancyModuleService from "../../../../modules/tenancy/service"
import { sellerIdForVendorActor } from "../../../../shared/seller-actor"

type Body = {
  csv: string
  mapping?: Record<string, string>
}

/**
 * Sprint B v1 CSV import — parses + validates rows; returns the preview
 * and any errors. Actual product creation is deferred so this can be
 * wired into the wizard's "Already selling elsewhere?" entry without
 * coupling to listing flows in this pass.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await sellerIdForVendorActor(req.scope, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.validatedBody || req.body || {}) as Body
  if (!body?.csv || typeof body.csv !== "string") {
    return res.status(400).json({ message: "csv (string) is required" })
  }
  const mapping = body.mapping || {
    title: "title",
    price: "price",
    handle: "handle",
    description: "description",
  }

  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const { headers, rows } = service.parseCsvRows(body.csv)
  const result = service.validateMappedRows(headers, rows, mapping)
  return res.json({ ...result, headers, row_count: rows.length })
}
