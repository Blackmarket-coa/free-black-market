import { GET, POST, isAllowedInvoiceTransition } from "../invoices/route"
import { PATCH } from "../invoices/[id]/route"
import { POST as RECORD_PAYMENT } from "../invoices/[id]/payments/route"
import { InvoiceStatus } from "../../../modules/accounts-receivable/terms"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../../modules/accounts-receivable"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

type Row = {
  id: string
  seller_id: string
  customer_id: string | null
  order_id: string | null
  invoice_number: string
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
 * In-memory stand-in for the accounts-receivable module, exercising the real
 * route code against the real policy in `terms.ts`. The service methods used
 * here mirror the module's contract; anything the routes rely on that the
 * module stops providing shows up as a type error, not a silent pass.
 */
const makeFakeAr = () => {
  const rows: Row[] = []
  const payments: { invoice_id: string; amount: number; idempotency_key: string }[] = []
  let seq = 0

  const {
    deriveDueDate,
    outstandingCents,
    presentationStatus,
    resolveTermsDays,
  } = jest.requireActual("../../../modules/accounts-receivable/terms")

  return {
    rows,
    payments,
    service: {
      listInvoices: async (filters: Record<string, any> = {}) =>
        rows.filter((r) =>
          Object.entries(filters).every(([k, v]) =>
            Array.isArray(v)
              ? v.includes((r as any)[k])
              : (r as any)[k] === v
          )
        ),
      listInvoicePayments: async (filters: Record<string, any> = {}) =>
        payments.filter((p) =>
          Object.entries(filters).every(([k, v]) => (p as any)[k] === v)
        ),
      createDraft: async (args: any) => {
        seq += 1
        const row: Row = {
          id: `inv_${seq}`,
          seller_id: args.sellerId,
          customer_id: args.customerId ?? null,
          order_id: args.orderId ?? null,
          invoice_number: `INV-${String(seq).padStart(5, "0")}`,
          status: InvoiceStatus.DRAFT,
          currency_code: (args.currencyCode ?? "usd").toLowerCase(),
          total: args.totalCents,
          amount_paid: 0,
          terms_days: 0,
          tier_id: null,
          issued_at: null,
          due_at: null,
          paid_at: null,
          last_dunning_stage: null,
          memo: args.memo ?? null,
        }
        rows.push(row)
        return row
      },
      issue: async (args: any) => {
        const row = rows.find((r) => r.id === args.invoiceId)!
        const now = args.now ?? new Date()
        const terms =
          args.termsDaysOverride ??
          resolveTermsDays(args.tiers ?? [], row.customer_id ?? "")
        row.status = InvoiceStatus.ISSUED
        row.terms_days = terms
        row.issued_at = now
        row.due_at = deriveDueDate(now, terms)
        return row
      },
      recordPayment: async (args: any) => {
        const row = rows.find((r) => r.id === args.invoiceId)!
        if (payments.some((p) => p.idempotency_key === args.idempotencyKey)) {
          return row
        }
        payments.push({
          invoice_id: row.id,
          amount: args.amountCents,
          idempotency_key: args.idempotencyKey,
        })
        row.amount_paid = Math.min(row.total, row.amount_paid + args.amountCents)
        if (row.amount_paid >= row.total) {
          row.status = InvoiceStatus.PAID
          row.paid_at = new Date()
        }
        return row
      },
      void: async (id: string) => {
        const row = rows.find((r) => r.id === id)!
        row.status = InvoiceStatus.VOID
        return row
      },
      writeOff: async (id: string) => {
        const row = rows.find((r) => r.id === id)!
        row.status = InvoiceStatus.WRITTEN_OFF
        return row
      },
      toView: (row: Row, now: Date = new Date()) => ({
        ...row,
        outstanding: outstandingCents(row),
        presentation_status: presentationStatus(row, now),
      }),
    },
  }
}

const makeReq = (fake: ReturnType<typeof makeFakeAr>, opts: any = {}) => ({
  body: opts.body ?? {},
  query: opts.query ?? {},
  params: opts.params ?? {},
  auth_context: { actor_id: opts.sellerId ?? "seller_123" },
  scope: {
    resolve: (key: string) => {
      if (key === ACCOUNTS_RECEIVABLE_MODULE) return fake.service
      // vendorRules resolves to a bare object; loadTiersForSeller catches the
      // resulting failure and yields no tiers, which is Net-0.
      return {}
    },
  },
})

describe("vendor invoices route: lifecycle", () => {
  it("creates and issues an invoice, deriving a due date", async () => {
    const fake = makeFakeAr()
    const res = createRes()

    await POST(
      makeReq(fake, {
        body: { order_id: "ord_1", total: 4500, currency_code: "USD" },
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.invoice.status).toBe(InvoiceStatus.ISSUED)
    // No tier applies, so Net-0: due at end of the day it was issued.
    expect(res.body.invoice.terms_days).toBe(0)
    expect(res.body.invoice.due_at).toBeInstanceOf(Date)
    expect(res.body.invoice.outstanding).toBe(4500)
  })

  it("honours an explicit terms override", async () => {
    const fake = makeFakeAr()
    const res = createRes()

    await POST(
      makeReq(fake, {
        body: { order_id: "ord_1", total: 10_000, terms_days: 30 },
      }) as any,
      res as any
    )

    expect(res.body.invoice.terms_days).toBe(30)
    const due = new Date(res.body.invoice.due_at)
    const issued = new Date(res.body.invoice.issued_at)
    expect(
      Math.round((due.getTime() - issued.getTime()) / (24 * 3600 * 1000))
    ).toBe(30)
  })

  it("leaves an invoice in draft when asked, with no due date", async () => {
    const fake = makeFakeAr()
    const res = createRes()

    await POST(
      makeReq(fake, { body: { total: 500, issue: false } }) as any,
      res as any
    )

    expect(res.body.invoice.status).toBe(InvoiceStatus.DRAFT)
    expect(res.body.invoice.due_at).toBeNull()
  })

  it("lists a seller's invoices with derived fields", async () => {
    const fake = makeFakeAr()
    await POST(
      makeReq(fake, { body: { total: 4500 } }) as any,
      createRes() as any
    )

    const res = createRes()
    await GET(makeReq(fake) as any, res as any)

    expect(res.statusCode).toBe(200)
    expect(res.body.invoices).toHaveLength(1)
    expect(res.body.invoices[0]).toHaveProperty("presentation_status")
    expect(res.body.invoices[0]).toHaveProperty("outstanding", 4500)
  })

  it("rejects a negative total", async () => {
    const fake = makeFakeAr()
    const res = createRes()
    await POST(makeReq(fake, { body: { total: -1 } }) as any, res as any)
    expect(res.statusCode).toBe(400)
  })
})

describe("vendor invoices route: transitions", () => {
  it("still accepts 'sent' as an alias for the issued state", async () => {
    // The pre-module API called it `sent`; renaming it must not break a client.
    const fake = makeFakeAr()
    await POST(
      makeReq(fake, { body: { total: 4500, issue: false } }) as any,
      createRes() as any
    )

    const res = createRes()
    await PATCH(
      makeReq(fake, {
        params: { id: "inv_1" },
        body: { status: "sent" },
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.invoice.status).toBe(InvoiceStatus.ISSUED)
  })

  it("refuses to let a vendor simply declare an invoice paid", async () => {
    // Settling is a consequence of recorded payment, so the AR ledger can
    // always say when the money arrived and how.
    const fake = makeFakeAr()
    await POST(makeReq(fake, { body: { total: 4500 } }) as any, createRes() as any)

    const res = createRes()
    await PATCH(
      makeReq(fake, {
        params: { id: "inv_1" },
        body: { status: "paid" },
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/record a payment/)
  })

  it("404s on another vendor's invoice rather than confirming it exists", async () => {
    const fake = makeFakeAr()
    await POST(makeReq(fake, { body: { total: 4500 } }) as any, createRes() as any)

    const res = createRes()
    await PATCH(
      makeReq(fake, {
        sellerId: "seller_other",
        params: { id: "inv_1" },
        body: { status: "void" },
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(404)
  })

  it("enforces the transition table", () => {
    expect(
      isAllowedInvoiceTransition(InvoiceStatus.DRAFT, InvoiceStatus.ISSUED)
    ).toBe(true)
    expect(
      isAllowedInvoiceTransition(InvoiceStatus.ISSUED, InvoiceStatus.WRITTEN_OFF)
    ).toBe(true)
    expect(
      isAllowedInvoiceTransition(InvoiceStatus.DRAFT, InvoiceStatus.WRITTEN_OFF)
    ).toBe(false)
    expect(
      isAllowedInvoiceTransition(InvoiceStatus.PAID, InvoiceStatus.VOID)
    ).toBe(false)
  })
})

describe("vendor invoices route: payments", () => {
  const issueOne = async (fake: ReturnType<typeof makeFakeAr>, total = 10_000) => {
    await POST(makeReq(fake, { body: { total } }) as any, createRes() as any)
  }

  it("settles an invoice once payments cover the total", async () => {
    const fake = makeFakeAr()
    await issueOne(fake)

    const res = createRes()
    await RECORD_PAYMENT(
      makeReq(fake, {
        params: { id: "inv_1" },
        body: { amount: 10_000, idempotency_key: "pay_1" },
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.invoice.status).toBe(InvoiceStatus.PAID)
    expect(res.body.invoice.outstanding).toBe(0)
  })

  it("leaves a part-paid invoice owing the remainder", async () => {
    const fake = makeFakeAr()
    await issueOne(fake)

    const res = createRes()
    await RECORD_PAYMENT(
      makeReq(fake, {
        params: { id: "inv_1" },
        body: { amount: 2_500, idempotency_key: "pay_1" },
      }) as any,
      res as any
    )

    expect(res.body.invoice.outstanding).toBe(7_500)
    expect(res.body.invoice.presentation_status).toBe("partially_paid")
  })

  it("does not credit the buyer twice for a replayed payment", async () => {
    const fake = makeFakeAr()
    await issueOne(fake)

    for (let i = 0; i < 2; i++) {
      await RECORD_PAYMENT(
        makeReq(fake, {
          params: { id: "inv_1" },
          body: { amount: 2_500, idempotency_key: "pay_same" },
        }) as any,
        createRes() as any
      )
    }

    expect(fake.payments).toHaveLength(1)
    expect(fake.rows[0].amount_paid).toBe(2_500)
  })

  it("requires an idempotency key", async () => {
    const fake = makeFakeAr()
    await issueOne(fake)

    const res = createRes()
    await RECORD_PAYMENT(
      makeReq(fake, {
        params: { id: "inv_1" },
        body: { amount: 2_500 },
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/idempotency_key/)
  })

  it("rejects a non-positive payment", async () => {
    const fake = makeFakeAr()
    await issueOne(fake)

    const res = createRes()
    await RECORD_PAYMENT(
      makeReq(fake, {
        params: { id: "inv_1" },
        body: { amount: 0, idempotency_key: "pay_zero" },
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(400)
  })
})
