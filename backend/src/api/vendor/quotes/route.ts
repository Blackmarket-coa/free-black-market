import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../shared/logger"
import { QUOTE_MODULE } from "../../../modules/quote"
import type QuoteService from "../../../modules/quote/service"
import {
  QuotePricingError,
  QuoteStateError,
  type QuoteLineInput,
} from "../../../modules/quote/pricing"

const log = createLogger("api/vendor/quotes")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/** GET /vendor/quotes — this vendor's quotes. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)

  const filters: Record<string, unknown> = { seller_id: sellerId }
  if (typeof req.query.status === "string") filters.status = req.query.status
  if (typeof req.query.customer_id === "string") {
    filters.customer_id = req.query.customer_id
  }

  const rows = (await service.listQuotes(filters)) as unknown[]
  const now = new Date()
  const quotes = await Promise.all(
    rows.map((row) => service.view(row as Parameters<typeof service.view>[0], now))
  )

  return res.json({ quotes })
}

/**
 * POST /vendor/quotes — quote a buyer.
 *
 * Creates a draft and, unless `send: false`, sends it and starts the validity
 * clock. `request_id` links the quote back to the RFQ it answers, so the
 * demand side and the priced offer are one thread rather than two.
 *
 * Prices are taken as given: the vendor decides what to charge. What the
 * platform enforces is that they are whole cents on whole units, and that no
 * line pretends to negotiate FBM's own commission.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.body ?? {}) as Record<string, unknown>
  const customerId =
    typeof body.customer_id === "string" ? body.customer_id.trim() : ""
  const rawLines = Array.isArray(body.lines) ? body.lines : []

  if (!customerId) {
    return res.status(400).json({ message: "customer_id is required" })
  }
  if (!rawLines.length) {
    return res.status(400).json({ message: "at least one line is required" })
  }

  const lines: QuoteLineInput[] = rawLines.map((raw) => {
    const line = (raw ?? {}) as Record<string, unknown>
    return {
      variant_id: String(line.variant_id ?? ""),
      title: typeof line.title === "string" ? line.title : null,
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_price),
      list_unit_price:
        line.list_unit_price === undefined || line.list_unit_price === null
          ? null
          : Number(line.list_unit_price),
    }
  })

  if (lines.some((l) => !l.variant_id)) {
    return res
      .status(400)
      .json({ message: "every line needs a variant_id to be buyable" })
  }

  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)

  try {
    const draft = await service.createDraft({
      sellerId,
      customerId,
      requestId: typeof body.request_id === "string" ? body.request_id : null,
      currencyCode:
        typeof body.currency_code === "string" ? body.currency_code : "usd",
      lines,
      notes: typeof body.notes === "string" ? body.notes : null,
    })

    if (body.send === false) {
      return res.status(201).json({ quote: await service.view(draft) })
    }

    const sent = await service.send({
      quoteId: draft.id,
      ...(typeof body.validity_days === "number"
        ? { validityDays: body.validity_days }
        : {}),
    })
    return res.status(201).json({ quote: await service.view(sent) })
  } catch (err) {
    if (err instanceof QuotePricingError || err instanceof QuoteStateError) {
      return res.status(400).json({ message: err.message })
    }
    log.error("[POST /vendor/quotes] failed", err)
    return res.status(500).json({ message: "Failed to create quote" })
  }
}
