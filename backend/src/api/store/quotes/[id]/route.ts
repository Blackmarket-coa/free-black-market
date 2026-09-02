import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { QUOTE_MODULE } from "../../../../modules/quote"
import type QuoteService from "../../../../modules/quote/service"
import { QuoteStateError, QuoteStatus } from "../../../../modules/quote/pricing"

const log = createLogger("api/store/quotes/[id]")

const getCustomerId = (req: MedusaRequest) => {
  const auth = (
    req as unknown as {
      auth_context?: { actor_type?: string; actor_id?: string }
    }
  ).auth_context
  return auth?.actor_type === "customer" ? auth.actor_id : undefined
}

async function loadAddressed(
  req: MedusaRequest,
  res: MedusaResponse,
  service: QuoteService
) {
  const customerId = getCustomerId(req)
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }
  const id = (req.params as { id?: string })?.id
  if (!id) {
    res.status(400).json({ message: "Missing id" })
    return null
  }
  const [row] = (await service.listQuotes({ id })) as unknown[]
  const quote = row as Parameters<typeof service.view>[0] | undefined

  // A draft is the vendor's working document: to the buyer it does not exist
  // yet, so it 404s rather than 403s alongside another buyer's quote.
  if (
    !quote ||
    quote.customer_id !== customerId ||
    quote.status === QuoteStatus.DRAFT
  ) {
    res.status(404).json({ message: "Quote not found" })
    return null
  }
  return quote
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)
  const quote = await loadAddressed(req, res, service)
  if (!quote) return
  return res.json({ quote: await service.view(quote) })
}

/**
 * POST /store/quotes/:id — decline the offer.
 *
 * Accepting lives at `/accept` because it materializes a cart; declining is
 * just an answer, so it stays here.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)
  const quote = await loadAddressed(req, res, service)
  if (!quote) return

  const body = (req.body ?? {}) as { action?: string; note?: string }
  if (body.action !== "decline") {
    return res.status(400).json({
      message: "Unsupported action. Use POST /store/quotes/:id/accept to accept.",
    })
  }

  try {
    const declined = await service.decline(quote.id, body.note)
    return res.json({ quote: await service.view(declined) })
  } catch (err) {
    if (err instanceof QuoteStateError) {
      return res.status(409).json({ message: err.message })
    }
    log.error("[POST /store/quotes/:id] failed", err)
    return res.status(500).json({ message: "Failed to decline quote" })
  }
}
