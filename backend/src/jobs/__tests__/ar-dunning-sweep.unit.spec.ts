import { sweepDunning } from "../ar-dunning-sweep"
import { InvoiceStatus } from "../../modules/accounts-receivable/terms"

type Row = {
  id: string
  seller_id: string
  customer_id: string | null
  status: InvoiceStatus
  total: number
  amount_paid: number
  due_at: Date | null
  currency_code: string
}

const row = (overrides: Partial<Row> = {}): Row => ({
  id: "inv_1",
  seller_id: "sel_1",
  customer_id: "cus_1",
  status: InvoiceStatus.ISSUED,
  total: 10_000,
  amount_paid: 0,
  due_at: new Date("2026-09-01T23:59:59.999Z"),
  currency_code: "usd",
  ...overrides,
})

const fakeAr = (due: { invoice: Row; stage: 1 | 7 | 14 | 30 | 60 }[]) => {
  const marked: { id: string; stage: number }[] = []
  return {
    marked,
    service: {
      dueForDunning: jest.fn(async () => due),
      markDunned: jest.fn(async (id: string, stage: number) => {
        marked.push({ id, stage })
      }),
      toView: (r: Row) => ({
        id: r.id,
        seller_id: r.seller_id,
        customer_id: r.customer_id,
        outstanding: r.total - r.amount_paid,
        currency_code: r.currency_code,
        due_at: r.due_at,
      }),
    },
  }
}

describe("ar-dunning-sweep", () => {
  it("emits one reminder per due invoice and marks the stage", async () => {
    const { service, marked } = fakeAr([{ invoice: row(), stage: 7 }])
    const emitted: unknown[] = []

    const result = await sweepDunning(
      service as never,
      async (p) => {
        emitted.push(p)
      }
    )

    expect(result).toEqual({ considered: 1, notified: 1, failed: 0 })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      invoice_id: "inv_1",
      seller_id: "sel_1",
      stage: 7,
      outstanding: 10_000,
    })
    expect(marked).toEqual([{ id: "inv_1", stage: 7 }])
  })

  it("does nothing when nothing is due", async () => {
    const { service } = fakeAr([])
    const result = await sweepDunning(service as never, async () => {})
    expect(result).toEqual({ considered: 0, notified: 0, failed: 0 })
    expect(service.markDunned).not.toHaveBeenCalled()
  })

  it("marks only AFTER the reminder is emitted", async () => {
    // A crash between the two must re-send, never skip: a duplicate reminder
    // is an annoyance, a missed one is money.
    const { service, marked } = fakeAr([{ invoice: row(), stage: 1 }])

    const result = await sweepDunning(service as never, async () => {
      throw new Error("notification transport down")
    })

    expect(result).toEqual({ considered: 1, notified: 0, failed: 1 })
    expect(marked).toEqual([])
  })

  it("keeps going when one invoice fails", async () => {
    const { service, marked } = fakeAr([
      { invoice: row({ id: "inv_bad" }), stage: 1 },
      { invoice: row({ id: "inv_good" }), stage: 1 },
    ])

    const result = await sweepDunning(service as never, async (p) => {
      if (p.invoice_id === "inv_bad") throw new Error("boom")
    })

    expect(result).toEqual({ considered: 2, notified: 1, failed: 1 })
    expect(marked).toEqual([{ id: "inv_good", stage: 1 }])
  })

  it("reports outstanding, not the invoice total, for a part-paid invoice", async () => {
    const { service } = fakeAr([
      { invoice: row({ total: 10_000, amount_paid: 7_500 }), stage: 14 },
    ])
    const emitted: { outstanding?: number }[] = []

    await sweepDunning(service as never, async (p) => {
      emitted.push(p)
    })

    expect(emitted[0].outstanding).toBe(2_500)
  })
})
