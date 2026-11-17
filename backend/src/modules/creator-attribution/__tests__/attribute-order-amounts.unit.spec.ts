import CreatorAttributionService from "../service"
import { CommissionStatus } from "../models/order-attribution"

/**
 * SD-95: what `attributeOrder` stores for a given minor-unit subtotal, and
 * that a figure which cannot be minor units is refused rather than stored.
 * The subscriber's conversion is tested in
 * `subscribers/__tests__/attribute-order-on-placed.unit.spec.ts`, and the
 * whole path on Postgres in `integration-tests/http/creator-commission-minor-units.spec.ts`.
 */

function makeService() {
  // The MedusaService-generated data methods are stubbed; everything else is
  // the real prototype (see atomic-counter.unit.spec.ts for the pattern).
  const svc: any = Object.create(CreatorAttributionService.prototype)
  svc.__container__ = { resolve: () => undefined }
  svc.listOrderAttributions = jest.fn(async () => [])
  svc.listPromoCodeBindings = jest.fn(async () => [])
  svc.listAttributionClickEvents = jest.fn(async () => [
    { id: "click_1", affiliate_link_id: "link_1", occurred_at: new Date() },
  ])
  svc.listAffiliateLinks = jest.fn(async () => [
    { id: "link_1", status: "active", creator_seller_id: "sel_creator", vendor_id: "sel_vendor", deal_id: null, program_id: null },
  ])
  svc.updateAffiliateLinks = jest.fn(async () => ({}))
  svc.createOrderAttributions = jest.fn(async (row: Record<string, unknown>) => ({ id: `oatt_${row.level}`, ...row }))
  return svc
}

const input = (subtotalCents: number) => ({
  orderId: "order_1",
  customerId: "cus_1",
  visitorToken: "vis_1",
  subtotalCents,
  currencyCode: "usd",
})

describe("CreatorAttributionService.attributeOrder amounts", () => {
  const before = process.env.CREATOR_ATTRIBUTION_DEFAULT_COMMISSION_PERCENT
  beforeEach(() => {
    delete process.env.CREATOR_ATTRIBUTION_DEFAULT_COMMISSION_PERCENT // the default, 10%
    delete process.env.FBM_MULTILEVEL_REFERRALS
  })
  afterAll(() => {
    if (before === undefined) delete process.env.CREATOR_ATTRIBUTION_DEFAULT_COMMISSION_PERCENT
    else process.env.CREATOR_ATTRIBUTION_DEFAULT_COMMISSION_PERCENT = before
  })

  it("a $25.00 order (2500 cents) at the default 10% stores basis 2500 and commission 250", async () => {
    const svc = makeService()
    const row = await svc.attributeOrder(input(2500))
    expect(svc.createOrderAttributions).toHaveBeenCalledTimes(1)
    expect(row).toMatchObject({
      attributed_subtotal_cents: 2500,
      commission_basis_cents: 2500,
      commission_amount_cents: 250,
      commission_percent: 10,
      commission_status: CommissionStatus.PENDING,
      creator_seller_id: "sel_creator",
      vendor_id: "sel_vendor",
    })
  })

  it.each([25.5, 0, -100, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses subtotalCents %p: not a positive whole number of minor units, so nothing is stored",
    async (bad) => {
      const svc = makeService()
      await expect(svc.attributeOrder(input(bad))).rejects.toThrow(/positive integer in minor units/)
      expect(svc.createOrderAttributions).not.toHaveBeenCalled()
    }
  )
})
