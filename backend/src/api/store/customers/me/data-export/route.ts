import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"

const log = createLogger("api/store/customers/me/data-export")

/**
 * GET /store/customers/me/data-export  (authenticated customer)
 *
 * CCPA/CPRA "right to know" + data portability: returns everything tied to the
 * requesting customer as one downloadable JSON document — profile, saved
 * addresses, and order history. Scoped strictly to the authenticated actor;
 * never trusts a client-supplied id.
 *
 * Each section is fetched defensively so a schema gap in one area still yields
 * a usable export rather than a 500.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  if (!customerId || !customerId.startsWith("cus_")) {
    return res
      .status(401)
      .json({ message: "Customer authentication required", type: "unauthorized" })
  }

  const query = req.scope.resolve("query")

  let customer: unknown = null
  try {
    const { data } = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "email",
        "first_name",
        "last_name",
        "phone",
        "company_name",
        "created_at",
        "updated_at",
        "metadata",
        "addresses.*",
      ],
      filters: { id: customerId } as any,
    })
    customer = data?.[0] ?? null
  } catch (err) {
    log.warn(`data-export: customer fetch failed for ${customerId}: ${(err as Error).message}`)
  }

  if (!customer) {
    return res.status(404).json({ message: "Customer not found", type: "not_found" })
  }

  let orders: unknown[] = []
  try {
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "created_at",
        "currency_code",
        "email",
        "total",
        "item_total",
        "items.title",
        "items.quantity",
        "items.unit_price",
      ],
      filters: { customer_id: customerId } as any,
    })
    orders = data ?? []
  } catch (err) {
    log.warn(`data-export: order fetch failed for ${customerId}: ${(err as Error).message}`)
  }

  const payload = {
    generated_at: new Date().toISOString(),
    notice:
      "This export contains the personal data Free Black Market holds for your account. " +
      "Retained transaction records may also exist in anonymised form for tax/accounting purposes.",
    customer,
    orders,
    order_count: orders.length,
  }

  log.info(`data export generated for customer ${customerId} (${orders.length} orders)`)

  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fbm-data-export-${customerId}.json"`
  )
  res.status(200).send(JSON.stringify(payload, null, 2))
}
