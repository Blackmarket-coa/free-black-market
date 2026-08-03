import VendorBillingService from "../service"
import { VendorChargeKind, VendorChargeStatus } from "../charges"

/**
 * `Object.create(Service.prototype)` + patched CRUD, per
 * `modules/entitlement/__tests__/entitlement-service.unit.spec.ts`.
 */
type Row = Record<string, unknown> & { id: string; idempotency_key: string }

const makeService = (opts: { rows?: Row[]; insertRaces?: boolean } = {}) => {
  const svc = Object.create(
    VendorBillingService.prototype
  ) as Record<string, unknown>

  const rows: Row[] = [...(opts.rows ?? [])]
  let raced = false

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      Array.isArray(v) ? v.includes(row[k]) : row[k] === v
    )

  svc.listVendorCharges = (async (where: Record<string, unknown> = {}) =>
    rows.filter((r) => matches(r, where))) as never

  svc.createVendorCharges = (async (data: Record<string, unknown>) => {
    // Simulate a concurrent insert landing between the caller's read and its
    // write — the race the unique index exists to catch.
    if (opts.insertRaces && !raced) {
      raced = true
      rows.push({ ...data, id: `vc_raced` } as Row)
      const err = new Error("duplicate key value violates unique constraint")
      ;(err as { code?: string }).code = "23505"
      throw err
    }
    const row = { ...data, id: `vc_${rows.length + 1}` } as Row
    rows.push(row)
    return row
  }) as never

  svc.updateVendorCharges = (async (data: Record<string, unknown>) => {
    const row = rows.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }) as never

  return { svc: svc as unknown as VendorBillingService, rows }
}

const input = {
  seller_id: "sel_1",
  kind: VendorChargeKind.PLAN,
  amount: 9900,
  description: "Pro plan — September",
  discriminator: "pro:2026-09-01",
}

describe("createCharge", () => {
  it("records a pending charge", async () => {
    const { svc } = makeService()
    const { charge, replayed } = await svc.createCharge(input)

    expect(replayed).toBe(false)
    expect(charge.status).toBe(VendorChargeStatus.PENDING)
    expect(charge.amount).toBe(9900)
    expect(charge.idempotency_key).toBe("plan:sel_1:pro:2026-09-01")
  })

  it("returns the existing charge on a replay instead of billing twice", async () => {
    const { svc, rows } = makeService()
    await svc.createCharge(input)
    const second = await svc.createCharge(input)

    expect(second.replayed).toBe(true)
    expect(rows).toHaveLength(1)
  })

  it("treats a lost insert race as a replay, not an error", async () => {
    // Two concurrent renewals read "no charge" and both insert. The unique
    // index rejects the loser; surfacing that as a duplicate-key error on a
    // billing path would fail a renewal that actually succeeded.
    const { svc, rows } = makeService({ insertRaces: true })
    const result = await svc.createCharge(input)

    expect(result.replayed).toBe(true)
    expect(rows).toHaveLength(1)
  })

  it("separates charges for different periods", async () => {
    const { svc, rows } = makeService()
    await svc.createCharge(input)
    await svc.createCharge({ ...input, discriminator: "pro:2026-10-01" })

    expect(rows).toHaveLength(2)
  })

  it("normalizes the amount and currency", async () => {
    const { svc } = makeService()
    const { charge } = await svc.createCharge({
      ...input,
      amount: 99.6,
      currency_code: "USD",
    })

    expect(charge.amount).toBe(100)
    expect(charge.currency_code).toBe("usd")
  })

  it("never records a negative amount", async () => {
    // A refund is a status, not a sign; a negative charge would corrupt every
    // balance that sums these rows.
    const { svc } = makeService()
    const { charge } = await svc.createCharge({ ...input, amount: -500 })
    expect(charge.amount).toBe(0)
  })
})

describe("transitionCharge", () => {
  const pending = (over: Partial<Row> = {}): Row => ({
    id: "vc_1",
    seller_id: "sel_1",
    idempotency_key: "plan:sel_1:x",
    status: VendorChargeStatus.PENDING,
    amount: 100,
    currency_code: "usd",
    ...over,
  })

  it("moves a charge through collection", async () => {
    const { svc } = makeService({ rows: [pending()] })

    const processing = await svc.transitionCharge(
      "vc_1",
      VendorChargeStatus.PROCESSING,
      { stripe_payment_intent_id: "pi_1" }
    )
    expect(processing?.status).toBe(VendorChargeStatus.PROCESSING)
    expect(processing?.stripe_payment_intent_id).toBe("pi_1")

    const paid = await svc.transitionCharge("vc_1", VendorChargeStatus.PAID)
    expect(paid?.status).toBe(VendorChargeStatus.PAID)
    expect(paid?.paid_at).toBeInstanceOf(Date)
  })

  it("returns null on an illegal move rather than throwing", async () => {
    // Webhooks arrive out of order; a `processing` event landing after the
    // `paid` event it preceded is normal traffic, not an error.
    const { svc } = makeService({
      rows: [pending({ status: VendorChargeStatus.PAID })],
    })
    expect(
      await svc.transitionCharge("vc_1", VendorChargeStatus.PROCESSING)
    ).toBeNull()
  })

  it("clears a prior failure once paid", async () => {
    // Otherwise a retried-then-paid charge reads as both paid and failed.
    const { svc } = makeService({
      rows: [
        pending({
          status: VendorChargeStatus.FAILED,
          failure_reason: "card_declined",
        }),
      ],
    })
    const paid = await svc.transitionCharge("vc_1", VendorChargeStatus.PAID)
    expect(paid?.failure_reason).toBeNull()
  })

  it("records why a charge failed", async () => {
    const { svc } = makeService({ rows: [pending()] })
    const failed = await svc.transitionCharge("vc_1", VendorChargeStatus.FAILED, {
      failure_reason: "insufficient_funds",
    })
    expect(failed?.failure_reason).toBe("insufficient_funds")
  })

  it("returns null for a charge that does not exist", async () => {
    const { svc } = makeService()
    expect(await svc.transitionCharge("vc_nope", VendorChargeStatus.PAID)).toBeNull()
  })
})

describe("getOutstandingBalance", () => {
  it("totals what the vendor still owes", async () => {
    const { svc } = makeService({
      rows: [
        {
          id: "vc_1",
          seller_id: "sel_1",
          idempotency_key: "a",
          status: VendorChargeStatus.PENDING,
          amount: 9900,
          currency_code: "usd",
        },
        {
          id: "vc_2",
          seller_id: "sel_1",
          idempotency_key: "b",
          status: VendorChargeStatus.PAID,
          amount: 4900,
          currency_code: "usd",
        },
        {
          id: "vc_3",
          seller_id: "sel_other",
          idempotency_key: "c",
          status: VendorChargeStatus.PENDING,
          amount: 100_000,
          currency_code: "usd",
        },
      ],
    })

    expect(await svc.getOutstandingBalance("sel_1")).toEqual({
      amount: 9900,
      currency_code: "usd",
    })
  })
})

describe("findByPaymentIntent", () => {
  it("finds the charge a webhook is about", async () => {
    const { svc } = makeService({
      rows: [
        {
          id: "vc_1",
          seller_id: "sel_1",
          idempotency_key: "a",
          status: VendorChargeStatus.PROCESSING,
          amount: 100,
          currency_code: "usd",
          stripe_payment_intent_id: "pi_abc",
        },
      ],
    })

    expect((await svc.findByPaymentIntent("pi_abc"))?.id).toBe("vc_1")
    expect(await svc.findByPaymentIntent("pi_unknown")).toBeNull()
  })
})
