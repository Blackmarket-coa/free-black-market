import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../shared/logger"
import { invoiceSchema } from "../../../shared/phase0-contracts"
import { runQueueConsumer } from "../../../shared/queue-runtime"
import { requeueWithBackoff } from "../../../shared/queue-requeue-adapter"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../../modules/accounts-receivable"
import type AccountsReceivableService from "../../../modules/accounts-receivable/service"
import { InvoiceStateError } from "../../../modules/accounts-receivable/service"
import { InvoiceStatus } from "../../../modules/accounts-receivable/terms"
import { loadTiersForSeller } from "../../../shared/ar-tiers"

const log = createLogger("api/vendor/invoices")

/**
 * Lifecycle transitions the vendor API accepts.
 *
 * Narrower than the model's status set on purpose: `paid` is not something a
 * vendor declares, it is what recording enough payment produces. Marking an
 * invoice paid without a payment row would leave the AR ledger unable to say
 * when the money arrived or how — so payment goes through
 * `POST /vendor/invoices/:id/payments` and this endpoint refuses it.
 */
export const isAllowedInvoiceTransition = (
  from: InvoiceStatus | string,
  to: InvoiceStatus | string
) => {
  // `sent` was this API's name for the issued state before the module landed.
  // Aliasing here rather than only at the request layer keeps the exported
  // predicate's published behaviour intact for existing callers.
  const a = aliasStatus(from)
  const b = aliasStatus(to)
  if (a === b) return true
  const transitions: Record<string, string[]> = {
    [InvoiceStatus.DRAFT]: [InvoiceStatus.ISSUED, InvoiceStatus.VOID],
    [InvoiceStatus.ISSUED]: [InvoiceStatus.VOID, InvoiceStatus.WRITTEN_OFF],
    [InvoiceStatus.PAID]: [],
    [InvoiceStatus.VOID]: [],
    [InvoiceStatus.WRITTEN_OFF]: [],
  }
  return (transitions[a] ?? []).includes(b)
}

const aliasStatus = (value: InvoiceStatus | string): string => {
  const v = String(value).trim().toLowerCase()
  return v === "sent" ? InvoiceStatus.ISSUED : v
}

/**
 * The pre-module API called the issued state `sent`. Kept as an accepted
 * alias so an existing client is not broken by the rename; `issued` is what
 * the module stores and what every response says.
 */
const normalizeStatus = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase()
  if (v === "sent") return InvoiceStatus.ISSUED
  return Object.values(InvoiceStatus).includes(v as InvoiceStatus) ? v : null
}

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * GET /vendor/invoices — this vendor's invoices.
 *
 * Every row carries a derived `presentation_status` and `outstanding`, so a
 * caller never has to recompute "is this overdue" and get it subtly wrong.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const ar = req.scope.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )

  const filters: Record<string, unknown> = { seller_id: sellerId }
  const status = normalizeStatus(req.query.status)
  if (status) filters.status = status
  if (typeof req.query.customer_id === "string") {
    filters.customer_id = req.query.customer_id
  }

  const now = new Date()
  const rows = await ar.listInvoices(filters)
  const invoices = (rows as unknown[]).map((r) =>
    ar.toView(r as Parameters<typeof ar.toView>[0], now)
  )

  return res.json({ invoices })
}

/**
 * POST /vendor/invoices — create an invoice, and optionally issue it now.
 *
 * Issuing is where net terms become real: the buyer's tier decides the terms,
 * the terms decide `due_at`, and `due_at` is what aging and dunning key off.
 * Pass `issue: false` to leave it in draft.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.body ?? {}) as Record<string, unknown>

  // Phase 0 contract: an `invoice_id` payload is a queue message, not an
  // invoice to create. Preserved exactly as it was.
  if (typeof body.invoice_id === "string") {
    const payload = invoiceSchema.parse(body)
    const result = await runQueueConsumer({
      topicKey: "invoice_issuance",
      payload,
      idempotencyKey: payload.invoice_id,
      handler: async () => undefined,
      publishToDlq: async (message) => {
        log.error("[POST /vendor/invoices][DLQ]", JSON.stringify(message))
      },
      requeue: async (message, delaySeconds) => {
        await requeueWithBackoff(message, delaySeconds)
      },
    })
    return res.status(202).json({ result, topic: "invoice.issuance.v1" })
  }

  const total = Number(body.total ?? 0)
  if (!Number.isFinite(total) || total < 0) {
    return res
      .status(400)
      .json({ message: "a non-negative total is required" })
  }

  const ar = req.scope.resolve<AccountsReceivableService>(
    ACCOUNTS_RECEIVABLE_MODULE
  )

  try {
    const draft = await ar.createDraft({
      sellerId,
      customerId:
        typeof body.customer_id === "string" ? body.customer_id : null,
      orderId: typeof body.order_id === "string" ? body.order_id : null,
      totalCents: Math.floor(total),
      currencyCode:
        typeof body.currency_code === "string" ? body.currency_code : "usd",
      memo: typeof body.memo === "string" ? body.memo : null,
    })

    const shouldIssue = body.issue !== false
    if (!shouldIssue) {
      return res.status(201).json({ invoice: ar.toView(draft) })
    }

    const tiers = await loadTiersForSeller(req.scope, sellerId)
    const issued = await ar.issue({
      invoiceId: draft.id,
      tiers,
      ...(typeof body.terms_days === "number"
        ? { termsDaysOverride: body.terms_days }
        : {}),
    })

    return res.status(201).json({ invoice: ar.toView(issued) })
  } catch (err) {
    if (err instanceof InvoiceStateError) {
      return res.status(400).json({ message: err.message })
    }
    log.error("[POST /vendor/invoices] failed", err)
    return res.status(500).json({ message: "Failed to create invoice" })
  }
}
