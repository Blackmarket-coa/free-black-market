import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { createCartWorkflow } from "@medusajs/medusa/core-flows"
import { createLogger } from "../../../../../shared/logger"
import { QUOTE_MODULE } from "../../../../../modules/quote"
import type QuoteService from "../../../../../modules/quote/service"
import { QuoteStateError, canAccept } from "../../../../../modules/quote/pricing"
import { resolveRegionIdForCurrency } from "../../../../../lib/blackout-checkout"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../../../../modules/accounts-receivable"
import type AccountsReceivableService from "../../../../../modules/accounts-receivable/service"
import { loadTiersForSeller } from "../../../../../shared/ar-tiers"
import {
  BASE_UNIT_PRICE_METADATA_KEY,
  BASE_CURRENCY_METADATA_KEY,
} from "../../../../../lib/sliding-scale"

const log = createLogger("api/store/quotes/[id]/accept")

/** Marks a line item as priced by an accepted quote, for downstream accounting. */
export const QUOTE_ID_METADATA_KEY = "quote_id"

const getCustomerId = (req: MedusaRequest) => {
  const auth = (
    req as unknown as {
      auth_context?: { actor_type?: string; actor_id?: string }
    }
  ).auth_context
  return auth?.actor_type === "customer" ? auth.actor_id : undefined
}

