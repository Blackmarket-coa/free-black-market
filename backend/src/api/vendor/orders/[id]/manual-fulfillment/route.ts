import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { SUPPLIER_FORWARDING_MODULE } from "../../../../../modules/supplier-forwarding"
import SupplierForwardingModuleService from "../../../../../modules/supplier-forwarding/service"
import { ManualFulfillmentStatus } from "../../../../../modules/supplier-forwarding/models"

const transitionSchema = z.object({
  supplier_id: z.string().optional(),
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

/**
 * Verify the calling seller owns the order and return the order (with its
 * supplier metadata) for downstream use. On denial the appropriate response is
 * sent and `null` is returned.
 *
 * Ownership model matches the rest of the marketplace (see
 * `api/vendor/farm/grower-dashboard`): a seller owns an order when at least one
 * of the order's line items is for one of that seller's products. Without this
 * check any authenticated vendor could read/drive the manual-fulfillment state
 * machine for any order id and forge a supplier transition.
 */
type SellerRow = { id?: string; products?: Array<{ id?: string | null }> }
type OwnedOrder = {
  id: string
  metadata?: Record<string, unknown> | null
  items?: Array<{ product_id?: string | null }>
}

async function loadOwnedOrder(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<{ order: OwnedOrder } | null> {
  const sellerId = (
    req as unknown as { auth_context?: { actor_id?: string } }
  ).auth_context?.actor_id
  if (!sellerId) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as {
    graph: <T = unknown>(a: Record<string, unknown>) => Promise<{ data: T[] }>
  }

  const { data: sellers } = await query.graph<SellerRow>({
    entity: "seller",
    fields: ["id", "products.id"],
    filters: { id: sellerId },
  })
  const productIds = new Set<string>(
    (sellers?.[0]?.products ?? [])
      .map((p) => p?.id)
      .filter((x): x is string => !!x)
  )

  const { data: orders } = await query.graph<OwnedOrder>({
    entity: "order",
    fields: ["id", "metadata", "items.product_id"],
    filters: { id: req.params.id },
  })
  const order = orders?.[0]
  if (!order) {
    res.status(404).json({ message: "Order not found" })
    return null
  }

  const owns = (order.items ?? []).some(
    (it) => it.product_id && productIds.has(it.product_id)
  )
  if (!owns) {
    res.status(403).json({ message: "Access denied" })
    return null
  }

  return { order }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const loaded = await loadOwnedOrder(req, res)
  if (!loaded) return

  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  const updates = await service.listManualFulfillmentUpdates({ order_id: req.params.id })
  res.json({ updates })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const loaded = await loadOwnedOrder(req, res)
  if (!loaded) return

  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  const body = transitionSchema.parse(req.body)

  // Derive the supplier from the order rather than trusting the request body;
  // fall back to the body only when the order carries no supplier metadata.
  const orderSupplierId = loaded.order.metadata?.supplier_id as string | undefined
  const supplierId = orderSupplierId || body.supplier_id
  if (!supplierId) {
    return res.status(400).json({ error: "No supplier associated with this order" })
  }
  if (orderSupplierId && body.supplier_id && body.supplier_id !== orderSupplierId) {
    return res.status(403).json({ error: "supplier_id does not match this order" })
  }

  const [latest] = await service.listManualFulfillmentUpdates(
    { order_id: req.params.id, supplier_id: supplierId },
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
    supplier_id: supplierId,
    status: body.next_status,
    notes: body.notes,
    source: "manual_ui",
  })

  return res.status(201).json({ update })
}
