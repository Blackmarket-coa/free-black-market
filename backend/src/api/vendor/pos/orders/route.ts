import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/pos/orders")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { VendorRequest } from "../../types"
import { createPosOrderWorkflow } from "../../../../workflows/pos/create-pos-order"

const ItemSchema = z
  .object({
    variant_id: z.string().min(1).optional(),
    product_id: z.string().min(1).optional(),
    title: z.string().min(1).max(300).optional(),
    quantity: z.number().int().min(1).default(1),
    unit_price: z.number().min(0),
  })
  .refine((i) => !!i.variant_id || !!i.title, {
    message: "each item needs a variant_id or a title",
  })

const Schema = z.object({
  items: z.array(ItemSchema).min(1),
  currency_code: z.string().length(3).optional(),
  region_id: z.string().optional(),
  sales_channel_id: z.string().optional(),
  customer_id: z.string().optional(),
  email: z.string().email().optional(),
  payment_method: z.enum(["cash", "manual", "card", "other"]).default("cash"),
  note: z.string().max(2000).optional(),
})

/**
 * POST /vendor/pos/orders
 *
 * Ring up an in-person sale as a real order (roadmap Phase 3A / §1.7). Unlike
 * `/vendor/pos/checkout` (a vendor-to-vendor hawala payment with no order),
 * this creates an order stamped `order_channel: "pos"` and emits
 * `order.placed`, so the sale shows up in order history, channel analytics,
 * entitlement grants, and the Blackout order feed. Payment is assumed
 * captured physically at the counter (`payment_method` is recorded on the
 * order metadata for receipts/audits).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId =
    (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid POS order payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  try {
    const { result } = await createPosOrderWorkflow(req.scope).run({
      input: {
        seller_id: sellerId,
        items: parsed.data.items,
        currency_code: parsed.data.currency_code,
        region_id: parsed.data.region_id,
        sales_channel_id: parsed.data.sales_channel_id,
        customer_id: parsed.data.customer_id,
        email: parsed.data.email,
        payment_method: parsed.data.payment_method,
        note: parsed.data.note,
      },
    })

    const order = result.order as {
      id: string
      display_id?: number
      currency_code?: string
    }
    return res.status(201).json({
      order: {
        id: order.id,
        display_id: order.display_id,
        currency_code: order.currency_code,
      },
      channel: "pos",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create POS order"
    const isClientError = /not found|must be|needs a|required/i.test(message)
    if (!isClientError) {
      log.error("[pos/orders] order creation failed", err)
    }
    return res
      .status(isClientError ? 400 : 500)
      .json({ message, type: isClientError ? "invalid_request" : "server_error" })
  }
}
