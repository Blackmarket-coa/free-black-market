import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../../../modules/accounts-receivable"
import type AccountsReceivableService from "../../../../modules/accounts-receivable/service"
import { InvoiceStateError } from "../../../../modules/accounts-receivable/service"
import { InvoiceStatus } from "../../../../modules/accounts-receivable/terms"
import { loadTiersForSeller } from "../../../../shared/ar-tiers"
import { isAllowedInvoiceTransition } from "../route"

const log = createLogger("api/vendor/invoices/[id]")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * Load an invoice and prove it belongs to the calling vendor.
 *
 * Returns null having already answered the request. A vendor asking for
 * another vendor's invoice gets a 404, not a 403: confirming that an id
 * exists is itself a disclosure of another vendor's business.
 */
async function loadOwned(
  req: MedusaRequest,
  res: MedusaResponse,
  ar: AccountsReceivableService
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
  const [row] = (await ar.listInvoices({ id })) as unknown[]
  const invoice = row as Parameters<typeof ar.toView>[0] | undefined
  if (!invoice || invoice.seller_id !== sellerId) {
    res.status(404).json({ message: "Invoice not found" })
    return null
  }
  return { sellerId, invoice }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const ar = req.scope.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )
  const owned = await loadOwned(req, res, ar)
  if (!owned) return

  const payments = await ar.listInvoicePayments({
    invoice_id: owned.invoice.id,
  })

  return res.json({ invoice: ar.toView(owned.invoice), payments })
}

/**
 * PATCH /vendor/invoices/:id — move an invoice through its lifecycle.
 *
 * `paid` is deliberately not reachable here: it is what recording enough
 * payment produces, not something a vendor asserts. See the transition table.
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const ar = req.scope.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )
  const owned = await loadOwned(req, res, ar)
  if (!owned) return

  const body = (req.body ?? {}) as { status?: string; reason?: string }
  const target = (body.status ?? "").trim().toLowerCase()
  const normalized = target === "sent" ? InvoiceStatus.ISSUED : target

  if (!normalized) {
    return res.status(400).json({ message: "status is required" })
  }
  if (normalized === InvoiceStatus.PAID) {
    return res.status(400).json({
      message:
        "record a payment against this invoice instead — POST /vendor/invoices/:id/payments",
    })
  }
  if (!isAllowedInvoiceTransition(owned.invoice.status, normalized)) {
    return res.status(400).json({
      message: `Invalid transition ${owned.invoice.status} -> ${normalized}`,
    })
  }

  try {
    if (normalized === InvoiceStatus.ISSUED) {
      const tiers = await loadTiersForSeller(req.scope, owned.sellerId)
      const issued = await ar.issue({ invoiceId: owned.invoice.id, tiers })
      return res.json({ invoice: ar.toView(issued) })
    }
    if (normalized === InvoiceStatus.VOID) {
      const voided = await ar.void(owned.invoice.id, body.reason)
      return res.json({ invoice: ar.toView(voided) })
    }
    if (normalized === InvoiceStatus.WRITTEN_OFF) {
      const written = await ar.writeOff(owned.invoice.id, body.reason)
      return res.json({ invoice: ar.toView(written) })
    }
    return res.status(400).json({ message: `Unsupported status ${normalized}` })
  } catch (err) {
    if (err instanceof InvoiceStateError) {
      return res.status(409).json({ message: err.message })
    }
    log.error("[PATCH /vendor/invoices/:id] failed", err)
    return res.status(500).json({ message: "Failed to update invoice" })
  }
}
