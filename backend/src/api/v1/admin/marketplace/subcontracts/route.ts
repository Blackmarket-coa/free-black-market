import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_SUBCONTRACT_MODULE } from "../../../../../modules/order-subcontract"
import type OrderSubcontractService from "../../../../../modules/order-subcontract/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1),
    200
  )
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0)
  const filter: Record<string, unknown> = {}
  if (req.query.status) filter.status = req.query.status as string
  if (req.query.parent_seller_id)
    filter.parent_seller_id = req.query.parent_seller_id as string
  if (req.query.subcontract_seller_id)
    filter.subcontract_seller_id = req.query.subcontract_seller_id as string

  const service = req.scope.resolve<OrderSubcontractService>(ORDER_SUBCONTRACT_MODULE)
  const subcontracts = await service.listOrderSubcontracts(filter, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" } as const,
  })
  return res.status(200).json({ subcontracts, limit, offset })
}
