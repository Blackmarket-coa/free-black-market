import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as any).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  res.json({
    mvp_scope: {
      cart: "Vendor panel cart builds line items against existing order payload shape",
      payment_capture_methods: ["manual", "cash"],
      receipt_export: ["json"],
    },
    endpoint_map: {
      list_orders: "/vendor/hawala/payments",
      create_payment: "/vendor/hawala/payments",
      invoice_flow: "/vendor/invoices",
    },
  })
}
