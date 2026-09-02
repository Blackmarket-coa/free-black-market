import {
  DUNNING_STAGES,
  InvalidTermsError,
  InvoiceStatus,
  MAX_TERMS_DAYS,
  assertNoCommissionEffect,
  bucketForDaysPastDue,
  creditExposureCents,
  daysPastDue,
  deriveDueDate,
  dunningStageFor,
  evaluateCreditLimit,
  isOverdue,
  outstandingCents,
  presentationStatus,
  resolveCreditLimitCents,
  resolveTermsDays,
  summarizeAging,
  type OutstandingInvoice,
  type TermsBearingTier,
} from "../terms"

const at = (iso: string) => new Date(iso)

const issued = (
  overrides: Partial<OutstandingInvoice> = {}
): OutstandingInvoice => ({
  status: InvoiceStatus.ISSUED,
  total: 10_000,
  amount_paid: 0,
  due_at: at("2026-09-01T23:59:59.999Z"),
  ...overrides,
})

describe("terms: deriveDueDate", () => {
  it("Net-30 lands 30 calendar days out", () => {
    const due = deriveDueDate(at("2026-09-02T10:00:00Z"), 30)
    expect(due.toISOString().slice(0, 10)).toBe("2026-10-02")
  })

  it("Net-0 is due at the end of the day it was issued", () => {
    const due = deriveDueDate(at("2026-09-02T10:00:00Z"), 0)
    expect(due.toISOString()).toBe("2026-09-02T23:59:59.999Z")
  })

  it("is due at end of day, so an invoice is not late on its due date", () => {
    const due = deriveDueDate(at("2026-09-02T10:00:00Z"), 30)
    expect(due.getUTCHours()).toBe(23)
    expect(due.getUTCMinutes()).toBe(59)
  })

  it("ignores time of day: 23:00 and 01:00 the same day are due the same date", () => {
    const late = deriveDueDate(at("2026-09-02T23:00:00Z"), 30)
    const early = deriveDueDate(at("2026-09-02T01:00:00Z"), 30)
    expect(late.toISOString()).toBe(early.toISOString())
  })

  it("crosses month and year boundaries on the calendar, not by 30*86400s", () => {
    expect(deriveDueDate(at("2026-12-20T12:00:00Z"), 30).toISOString().slice(0, 10)).toBe(
      "2027-01-19"
    )
    // February, to catch anything that assumes 30-day months.
    expect(deriveDueDate(at("2027-01-31T12:00:00Z"), 30).toISOString().slice(0, 10)).toBe(
      "2027-03-02"
    )
  })

  it("rejects negative, fractional, and absurd terms", () => {
    expect(() => deriveDueDate(at("2026-09-02T00:00:00Z"), -1)).toThrow(InvalidTermsError)
    expect(() => deriveDueDate(at("2026-09-02T00:00:00Z"), 1.5)).toThrow(InvalidTermsError)
    expect(() =>
      deriveDueDate(at("2026-09-02T00:00:00Z"), MAX_TERMS_DAYS + 1)
    ).toThrow(InvalidTermsError)
  })
})

describe("terms: resolveTermsDays", () => {
  const tiers: TermsBearingTier[] = [
    { id: "t_coop", payment_terms_days: 14, customer_ids: ["cus_1"] },
    { id: "t_wholesale", payment_terms_days: 30, customer_ids: ["cus_1", "cus_2"] },
    { id: "t_inactive", payment_terms_days: 60, active: false, customer_ids: ["cus_1"] },
  ]

  it("gives a buyer in two tiers the MOST favourable terms", () => {
    // The buyer was granted both tiers; honouring the weaker grant would make
    // adding a tier silently take something away.
    expect(resolveTermsDays(tiers, "cus_1")).toBe(30)
  })

  it("ignores inactive tiers even when they are more favourable", () => {
    expect(resolveTermsDays(tiers, "cus_1")).not.toBe(60)
  })

  it("defaults to due-on-receipt for a buyer in no tier", () => {
    // Which is what the platform did before this module existed.
    expect(resolveTermsDays(tiers, "cus_stranger")).toBe(0)
  })

  it("ignores a tier the buyer is not a member of", () => {
    expect(resolveTermsDays(tiers, "cus_2")).toBe(30)
  })

  it("clamps a nonsense tier value rather than trusting it", () => {
    expect(
      resolveTermsDays([{ id: "t", payment_terms_days: 9999, customer_ids: ["c"] }], "c")
    ).toBe(MAX_TERMS_DAYS)
    expect(
      resolveTermsDays([{ id: "t", payment_terms_days: -5, customer_ids: ["c"] }], "c")
    ).toBe(0)
  })
})

