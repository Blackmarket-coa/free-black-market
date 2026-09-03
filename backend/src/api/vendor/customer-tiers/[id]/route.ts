import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { VENDOR_RULES_MODULE } from "../../../../modules/vendor-rules"
import type VendorRulesService from "../../../../modules/vendor-rules/service"
import { parseTierInput } from "../route"

const log = createLogger("api/vendor/customer-tiers/[id]")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * Load a tier and prove it belongs to the calling vendor. Another vendor's
 * tier 404s rather than 403s — confirming an id exists discloses that a
 * competitor runs a wholesale programme.
 */
async function loadOwned(
  req: MedusaRequest,
  res: MedusaResponse,
  service: VendorRulesService
) {
  const sellerId = getSellerId(req)
  if (!sellerId) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    res.status(400).json({ message: "Missing id" })
    return null
  }
  const [row] = (await service.listVendorCustomerTiers({ id })) as unknown as {
    id: string
    seller_id: string
  }[]
  if (!row || row.seller_id !== sellerId) {
    res.status(404).json({ message: "Tier not found" })
    return null
  }
  return row
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorRulesService>(VENDOR_RULES_MODULE)
  const tier = await loadOwned(req, res, service)
  if (!tier) return
  return res.json({ tier })
}

/**
 * PATCH /vendor/customer-tiers/:id — edit a tier.
 *
 * This is where a vendor says "Net-30 up to $5,000". Changing
 * `payment_terms_days` affects invoices issued from now on only: an invoice
 * copies its terms at issue precisely so a later tier edit cannot rewrite a
 * due date already in a buyer's hands.
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<VendorRulesService>(VENDOR_RULES_MODULE)
  const tier = await loadOwned(req, res, service)
  if (!tier) return

  const parsed = parseTierInput((req.body ?? {}) as Record<string, unknown>, {
    partial: true,
  })
  if (!parsed.ok) return res.status(400).json({ message: parsed.message })
  if (!Object.keys(parsed.data).length) {
    return res.status(400).json({ message: "nothing to update" })
  }

  try {
    await service.updateVendorCustomerTiers({ id: tier.id, ...parsed.data } as never)
    const [updated] = await service.listVendorCustomerTiers({ id: tier.id })
    return res.json({ tier: updated })
  } catch (err) {
    log.error("[PATCH /vendor/customer-tiers/:id] failed", err)
    return res.status(500).json({ message: "Failed to update tier" })
  }
}
