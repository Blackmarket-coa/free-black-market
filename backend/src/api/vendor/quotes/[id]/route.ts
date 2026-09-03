import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { QUOTE_MODULE } from "../../../../modules/quote"
import type QuoteService from "../../../../modules/quote/service"
import {
  QuotePricingError,
  QuoteStateError,
  QuoteStatus,
  type QuoteLineInput,
} from "../../../../modules/quote/pricing"

const log = createLogger("api/vendor/quotes/[id]")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * Load a quote and prove it belongs to the calling vendor.
 *
 * A vendor asking for another vendor's quote gets a 404, not a 403 —
 * confirming an id exists discloses that another vendor is quoting someone.
 */
async function loadOwned(
  req: MedusaRequest,
  res: MedusaResponse,
  service: QuoteService
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
  const [row] = (await service.listQuotes({ id })) as unknown[]
  const quote = row as Parameters<typeof service.view>[0] | undefined
  if (!quote || quote.seller_id !== sellerId) {
    res.status(404).json({ message: "Quote not found" })
    return null
  }
  return quote
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)
  const quote = await loadOwned(req, res, service)
  if (!quote) return
  return res.json({ quote: await service.view(quote) })
}

/**
 * PATCH /vendor/quotes/:id — re-price a draft, send it, or withdraw it.
 *
 * `accepted` and `declined` are deliberately unreachable here: they are the
 * buyer's answer, and a vendor marking their own quote accepted would put a
 * price in a buyer's cart that the buyer never agreed to.
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)
  const quote = await loadOwned(req, res, service)
  if (!quote) return

  const body = (req.body ?? {}) as Record<string, unknown>
  const status =
    typeof body.status === "string" ? body.status.trim().toLowerCase() : null

  try {
    if (Array.isArray(body.lines)) {
      const lines: QuoteLineInput[] = (body.lines as unknown[]).map((raw) => {
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
          lead_time_days:
            line.lead_time_days === undefined || line.lead_time_days === null
              ? null
              : Number(line.lead_time_days),
        }
      })
      if (lines.some((l) => !l.variant_id)) {
        return res
          .status(400)
          .json({ message: "every line needs a variant_id to be buyable" })
      }
      await service.replaceLines(quote.id, lines)
    }

    if (status === QuoteStatus.ACCEPTED || status === QuoteStatus.DECLINED) {
      return res.status(400).json({
        message:
          "accepting or declining is the buyer's answer — see POST /store/quotes/:id/accept",
      })
    }

    if (status === QuoteStatus.SENT) {
      const sent = await service.send({
        quoteId: quote.id,
        ...(typeof body.validity_days === "number"
          ? { validityDays: body.validity_days }
          : {}),
      })
      return res.json({ quote: await service.view(sent) })
    }

    if (status === QuoteStatus.WITHDRAWN) {
      const withdrawn = await service.withdraw(
        quote.id,
        typeof body.note === "string" ? body.note : undefined
      )
      return res.json({ quote: await service.view(withdrawn) })
    }

    if (status) {
      return res.status(400).json({ message: `Unsupported status ${status}` })
    }

    const [refreshed] = (await service.listQuotes({ id: quote.id })) as unknown[]
    return res.json({
      quote: await service.view(refreshed as Parameters<typeof service.view>[0]),
    })
  } catch (err) {
    if (err instanceof QuoteStateError) {
      return res.status(409).json({ message: err.message })
    }
    if (err instanceof QuotePricingError) {
      return res.status(400).json({ message: err.message })
    }
    log.error("[PATCH /vendor/quotes/:id] failed", err)
    return res.status(500).json({ message: "Failed to update quote" })
  }
}
