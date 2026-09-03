import { MedusaService } from "@medusajs/framework/utils"
import { Quote, QuoteLine } from "./models"
import {
  DEFAULT_VALIDITY_DAYS,
  QuoteStateError,
  QuoteStatus,
  assertQuoteCarriesNoCommission,
  assertQuoteTransition,
  canAccept,
  deriveValidUntil,
  isExpired,
  priceLine,
  totalQuote,
  type QuoteLineInput,
  type QuoteTotals,
} from "./pricing"

export { QuoteStateError }

type QuoteRow = {
  id: string
  seller_id: string
  customer_id: string
  request_id: string | null
  quote_number: string
  status: QuoteStatus
  currency_code: string
  subtotal: number
  list_subtotal: number
  sent_at: Date | null
  valid_until: Date | null
  accepted_at: Date | null
  cart_id: string | null
  order_id: string | null
  resolution_note: string | null
  notes: string | null
}

export type QuoteView = QuoteRow & {
  savings: number
  is_expired: boolean
  can_accept: boolean
  /** Longest stated lead time across the lines; null when none stated. */
  max_lead_time_days: number | null
  lines: unknown[]
}

/**
 * Quotes: a vendor's priced offer to a buyer, and the path from an RFQ to a
 * cart at the agreed prices.
 *
 * The pricing and lifecycle rules live in `pricing.ts` as pure functions so
 * they assert to the cent without a container. This class is the I/O.
 *
 * **It never computes commission.** The quoted price is what the buyer pays;
 * FBM's 3% is applied downstream from the order, and only on native sales.
 */
