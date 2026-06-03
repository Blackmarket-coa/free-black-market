import CreatorAttributionService from "../service"
import { CommissionStatus, AttributionSource } from "../models/order-attribution"

/**
 * Unit tests for platformAttributionRollup — the platform-wide
 * creator-driven-sales KPI. Faked service instance (no Medusa DI);
 * we stub listOrderAttributions with a fixed set of attribution rows.
 */
function buildService(rows: any[]) {
  const svc: any = Object.create(CreatorAttributionService.prototype)
  svc.listOrderAttributions = jest.fn(async () => rows)
  return svc
}

function row(overrides: Partial<any> = {}) {
  return {
    creator_seller_id: "sel_a",
    source: AttributionSource.LINK_CLICK,
    attributed_subtotal_cents: 10000,
    commission_amount_cents: 1000,
    commission_status: CommissionStatus.APPROVED,
    attribution_decided_at: new Date("2026-05-15T00:00:00Z"),
    ...overrides,
  }
}

describe("platformAttributionRollup", () => {
  it("sums attributed GMV across all creators and counts distinct creators", async () => {
    const svc = buildService([
      row({ creator_seller_id: "sel_a", attributed_subtotal_cents: 10000 }),
      row({ creator_seller_id: "sel_b", attributed_subtotal_cents: 25000 }),
      row({ creator_seller_id: "sel_a", attributed_subtotal_cents: 5000 }),
    ])

    const r = await svc.platformAttributionRollup()

    expect(r.attributed_gmv_cents).toBe(40000)
    expect(r.gross_attributed_gmv_cents).toBe(40000)
    expect(r.distinct_creators).toBe(2)
    expect(r.total_attributed_orders).toBe(3)
    expect(r.valid_attributed_orders).toBe(3)
  })

  it("excludes reversed/disqualified from attributed GMV but keeps them in gross", async () => {
    const svc = buildService([
      row({ attributed_subtotal_cents: 10000, commission_status: CommissionStatus.PAID }),
      row({ attributed_subtotal_cents: 8000, commission_status: CommissionStatus.REVERSED }),
      row({ attributed_subtotal_cents: 3000, commission_status: CommissionStatus.DISQUALIFIED }),
    ])

    const r = await svc.platformAttributionRollup()

    expect(r.attributed_gmv_cents).toBe(10000) // only the PAID row
    expect(r.gross_attributed_gmv_cents).toBe(21000) // all three
    expect(r.valid_attributed_orders).toBe(1)
    expect(r.total_attributed_orders).toBe(3)
  })

  it("buckets commission by status and breaks down GMV by source", async () => {
    const svc = buildService([
      row({ source: AttributionSource.LINK_CLICK, attributed_subtotal_cents: 10000, commission_amount_cents: 1000, commission_status: CommissionStatus.PENDING }),
      row({ source: AttributionSource.PROMO_CODE, attributed_subtotal_cents: 20000, commission_amount_cents: 2000, commission_status: CommissionStatus.APPROVED }),
      row({ source: AttributionSource.LINK_CLICK, attributed_subtotal_cents: 5000, commission_amount_cents: 500, commission_status: CommissionStatus.PAID }),
    ])

    const r = await svc.platformAttributionRollup()

    expect(r.commission_pending_cents).toBe(1000)
    expect(r.commission_approved_cents).toBe(2000)
    expect(r.commission_paid_cents).toBe(500)
    expect(r.by_source[AttributionSource.LINK_CLICK]).toEqual({ orders: 2, attributed_gmv_cents: 15000 })
    expect(r.by_source[AttributionSource.PROMO_CODE]).toEqual({ orders: 1, attributed_gmv_cents: 20000 })
  })

  it("applies the date range filter", async () => {
    const svc = buildService([
      row({ attribution_decided_at: new Date("2026-04-01T00:00:00Z"), attributed_subtotal_cents: 9999 }),
      row({ attribution_decided_at: new Date("2026-05-15T00:00:00Z"), attributed_subtotal_cents: 10000 }),
    ])

    const r = await svc.platformAttributionRollup({
      from: new Date("2026-05-01T00:00:00Z"),
      to: new Date("2026-05-31T00:00:00Z"),
    })

    expect(r.total_attributed_orders).toBe(1)
    expect(r.attributed_gmv_cents).toBe(10000)
  })
})
