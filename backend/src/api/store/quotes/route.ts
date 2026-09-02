import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { QUOTE_MODULE } from "../../../modules/quote"
import type QuoteService from "../../../modules/quote/service"
import { QuoteStatus } from "../../../modules/quote/pricing"

const getCustomerId = (req: MedusaRequest) => {
  const auth = (
    req as unknown as {
      auth_context?: { actor_type?: string; actor_id?: string }
    }
  ).auth_context
  return auth?.actor_type === "customer" ? auth.actor_id : undefined
}

/**
 * GET /store/quotes — quotes addressed to the signed-in buyer.
 *
 * Drafts are never listed: a draft is the vendor's working document and the
 * buyer has not been offered it yet. Showing one would let a buyer act on a
 * price the vendor had not decided to make.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)

  const requested =
    typeof req.query.status === "string" ? req.query.status : null
  const visible = [
    QuoteStatus.SENT,
    QuoteStatus.ACCEPTED,
    QuoteStatus.DECLINED,
    QuoteStatus.EXPIRED,
    QuoteStatus.WITHDRAWN,
  ]

  const rows = (await service.listQuotes({
    customer_id: customerId,
    status:
      requested && visible.includes(requested as QuoteStatus)
        ? requested
        : visible,
  })) as unknown[]

  const now = new Date()
  const quotes = await Promise.all(
    rows.map((row) => service.view(row as Parameters<typeof service.view>[0], now))
  )

  return res.json({ quotes })
}
