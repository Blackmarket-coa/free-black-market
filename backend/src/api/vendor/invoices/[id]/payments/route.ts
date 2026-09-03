import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../../shared/logger"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../../../../modules/accounts-receivable"
import type AccountsReceivableService from "../../../../../modules/accounts-receivable/service"
import { InvoiceStateError } from "../../../../../modules/accounts-receivable/service"

const log = createLogger("api/vendor/invoices/[id]/payments")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * POST /vendor/invoices/:id/payments — record money received.
 *
 * The only way an invoice reaches `paid`. Settling is a consequence of the
 * payments covering the total, so the AR ledger can always say when the money
 * arrived and how — which "mark as paid" never could.
 *
 * `idempotency_key` is required rather than generated. A key the server makes
 * up is unique per request, which is exactly the wrong property: the point is
 * that a retry of the *same* payment collides. The client that knows two
 * requests are the same payment is the client that must name it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const body = (req.body ?? {}) as Record<string, unknown>
  const amount = Number(body.amount ?? 0)
  const idempotencyKey =
    typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : ""

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "a positive amount is required" })
  }
  if (!idempotencyKey) {
    return res.status(400).json({
      message:
        "idempotency_key is required so a retried payment cannot credit the buyer twice",
    })
  }

  const ar = req.scope.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )

  const [row] = (await ar.listInvoices({ id })) as unknown[]
  const invoice = row as { id: string; seller_id: string } | undefined
  if (!invoice || invoice.seller_id !== sellerId) {
    return res.status(404).json({ message: "Invoice not found" })
  }

  try {
    const updated = await ar.recordPayment({
      invoiceId: id,
      amountCents: Math.floor(amount),
      idempotencyKey,
      method: typeof body.method === "string" ? body.method : null,
      reference: typeof body.reference === "string" ? body.reference : null,
      receivedAt:
        typeof body.received_at === "string"
          ? new Date(body.received_at)
          : undefined,
      note: typeof body.note === "string" ? body.note : null,
    })
    return res.status(201).json({ invoice: ar.toView(updated) })
  } catch (err) {
    if (err instanceof InvoiceStateError) {
      return res.status(409).json({ message: err.message })
    }
    log.error("[POST /vendor/invoices/:id/payments] failed", err)
    return res.status(500).json({ message: "Failed to record payment" })
  }
}