/**
 * POST /store/quotes/:id/accept — take the offer, at the price offered.
 *
 * The hop the platform was missing. A quote becomes a real cart whose line
 * items carry the negotiated prices, so the buyer checks out through the
 * ordinary flow and everything downstream — payouts, the 3% on native sales,
 * AR if the buyer is on terms — behaves exactly as it does for any other
 * order.
 *
 * Pricing mechanics follow `api/store/carts/[id]/wholesale`: the cart is built
 * from the real variants, then each line's `unit_price` is overridden with
 * `is_custom_price: true` so Medusa's pricing flow respects the agreed number
 * rather than recalculating it from the price set. The catalogue price at
 * acceptance is stashed under the shared sliding-scale base key (tagged with
 * its currency) for downstream accounting.
 *
 * **Expiry is decided by the clock, not by stored status.** The sweep runs on
 * a schedule; a buyer accepting a second after the deadline is refused by the
 * date rather than by whether a cron job has run yet.
 *
 * **Idempotent.** An already-accepted quote returns its existing cart instead
 * of building a second one — a double-clicked Accept must not produce two
 * carts at negotiated prices.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) return res.status(401).json({ message: "Unauthorized" })

  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const service = req.scope.resolve<QuoteService>(QUOTE_MODULE)

  const [row] = (await service.listQuotes({ id })) as unknown[]
  const quote = row as
    | {
        id: string
        seller_id: string
        customer_id: string
        currency_code: string
        status: string
        subtotal: number
        valid_until: Date | null
        cart_id: string | null
      }
    | undefined

  // A quote addressed to someone else is not found, not forbidden: confirming
  // the id exists would disclose that this buyer was quoted.
  if (!quote || quote.customer_id !== customerId) {
    return res.status(404).json({ message: "Quote not found" })
  }

  if (quote.cart_id) {
    return res.json({
      quote: await service.view(quote as never),
      cart_id: quote.cart_id,
      already_accepted: true,
    })
  }

  const now = new Date()
  if (!canAccept(quote as never, now)) {
    return res.status(409).json({
      message:
        quote.status === "sent"
          ? "This quote has expired."
          : `A quote in ${quote.status} cannot be accepted.`,
    })
  }

  const lines = (await service.listQuoteLines({
    quote_id: quote.id,
  })) as unknown as {
    variant_id: string
    quantity: number
    unit_price: number
    list_unit_price: number | null
  }[]

  if (!lines.length) {
    return res.status(409).json({ message: "This quote has no lines." })
  }

  const currency = (quote.currency_code || "usd").toLowerCase()

  // Credit standing with THIS vendor, before a cart is built at negotiated
  // prices. This is the first production caller of the credit check that AR
  // shipped: a buyer sitting on a past-due invoice with the vendor is refused,
  // and a vendor who has set a ceiling has it honoured against what the buyer
  // already owes. A vendor who runs no limit (the default) is untouched.
  //
  // Honest scope note: the cart still pays through ordinary checkout, so
  // accepting a quote does not itself add to exposure today — the ceiling
  // arithmetic only bites once a pay-later checkout exists. The past-due gate
  // bites now, and is the reason to check here rather than nowhere.
  try {
    const tiers = await loadTiersForSeller(req.scope, quote.seller_id)
    const ar = req.scope.resolve<AccountsReceivableService>(
      ACCOUNTS_RECEIVABLE_MODULE
    )
    const credit = await ar.checkCreditLimit({
      sellerId: quote.seller_id,
      customerId,
      tiers,
      chargeCents: Math.floor(Number(quote.subtotal) || 0),
      now,
    })
    if (!credit.allowed) {
      return res.status(409).json({
        message:
          credit.reason === "past_due"
            ? "You have an overdue invoice with this vendor. Settle it before accepting a new quote."
            : "Accepting this quote would exceed the credit limit this vendor has set for you.",
        type: "credit_limit",
        decision: credit,
      })
    }
  } catch (err) {
    // A credit read failing must not block a buyer who is not on credit at
    // all; log it and let ordinary checkout proceed.
    log.warn(`[quote-accept] credit check failed for quote ${quote.id}`, err)
  }

  try {
    const regionId = await resolveRegionIdForCurrency(req.scope, currency)
    if (!regionId) {
      log.error(`[quote-accept] no region for currency ${currency}`)
      return res
        .status(409)
        .json({ message: `No region is configured for currency ${currency}` })
    }

    const { result: cart } = await createCartWorkflow(req.scope).run({
      input: {
        region_id: regionId,
        customer_id: customerId,
        currency_code: currency,
        items: lines.map((line) => ({
          variant_id: line.variant_id,
          quantity: line.quantity,
          metadata: { [QUOTE_ID_METADATA_KEY]: quote.id },
        })),
        metadata: { quote_id: quote.id, quote_priced: true },
      },
    })

    const cartId = (cart as { id: string }).id

    // Re-read the created line items: the workflow assigns their ids, and the
    // override has to target those rather than the input order.
    const cartModule: any = req.scope.resolve(Modules.CART)
    const [created] = await cartModule.listCarts(
      { id: cartId },
      { relations: ["items"] }
    )

    const items = ((created?.items ?? []) as {
      id: string
      variant_id: string | null
      unit_price: number | string
      metadata: Record<string, unknown> | null
    }[]).slice()

    // One quote line can only be matched by one cart item, so matched items
    // are consumed. Without that, two lines for the same variant would both
    // bind to the first item and the second price would be lost.
    const updates: {
      id: string
      unit_price: number
      is_custom_price: boolean
      metadata: Record<string, unknown>
    }[] = []

    for (const line of lines) {
      const index = items.findIndex((i) => i.variant_id === line.variant_id)
      if (index === -1) continue
      const [item] = items.splice(index, 1)

      updates.push({
        id: item.id,
        unit_price: line.unit_price,
        is_custom_price: true,
        metadata: {
          ...(item.metadata ?? {}),
          [QUOTE_ID_METADATA_KEY]: quote.id,
          [BASE_UNIT_PRICE_METADATA_KEY]:
            line.list_unit_price ?? Math.floor(Number(item.unit_price) || 0),
          [BASE_CURRENCY_METADATA_KEY]: currency,
        },
      })
    }

    if (updates.length !== lines.length) {
      // Every quoted line must reach the cart at its quoted price. A partial
      // cart would silently charge catalogue price for the rest, which is
      // worse than refusing: the buyer agreed to the whole basket.
      log.error(
        `[quote-accept] quote ${quote.id}: ${updates.length}/${lines.length} lines matched cart items`
      )
      return res.status(409).json({
        message:
          "Some quoted items are no longer available. The vendor needs to re-quote.",
      })
    }

    await cartModule.updateLineItems(updates)

    const accepted = await service.accept({
      quoteId: quote.id,
      cartId,
      now,
    })

    return res.status(201).json({
      quote: await service.view(accepted),
      cart_id: cartId,
    })
  } catch (err) {
    if (err instanceof QuoteStateError) {
      return res.status(409).json({ message: err.message })
    }
    log.error("[POST /store/quotes/:id/accept] failed", err)
    return res.status(500).json({ message: "Failed to accept quote" })
  }
}
