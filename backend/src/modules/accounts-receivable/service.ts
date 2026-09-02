import { MedusaService } from "@medusajs/framework/utils"
import { Invoice, InvoicePayment } from "./models"
import {
  InvoiceStatus,
  type AgingSummary,
  type CreditDecision,
  type DunningStage,
  type OutstandingInvoice,
  type PresentationStatus,
  type TermsBearingTier,
  creditExposureCents,
  deriveDueDate,
  dunningStageFor,
  evaluateCreditLimit,
  outstandingCents,
  presentationStatus,
  resolveCreditLimitCents,
  resolveTermsDays,
  summarizeAging,
} from "./terms"

export class InvoiceStateError extends Error {}
export class CreditLimitExceededError extends Error {
  constructor(public readonly decision: CreditDecision) {
    super(
      decision.reason === "past_due"
        ? "buyer has a past-due invoice with this vendor"
        : `credit limit exceeded: ${decision.exposure_cents} outstanding against a ${decision.limit_cents} limit`
    )
    this.name = "CreditLimitExceededError"
  }
}

export type InvoiceView = {
  id: string
  invoice_number: string
  seller_id: string
  customer_id: string | null
  order_id: string | null
  status: InvoiceStatus
  presentation_status: PresentationStatus
  currency_code: string
  total: number
  amount_paid: number
  outstanding: number
  terms_days: number
  tier_id: string | null
  issued_at: Date | null
  due_at: Date | null
  paid_at: Date | null
  memo: string | null
}

type InvoiceRow = {
  id: string
  invoice_number: string
  seller_id: string
  customer_id: string | null
  order_id: string | null
  status: InvoiceStatus
  currency_code: string
  total: number
  amount_paid: number
  terms_days: number
  tier_id: string | null
  issued_at: Date | null
  due_at: Date | null
  paid_at: Date | null
  last_dunning_stage: number | null
  memo: string | null
}

/**
 * Accounts receivable: a vendor's invoices to their buyers, and the net terms
 * those invoices are issued under.
 *
 * The policy lives next door in `terms.ts` as pure functions so it can be
 * asserted to the cent without a container. This class is the I/O around it.
 *
 * **It never computes commission.** An invoice says what a buyer owes; FBM's
 * 3% is computed by `payout-breakdown` from the order, and only on native
 * sales (`commission-scope.ts`). Extending terms changes when the platform is
 * paid, never how much.
 */