describe("terms: resolveCreditLimitCents", () => {
  it("distinguishes 'no limit' (null) from 'no credit' (0)", () => {
    expect(
      resolveCreditLimitCents([{ id: "t", customer_ids: ["c"] }], "c")
    ).toBeNull()
    expect(
      resolveCreditLimitCents(
        [{ id: "t", credit_limit_cents: 0, customer_ids: ["c"] }],
        "c"
      )
    ).toBe(0)
  })

  it("takes the highest ceiling across a buyer's tiers", () => {
    expect(
      resolveCreditLimitCents(
        [
          { id: "a", credit_limit_cents: 50_000, customer_ids: ["c"] },
          { id: "b", credit_limit_cents: 500_000, customer_ids: ["c"] },
        ],
        "c"
      )
    ).toBe(500_000)
  })

  it("returns null when the buyer is in no tier", () => {
    expect(
      resolveCreditLimitCents(
        [{ id: "a", credit_limit_cents: 50_000, customer_ids: ["other"] }],
        "c"
      )
    ).toBeNull()
  })
})

describe("terms: outstanding and overdue", () => {
  it("owes total minus payments", () => {
    expect(outstandingCents(issued({ amount_paid: 2_500 }))).toBe(7_500)
  })

  it("never reports a negative balance on an overpayment", () => {
    expect(outstandingCents(issued({ amount_paid: 12_000 }))).toBe(0)
  })

  it("owes nothing on a draft, void, or written-off invoice", () => {
    for (const status of [
      InvoiceStatus.DRAFT,
      InvoiceStatus.VOID,
      InvoiceStatus.WRITTEN_OFF,
    ]) {
      expect(outstandingCents(issued({ status }))).toBe(0)
    }
  })

  it("is overdue only when something is still owed", () => {
    const now = at("2026-09-15T00:00:00Z")
    expect(isOverdue(issued(), now)).toBe(true)
    expect(isOverdue(issued({ amount_paid: 10_000 }), now)).toBe(false)
  })

  it("is not overdue before the due date has ended", () => {
    expect(isOverdue(issued(), at("2026-09-01T12:00:00Z"))).toBe(false)
    expect(isOverdue(issued(), at("2026-09-02T00:00:01Z"))).toBe(true)
  })

  it("counts whole days past due", () => {
    expect(daysPastDue(issued(), at("2026-09-11T23:59:59Z"))).toBe(9)
  })
})

describe("terms: presentationStatus", () => {
  const now = at("2026-09-15T00:00:00Z")

  it("shows a past-due invoice as overdue without storing it", () => {
    expect(presentationStatus(issued(), now)).toBe("overdue")
  })

  it("shows a part-paid, not-yet-due invoice as partially_paid", () => {
    expect(
      presentationStatus(
        issued({ amount_paid: 2_000, due_at: at("2026-10-01T23:59:59Z") }),
        now
      )
    ).toBe("partially_paid")
  })

  it("never shows a terminal invoice as overdue, however old", () => {
    // A voided invoice from last year is not a collections problem.
    for (const status of [
      InvoiceStatus.VOID,
      InvoiceStatus.WRITTEN_OFF,
      InvoiceStatus.PAID,
      InvoiceStatus.DRAFT,
    ]) {
      expect(presentationStatus(issued({ status }), now)).toBe(status)
    }
  })
})

describe("terms: aging", () => {
  const now = at("2026-09-30T12:00:00Z")

  it("buckets by days past due", () => {
    expect(bucketForDaysPastDue(0)).toBe("current")
    expect(bucketForDaysPastDue(1)).toBe("d1_30")
    expect(bucketForDaysPastDue(30)).toBe("d1_30")
    expect(bucketForDaysPastDue(31)).toBe("d31_60")
    expect(bucketForDaysPastDue(61)).toBe("d61_90")
    expect(bucketForDaysPastDue(91)).toBe("d90_plus")
  })

  it("ages the outstanding balance, not the invoice total", () => {
    // A half-paid invoice is half a collections problem.
    const summary = summarizeAging(
      [issued({ total: 10_000, amount_paid: 6_000, due_at: at("2026-09-20T23:59:59Z") })],
      now
    )
    expect(summary.buckets.d1_30).toBe(4_000)
    expect(summary.total_outstanding).toBe(4_000)
  })

  it("excludes settled and terminal invoices entirely", () => {
    const summary = summarizeAging(
      [
        issued({ status: InvoiceStatus.PAID, amount_paid: 10_000 }),
        issued({ status: InvoiceStatus.VOID }),
        issued({ status: InvoiceStatus.WRITTEN_OFF }),
      ],
      now
    )
    expect(summary.total_outstanding).toBe(0)
    expect(summary.invoice_count).toBe(0)
  })

  it("splits a mixed book across buckets and sums to the total", () => {
    const summary = summarizeAging(
      [
        issued({ total: 1_000, due_at: at("2026-10-30T23:59:59Z") }), // current
        issued({ total: 2_000, due_at: at("2026-09-20T23:59:59Z") }), // 10d
        issued({ total: 4_000, due_at: at("2026-08-20T23:59:59Z") }), // 41d
        issued({ total: 8_000, due_at: at("2026-05-01T23:59:59Z") }), // >90d
      ],
      now
    )
    expect(summary.buckets.current).toBe(1_000)
    expect(summary.buckets.d1_30).toBe(2_000)
    expect(summary.buckets.d31_60).toBe(4_000)
    expect(summary.buckets.d90_plus).toBe(8_000)
    expect(summary.total_outstanding).toBe(15_000)
    expect(summary.invoice_count).toBe(4)
  })
})

