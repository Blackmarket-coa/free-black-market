import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SUPPLIER_FORWARDING_MODULE } from "../../../../modules/supplier-forwarding"
import SupplierForwardingModuleService from "../../../../modules/supplier-forwarding/service"
import { ManualFulfillmentStatus } from "../../../../modules/supplier-forwarding/models"

const schema = z.object({
  order_id: z.string(),
  supplier_id: z.string(),
  status: z.nativeEnum(ManualFulfillmentStatus),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  const body = schema.parse(req.body)

  const update = await service.createManualFulfillmentUpdates({
    order_id: body.order_id,
    supplier_id: body.supplier_id,
    status: body.status,
    notes: body.notes,
    source: "supplier_webhook",
    metadata: body.metadata,
  })

  return res.json({ received: true, update })
}