class AccountsReceivableService extends MedusaService({
  Invoice,
  InvoicePayment,
}) {
  /**
   * Build the buyer-facing view of an invoice, with everything derived.
   *
   * Every read path goes through this so `outstanding` and the presentation
   * status are computed in exactly one place.
   */
  toView(row: InvoiceRow, now: Date = new Date()): InvoiceView {
    const outstanding = outstandingCents(row as OutstandingInvoice)
    return {
      id: row.id,
      invoice_number: row.invoice_number,
      seller_id: row.seller_id,
      customer_id: row.customer_id ?? null,
      order_id: row.order_id ?? null,
      status: row.status,
      presentation_status: presentationStatus(row as OutstandingInvoice, now),
      currency_code: row.currency_code,
      total: Math.floor(Number(row.total) || 0),
      amount_paid: Math.floor(Number(row.amount_paid) || 0),
      outstanding,
      terms_days: Number(row.terms_days) || 0,
      tier_id: row.tier_id ?? null,
      issued_at: row.issued_at ?? null,
      due_at: row.due_at ?? null,
      paid_at: row.paid_at ?? null,
      memo: row.memo ?? null,
    }
  }

  /**
   * Next invoice number for a seller.
   *
   * Per-seller and monotonic, not globally sequential: a vendor's invoice
   * numbers are their own business record and leaking the platform's total
   * order count through them would be both wrong and indiscreet. Collisions
   * are caught by the unique index rather than a lock — a retry lands on the
   * next number.
   */
  async nextInvoiceNumber(sellerId: string): Promise<string> {
    const existing = (await this.listInvoices(
      { seller_id: sellerId },
      { select: ["invoice_number"], take: null }
    )) as unknown as { invoice_number: string }[]

    let highest = 0
    for (const row of existing) {
      const match = /^INV-(\d+)$/.exec(row.invoice_number ?? "")
      if (!match) continue
      const n = Number(match[1])
      if (Number.isFinite(n) && n > highest) highest = n
    }
    return `INV-${String(highest + 1).padStart(5, "0")}`
  }

  /** Every invoice a buyer currently owes this vendor. */
  async openInvoicesFor(
    sellerId: string,
    customerId: string
  ): Promise<InvoiceRow[]> {
    const rows = (await this.listInvoices({
      seller_id: sellerId,
      customer_id: customerId,
      status: [InvoiceStatus.ISSUED],
    })) as unknown as InvoiceRow[]
    return rows
  }

  /**
   * What this buyer owes this vendor right now, in cents.
   */
  async exposureFor(sellerId: string, customerId: string): Promise<number> {
    const rows = await this.openInvoicesFor(sellerId, customerId)
    return creditExposureCents(rows as OutstandingInvoice[])
  }

  /**
   * May this buyer take on more of this vendor's credit?
   *
   * Read-only — the caller decides what to do with a refusal. Used by the
   * quote-acceptance path and by `assertWithinCreditLimit` below.
   */
  async checkCreditLimit(args: {
    sellerId: string
    customerId: string
    tiers: readonly TermsBearingTier[]
    chargeCents: number
    now?: Date
  }): Promise<CreditDecision> {
    const now = args.now ?? new Date()
    const invoices = await this.openInvoicesFor(args.sellerId, args.customerId)
    return evaluateCreditLimit({
      limitCents: resolveCreditLimitCents(args.tiers, args.customerId),
      invoices: invoices as OutstandingInvoice[],
      chargeCents: args.chargeCents,
      now,
    })
  }

  /** As `checkCreditLimit`, but throws on refusal. */
  async assertWithinCreditLimit(args: {
    sellerId: string
    customerId: string
    tiers: readonly TermsBearingTier[]
    chargeCents: number
    now?: Date
  }): Promise<CreditDecision> {
    const decision = await this.checkCreditLimit(args)
    if (!decision.allowed) throw new CreditLimitExceededError(decision)
    return decision
  }

  /**
   * Create an invoice in draft. Nothing is owed and no clock runs until it is
   * issued — a draft is a working document, not a demand for payment.
   */
  async createDraft(args: {
    sellerId: string
    customerId?: string | null
    orderId?: string | null
    totalCents: number
    currencyCode?: string
    memo?: string | null
    metadata?: Record<string, unknown> | null
  }): Promise<InvoiceRow> {
    const total = Math.floor(Number(args.totalCents))
    if (!Number.isFinite(total) || total < 0) {
      throw new InvoiceStateError("invoice total must be a non-negative amount")
    }

    const [row] = await this.createInvoices([
      {
        seller_id: args.sellerId,
        customer_id: args.customerId ?? null,
        order_id: args.orderId ?? null,
        invoice_number: await this.nextInvoiceNumber(args.sellerId),
        status: InvoiceStatus.DRAFT,
        currency_code: (args.currencyCode ?? "usd").toLowerCase(),
        total,
        amount_paid: 0,
        terms_days: 0,
        memo: args.memo ?? null,
        metadata: (args.metadata ?? null) as Record<string, unknown> | null,
      },
    ])
    return row as unknown as InvoiceRow
  }

  /**
   * Issue an invoice: fix its terms, derive its due date, start the clock.
   *
   * This is the method the whole module exists for. `payment_terms_days` was
   * stored on the buyer's tier and read by nothing; here it is read, copied
   * onto the invoice (so a later tier change cannot rewrite a due date already
   * in the buyer's hands), and turned into a real `due_at` that aging and
   * dunning key off.
   */
  async issue(args: {
    invoiceId: string
    tiers: readonly TermsBearingTier[]
    now?: Date
    /** Override the tier-derived terms, for a one-off arrangement. */
    termsDaysOverride?: number
  }): Promise<InvoiceRow> {
    const now = args.now ?? new Date()
    const [row] = (await this.listInvoices({
      id: args.invoiceId,
    })) as unknown as InvoiceRow[]

    if (!row) throw new InvoiceStateError("invoice not found")
    if (row.status !== InvoiceStatus.DRAFT) {
      throw new InvoiceStateError(
        `only a draft invoice can be issued (this one is ${row.status})`
      )
    }

    const termsDays =
      args.termsDaysOverride !== undefined
        ? Math.max(0, Math.floor(args.termsDaysOverride))
        : resolveTermsDays(args.tiers, row.customer_id ?? "")

    const tier = row.customer_id
      ? args.tiers.find(
          (t) =>
            t.active !== false &&
            Array.isArray(t.customer_ids) &&
            (t.customer_ids as string[]).includes(row.customer_id as string) &&
            Number(t.payment_terms_days ?? 0) === termsDays
        )
      : undefined

    await this.updateInvoices({
      id: row.id,
      status: InvoiceStatus.ISSUED,
      terms_days: termsDays,
      tier_id: tier?.id ?? null,
      issued_at: now,
      due_at: deriveDueDate(now, termsDays),
    })

    const [updated] = (await this.listInvoices({
      id: row.id,
    })) as unknown as InvoiceRow[]
    return updated
  }

  /**
   * Record a payment against an invoice and settle it if that covers the total.
   *
   * `idempotencyKey` is required, not optional: a retried webhook or a
   * double-clicked "mark paid" must collide on the unique index rather than
   * credit the buyer twice.
   */
  async recordPayment(args: {
    invoiceId: string
    amountCents: number
    idempotencyKey: string
    method?: string | null
    reference?: string | null
    receivedAt?: Date
    note?: string | null
  }): Promise<InvoiceRow> {
    const amount = Math.floor(Number(args.amountCents))
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new InvoiceStateError("a payment must be a positive amount")
    }
    if (!args.idempotencyKey) {
      throw new InvoiceStateError("payments require an idempotency key")
    }

    const [row] = (await this.listInvoices({
      id: args.invoiceId,
    })) as unknown as InvoiceRow[]
    if (!row) throw new InvoiceStateError("invoice not found")

    if (
      row.status === InvoiceStatus.VOID ||
      row.status === InvoiceStatus.WRITTEN_OFF
    ) {
      throw new InvoiceStateError(
        `cannot pay an invoice that is ${row.status}`
      )
    }
    if (row.status === InvoiceStatus.DRAFT) {
      throw new InvoiceStateError("issue the invoice before recording payment")
    }

    // Idempotency is enforced by the unique index; this read makes the common
    // replay a no-op instead of an error the caller has to interpret.
    const existing = (await this.listInvoicePayments({
      idempotency_key: args.idempotencyKey,
    })) as unknown as { id: string }[]
    if (existing.length > 0) {
      const [unchanged] = (await this.listInvoices({
        id: row.id,
      })) as unknown as InvoiceRow[]
      return unchanged
    }

    await this.createInvoicePayments([
      {
        invoice_id: row.id,
        seller_id: row.seller_id,
        amount,
        currency_code: row.currency_code,
        method: args.method ?? null,
        reference: args.reference ?? null,
        received_at: args.receivedAt ?? new Date(),
        idempotency_key: args.idempotencyKey,
        note: args.note ?? null,
      },
    ])

    const total = Math.floor(Number(row.total) || 0)
    // Clamped at the total: an overpayment is a conversation between vendor
    // and buyer, not a negative balance the platform invents.
    const paid = Math.min(total, Math.floor(Number(row.amount_paid) || 0) + amount)
    const settled = paid >= total

    await this.updateInvoices({
      id: row.id,
      amount_paid: paid,
      ...(settled
        ? { status: InvoiceStatus.PAID, paid_at: args.receivedAt ?? new Date() }
        : {}),
    })

    const [updated] = (await this.listInvoices({
      id: row.id,
    })) as unknown as InvoiceRow[]
    return updated
  }

  /** Void an unpaid invoice. Terminal; a voided invoice never ages. */
  async void(invoiceId: string, reason?: string): Promise<InvoiceRow> {
    const [row] = (await this.listInvoices({
      id: invoiceId,
    })) as unknown as InvoiceRow[]
    if (!row) throw new InvoiceStateError("invoice not found")
    if (row.status === InvoiceStatus.PAID) {
      throw new InvoiceStateError("a paid invoice cannot be voided")
    }

    await this.updateInvoices({
      id: row.id,
      status: InvoiceStatus.VOID,
      memo: reason ? `${row.memo ? `${row.memo}\n` : ""}Voided: ${reason}` : row.memo,
    })
    const [updated] = (await this.listInvoices({
      id: row.id,
    })) as unknown as InvoiceRow[]
    return updated
  }

  /**
   * Write off a debt the vendor has given up on.
   *
   * Distinct from voiding: a void says the invoice should never have been
   * owed, a write-off says it was owed and will not be collected. Both stop
   * the aging clock, but only one is a loss, and a vendor's books need to tell
   * them apart.
   */
  async writeOff(invoiceId: string, reason?: string): Promise<InvoiceRow> {
    const [row] = (await this.listInvoices({
      id: invoiceId,
    })) as unknown as InvoiceRow[]
    if (!row) throw new InvoiceStateError("invoice not found")
    if (row.status !== InvoiceStatus.ISSUED) {
      throw new InvoiceStateError(
        `only an issued invoice can be written off (this one is ${row.status})`
      )
    }

    await this.updateInvoices({
      id: row.id,
      status: InvoiceStatus.WRITTEN_OFF,
      memo: reason
        ? `${row.memo ? `${row.memo}\n` : ""}Written off: ${reason}`
        : row.memo,
    })
    const [updated] = (await this.listInvoices({
      id: row.id,
    })) as unknown as InvoiceRow[]
    return updated
  }

  /** Standard AR aging for one vendor. */
  async agingFor(sellerId: string, now: Date = new Date()): Promise<AgingSummary> {
    const rows = (await this.listInvoices({
      seller_id: sellerId,
      status: [InvoiceStatus.ISSUED],
    })) as unknown as InvoiceRow[]
    return summarizeAging(rows as OutstandingInvoice[], now)
  }

  /**
   * Invoices that have crossed a dunning stage and not yet been reminded at it.
   *
   * `last_dunning_stage` is what makes the sweep idempotent across a re-run on
   * the same day: the ladder only advances, so a second run the same day finds
   * nothing to send.
   */
  async dueForDunning(
    now: Date = new Date()
  ): Promise<{ invoice: InvoiceRow; stage: DunningStage }[]> {
    const rows = (await this.listInvoices({
      status: [InvoiceStatus.ISSUED],
    })) as unknown as InvoiceRow[]

    const due: { invoice: InvoiceRow; stage: DunningStage }[] = []
    for (const row of rows) {
      const stage = dunningStageFor(row as OutstandingInvoice, now)
      if (stage === null) continue
      if ((row.last_dunning_stage ?? 0) >= stage) continue
      due.push({ invoice: row, stage })
    }
    return due
  }

  /** Mark a reminder as sent, so the sweep does not repeat it. */
  async markDunned(invoiceId: string, stage: DunningStage): Promise<void> {
    await this.updateInvoices({ id: invoiceId, last_dunning_stage: stage })
  }
}

export default AccountsReceivableService
