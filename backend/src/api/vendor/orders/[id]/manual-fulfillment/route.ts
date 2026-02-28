import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SUPPLIER_FORWARDING_MODULE } from "../../../../../modules/supplier-forwarding"
import SupplierForwardingModuleService from "../../../../../modules/supplier-forwarding/service"
import { ManualFulfillmentStatus } from "../../../../../modules/supplier-forwarding/models"

const transitionSchema = z.object({
  supplier_id: z.string(),
  next_status: z.nativeEnum(ManualFulfillmentStatus),
  notes: z.string().optional(),
})

const allowedTransitions: Record<ManualFulfillmentStatus, ManualFulfillmentStatus[]> = {
  [ManualFulfillmentStatus.PENDING]: [ManualFulfillmentStatus.ACKNOWLEDGED, ManualFulfillmentStatus.CANCELED],
  [ManualFulfillmentStatus.ACKNOWLEDGED]: [ManualFulfillmentStatus.IN_PROGRESS, ManualFulfillmentStatus.CANCELED],
  [ManualFulfillmentStatus.IN_PROGRESS]: [ManualFulfillmentStatus.SHIPPED, ManualFulfillmentStatus.CANCELED],
  [ManualFulfillmentStatus.SHIPPED]: [ManualFulfillmentStatus.DELIVERED],
  [ManualFulfillmentStatus.DELIVERED]: [],
  [ManualFulfillmentStatus.CANCELED]: [],
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  const updates = await service.listManualFulfillmentUpdates({ order_id: req.params.id })
  res.json({ updates })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  const body = transitionSchema.parse(req.body)

  const [latest] = await service.listManualFulfillmentUpdates(
    { order_id: req.params.id, supplier_id: body.supplier_id },
    { order: { created_at: "DESC" }, take: 1 }
  )

  const currentStatus = latest?.status || ManualFulfillmentStatus.PENDING
  if (!allowedTransitions[currentStatus].includes(body.next_status)) {
    return res.status(400).json({
      error: `Invalid status transition from ${currentStatus} to ${body.next_status}`,
    })
  }

  const update = await service.createManualFulfillmentUpdates({
    order_id: req.params.id,
    supplier_id: body.supplier_id,
    status: body.next_status,
    notes: body.notes,
    source: "manual_ui",
  })

  return res.status(201).json({ update })
}