describe("terms: credit limits", () => {
  const now = at("2026-09-15T00:00:00Z")
  const notYetDue = { due_at: at("2026-10-30T23:59:59Z") }

  it("allows anything when the vendor runs no limit", () => {
    const d = evaluateCreditLimit({
      limitCents: null,
      invoices: [issued(notYetDue)],
      chargeCents: 1_000_000,
      now,
    })
    expect(d.allowed).toBe(true)
    expect(d.reason).toBe("no_limit")
  })

  it("allows a charge that fits under the ceiling", () => {
    const d = evaluateCreditLimit({
      limitCents: 50_000,
      invoices: [issued({ ...notYetDue, total: 10_000 })],
      chargeCents: 40_000,
      now,
    })
    expect(d.allowed).toBe(true)
    expect(d.exposure_cents).toBe(10_000)
    expect(d.available_cents).toBe(40_000)
  })

  it("refuses the charge that would cross the ceiling", () => {
    const d = evaluateCreditLimit({
      limitCents: 50_000,
      invoices: [issued({ ...notYetDue, total: 10_000 })],
      chargeCents: 40_001,
      now,
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("would_exceed_limit")
  })

  it("refuses a buyer sitting on a past-due invoice even when under the ceiling", () => {
    // The ceiling was extended against a promise the buyer is not keeping.
    const d = evaluateCreditLimit({
      limitCents: 1_000_000,
      invoices: [issued({ total: 100, due_at: at("2026-09-01T23:59:59Z") })],
      chargeCents: 1,
      now,
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("past_due")
  })

  it("counts only what is still owed as exposure", () => {
    expect(
      creditExposureCents([
        issued({ total: 10_000, amount_paid: 4_000 }),
        issued({ status: InvoiceStatus.PAID, amount_paid: 10_000 }),
      ])
    ).toBe(6_000)
  })

  it("treats a zero ceiling as no credit, not as no limit", () => {
    const d = evaluateCreditLimit({
      limitCents: 0,
      invoices: [],
      chargeCents: 1,
      now,
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("would_exceed_limit")
  })
})

describe("terms: dunning", () => {
  const dueAt = at("2026-09-01T23:59:59.999Z")

  it("fires on the exact day of each ladder stage", () => {
    for (const stage of DUNNING_STAGES) {
      const now = new Date(dueAt.getTime() + stage * 24 * 3600 * 1000 + 1000)
      expect(dunningStageFor(issued({ due_at: dueAt }), now)).toBe(stage)
    }
  })

  it("fires on no other day, so a daily sweep sends at most one per stage", () => {
    const now = new Date(dueAt.getTime() + 3 * 24 * 3600 * 1000)
    expect(dunningStageFor(issued({ due_at: dueAt }), now)).toBeNull()
  })

  it("never chases an invoice that is paid, void, or not yet due", () => {
    const day7 = new Date(dueAt.getTime() + 7 * 24 * 3600 * 1000 + 1000)
    expect(
      dunningStageFor(issued({ due_at: dueAt, amount_paid: 10_000 }), day7)
    ).toBeNull()
    expect(
      dunningStageFor(issued({ due_at: dueAt, status: InvoiceStatus.VOID }), day7)
    ).toBeNull()
    expect(dunningStageFor(issued({ due_at: at("2027-01-01T00:00:00Z") }), day7)).toBeNull()
  })
})

describe("terms: the 3% invariant", () => {
  it("passes when terms leave the platform fee alone", () => {
    expect(() =>
      assertNoCommissionEffect({
        platformFeePercentBefore: 3,
        platformFeePercentAfter: 3,
      })
    ).not.toThrow()
  })

  it("throws if extending terms would change what the platform takes", () => {
    // Net terms move WHEN the platform is paid, never HOW MUCH.
    expect(() =>
      assertNoCommissionEffect({
        platformFeePercentBefore: 3,
        platformFeePercentAfter: 4,
      })
    ).toThrow(/never how much/)
  })
})