class QuoteService extends MedusaService({
  Quote,
  QuoteLine,
}) {
  /**
   * Per-seller quote reference. Same reasoning as AR invoice numbers: a
   * vendor's quote numbers are their own business record, and a global
   * sequence would leak the platform's volume through every vendor's
   * paperwork.
   */
  async nextQuoteNumber(sellerId: string): Promise<string> {
    const existing = (await this.listQuotes(
      { seller_id: sellerId },
      { select: ["quote_number"], take: null }
    )) as unknown as { quote_number: string }[]

    let highest = 0
    for (const row of existing) {
      const match = /^Q-(\d+)$/.exec(row.quote_number ?? "")
      if (!match) continue
      const n = Number(match[1])
      if (Number.isFinite(n) && n > highest) highest = n
    }
    return `Q-${String(highest + 1).padStart(5, "0")}`
  }

  /** Totals recomputed from the stored lines — never trusted from the header. */
  async totalsFor(quoteId: string): Promise<QuoteTotals> {
    const lines = (await this.listQuoteLines({
      quote_id: quoteId,
    })) as unknown as QuoteLineInput[]
    return totalQuote(lines)
  }

  private async syncTotals(quoteId: string): Promise<QuoteTotals> {
    const totals = await this.totalsFor(quoteId)
    await this.updateQuotes({
      id: quoteId,
      subtotal: totals.subtotal,
      list_subtotal: totals.list_subtotal,
    })
    return totals
  }

  async view(row: QuoteRow, now: Date = new Date()): Promise<QuoteView> {
    const lines = await this.listQuoteLines({ quote_id: row.id })
    const leads = (lines as unknown as { lead_time_days?: number | null }[])
      .map((l) => l.lead_time_days)
      .filter((d): d is number => typeof d === "number" && Number.isFinite(d))
    return {
      ...row,
      max_lead_time_days: leads.length ? Math.max(...leads) : null,
      savings: Math.max(
        0,
        Math.floor(Number(row.list_subtotal) || 0) -
          Math.floor(Number(row.subtotal) || 0)
      ),
      is_expired: isExpired(row, now),
      can_accept: canAccept(row, now),
      lines: lines as unknown[],
    }
  }

  /**
   * Create a draft quote with its lines.
   *
   * Lines are priced through `priceLine` on the way in, so a bad quantity or
   * a fractional cent is refused at creation rather than discovered when the
   * buyer's cart total disagrees with the quote they accepted.
   */
  async createDraft(args: {
    sellerId: string
    customerId: string
    requestId?: string | null
    currencyCode?: string
    lines: readonly QuoteLineInput[]
    notes?: string | null
  }): Promise<QuoteRow> {
    if (!args.lines.length) {
      throw new QuoteStateError("a quote needs at least one line")
    }
    assertQuoteCarriesNoCommission(args.lines as never)

    const priced = args.lines.map(priceLine)
    const totals = totalQuote(priced)

    const [quote] = await this.createQuotes([
      {
        seller_id: args.sellerId,
        customer_id: args.customerId,
        request_id: args.requestId ?? null,
        quote_number: await this.nextQuoteNumber(args.sellerId),
        status: QuoteStatus.DRAFT,
        currency_code: (args.currencyCode ?? "usd").toLowerCase(),
        subtotal: totals.subtotal,
        list_subtotal: totals.list_subtotal,
        notes: args.notes ?? null,
      },
    ])

    const row = quote as unknown as QuoteRow

    await this.createQuoteLines(
      priced.map((line) => ({
        quote_id: row.id,
        variant_id: line.variant_id,
        title: line.title ?? null,
        quantity: line.quantity,
        unit_price: line.unit_price,
        list_unit_price: line.list_unit_price,
        lead_time_days: line.lead_time_days ?? null,
      }))
    )

    return row
  }

  /** Replace a draft's lines. Refused once the buyer has seen the quote. */
  async replaceLines(
    quoteId: string,
    lines: readonly QuoteLineInput[]
  ): Promise<QuoteTotals> {
    const row = await this.requireQuote(quoteId)
    if (row.status !== QuoteStatus.DRAFT) {
      throw new QuoteStateError(
        `only a draft quote can be re-priced (this one is ${row.status})`
      )
    }
    if (!lines.length) {
      throw new QuoteStateError("a quote needs at least one line")
    }
    assertQuoteCarriesNoCommission(lines as never)

    const priced = lines.map(priceLine)
    const existing = (await this.listQuoteLines({
      quote_id: quoteId,
    })) as unknown as { id: string }[]
    if (existing.length) {
      await this.deleteQuoteLines(existing.map((l) => l.id))
    }
    await this.createQuoteLines(
      priced.map((line) => ({
        quote_id: quoteId,
        variant_id: line.variant_id,
        title: line.title ?? null,
        quantity: line.quantity,
        unit_price: line.unit_price,
        list_unit_price: line.list_unit_price,
        lead_time_days: line.lead_time_days ?? null,
      }))
    )

    return this.syncTotals(quoteId)
  }

  /** Send a draft to the buyer and start its clock. */
  async send(args: {
    quoteId: string
    validityDays?: number
    now?: Date
  }): Promise<QuoteRow> {
    const now = args.now ?? new Date()
    const row = await this.requireQuote(args.quoteId)
    assertQuoteTransition(row.status, QuoteStatus.SENT)

    const lineCount = (
      (await this.listQuoteLines({ quote_id: row.id })) as unknown[]
    ).length
    if (lineCount === 0) {
      throw new QuoteStateError("cannot send a quote with no lines")
    }

    await this.syncTotals(row.id)
    await this.updateQuotes({
      id: row.id,
      status: QuoteStatus.SENT,
      sent_at: now,
      valid_until: deriveValidUntil(
        now,
        args.validityDays ?? DEFAULT_VALIDITY_DAYS
      ),
    })
    return this.requireQuote(row.id)
  }

  /**
   * Accept a quote on the buyer's behalf.
   *
   * The caller supplies `cartId` because building the cart needs the Medusa
   * cart module and the price-override pattern from
   * `api/store/carts/[id]/wholesale` — module code has no business reaching
   * for those. This method owns the decision (may it be accepted?) and the
   * record; the route owns the materialization.
   *
   * Expiry is checked against the clock, not against stored status: the sweep
   * runs on a schedule, and a buyer accepting a second after the deadline is
   * refused by the date rather than by whether a cron job has run.
   */
  async accept(args: {
    quoteId: string
    cartId: string
    now?: Date
  }): Promise<QuoteRow> {
    const now = args.now ?? new Date()
    const row = await this.requireQuote(args.quoteId)

    if (!canAccept(row, now)) {
      throw new QuoteStateError(
        isExpired(row, now)
          ? "this quote has expired"
          : `a quote in ${row.status} cannot be accepted`
      )
    }
    assertQuoteTransition(row.status, QuoteStatus.ACCEPTED)

    await this.updateQuotes({
      id: row.id,
      status: QuoteStatus.ACCEPTED,
      accepted_at: now,
      cart_id: args.cartId,
    })
    return this.requireQuote(row.id)
  }

  async decline(quoteId: string, note?: string): Promise<QuoteRow> {
    const row = await this.requireQuote(quoteId)
    assertQuoteTransition(row.status, QuoteStatus.DECLINED)
    await this.updateQuotes({
      id: row.id,
      status: QuoteStatus.DECLINED,
      resolution_note: note ?? null,
    })
    return this.requireQuote(row.id)
  }

  async withdraw(quoteId: string, note?: string): Promise<QuoteRow> {
    const row = await this.requireQuote(quoteId)
    assertQuoteTransition(row.status, QuoteStatus.WITHDRAWN)
    await this.updateQuotes({
      id: row.id,
      status: QuoteStatus.WITHDRAWN,
      resolution_note: note ?? null,
    })
    return this.requireQuote(row.id)
  }

  /** Quotes whose deadline has passed while still awaiting an answer. */
  async findExpirable(now: Date = new Date()): Promise<QuoteRow[]> {
    const rows = (await this.listQuotes({
      status: QuoteStatus.SENT,
    })) as unknown as QuoteRow[]
    return rows.filter((row) => isExpired(row, now))
  }

  async markExpired(quoteId: string): Promise<void> {
    const row = await this.requireQuote(quoteId)
    assertQuoteTransition(row.status, QuoteStatus.EXPIRED)
    await this.updateQuotes({ id: row.id, status: QuoteStatus.EXPIRED })
  }

  private async requireQuote(quoteId: string): Promise<QuoteRow> {
    const [row] = (await this.listQuotes({
      id: quoteId,
    })) as unknown as QuoteRow[]
    if (!row) throw new QuoteStateError("quote not found")
    return row
  }
}

export default QuoteService
