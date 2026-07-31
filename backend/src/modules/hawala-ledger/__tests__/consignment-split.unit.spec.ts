import HawalaLedgerModuleService from "../service"
import hawalaOrderPaymentSubscriber from "../../../subscribers/hawala-order-payment"
import { HAWALA_LEDGER_MODULE } from "../index"
import { PAYOUT_BREAKDOWN_MODULE } from "../../payout-breakdown"
import { CREATOR_ATTRIBUTION_MODULE } from "../../creator-attribution"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../marketplace-webhooks"
import {
  CONSIGNMENT_CATALOG_ID,
  CONSIGNMENT_SPLIT_FLAG,
} from "../../../lib/consignment"

// Prototype-call unit tests (no DB): the consignment split must fan the
// seller-side amount out of ESCROW through createTransfer only, with
// deterministic `${idempotencyKey}-consignor` / `-vendor` keys, integer-cent
// bps math (floor to consignor, remainder to vendor) and cents/100 major
// units on the wire.
describe("HawalaLedgerModuleService.processConsignmentSplit", () => {
  const splitCtx = () => {
    const transfers: any[] = []
    const ctx = {
      getOrCreateSystemAccount: jest.fn(async (type: string) => ({
        id: `acc_${type}`,
      })),
      getOrCreateSellerEarnings: jest.fn(async (sellerId: string) => ({
        id: `acc_${sellerId}`,
      })),
      createTransfer: jest.fn(async (data: any) => {
        transfers.push(data)
        return { id: `le_${transfers.length}` }
      }),
    } as any
    return { ctx, transfers }
  }

  const baseArgs = {
    orderId: "order_1",
    sellerAmountCents: 10000,
    vendorSellerId: "vendor_1",
    consignorSellerId: "sel_consignor",
    consignorBps: 2500,
    idempotencyKey: "order-payment-order_1",
  }

  const run = (ctx: any, overrides: Record<string, unknown> = {}) =>
    HawalaLedgerModuleService.prototype.processConsignmentSplit.call(ctx, {
      ...baseArgs,
      ...overrides,
    })

  it("throws when sellerAmountCents is not a positive integer", async () => {
    for (const sellerAmountCents of [0, -100, 10.5, NaN]) {
      const { ctx } = splitCtx()
      await expect(run(ctx, { sellerAmountCents })).rejects.toThrow(
        "sellerAmountCents must be a positive integer"
      )
      expect(ctx.createTransfer).not.toHaveBeenCalled()
    }
  })

  it("throws when consignorBps is out of range or non-integer", async () => {
    for (const consignorBps of [-1, 10001, 2500.5, NaN]) {
      const { ctx } = splitCtx()
      await expect(run(ctx, { consignorBps })).rejects.toThrow(
        "consignorBps must be an integer in 0..10000"
      )
      expect(ctx.createTransfer).not.toHaveBeenCalled()
    }
  })

  it("throws when the consignor and vendor are the same seller", async () => {
    const { ctx } = splitCtx()
    await expect(
      run(ctx, { consignorSellerId: "vendor_1" })
    ).rejects.toThrow("consignorSellerId must differ from vendorSellerId")
    expect(ctx.createTransfer).not.toHaveBeenCalled()
  })

  it("moves escrow->consignor then escrow->vendor with deterministic keys", async () => {
    const { ctx, transfers } = splitCtx()

    const entries = await run(ctx)

    expect(entries).toEqual([{ id: "le_1" }, { id: "le_2" }])
    expect(ctx.getOrCreateSystemAccount).toHaveBeenCalledWith("ESCROW")
    expect(ctx.getOrCreateSellerEarnings).toHaveBeenCalledWith(
      "sel_consignor",
      "USD"
    )
    expect(ctx.getOrCreateSellerEarnings).toHaveBeenCalledWith(
      "vendor_1",
      "USD"
    )
    expect(transfers).toHaveLength(2)
    expect(transfers[0]).toEqual(
      expect.objectContaining({
        debit_account_id: "acc_ESCROW",
        credit_account_id: "acc_sel_consignor",
        amount: 25,
        entry_type: "TRANSFER",
        reference_type: "ORDER",
        reference_id: "order_1",
        order_id: "order_1",
        idempotency_key: "order-payment-order_1-consignor",
      })
    )
    expect(transfers[1]).toEqual(
      expect.objectContaining({
        debit_account_id: "acc_ESCROW",
        credit_account_id: "acc_vendor_1",
        amount: 75,
        entry_type: "TRANSFER",
        reference_type: "ORDER",
        reference_id: "order_1",
        order_id: "order_1",
        idempotency_key: "order-payment-order_1-vendor",
      })
    )
    // Legs must sum to the seller-side amount (major units).
    expect(transfers[0].amount + transfers[1].amount).toBe(100)
  })

  it("passes the caller's currency through to seller account resolution", async () => {
    const { ctx } = splitCtx()
    await run(ctx, { currencyCode: "EUR" })
    expect(ctx.getOrCreateSellerEarnings).toHaveBeenCalledWith(
      "sel_consignor",
      "EUR"
    )
    expect(ctx.getOrCreateSellerEarnings).toHaveBeenCalledWith(
      "vendor_1",
      "EUR"
    )
  })

  it("floors the consignor share; the vendor absorbs the remainder", async () => {
    const { ctx, transfers } = splitCtx()

    // 999 * 1500 / 10000 = 149.85 -> consignor 149c, vendor 850c
    await run(ctx, { sellerAmountCents: 999, consignorBps: 1500 })

    expect(transfers[0].amount).toBe(1.49)
    expect(transfers[1].amount).toBe(8.5)
    expect(
      Math.round(transfers[0].amount * 100) + Math.round(transfers[1].amount * 100)
    ).toBe(999)
  })

  it("skips a zero-cent consignor leg; the vendor still gets the full amount", async () => {
    const { ctx, transfers } = splitCtx()

    const entries = await run(ctx, { sellerAmountCents: 100, consignorBps: 0 })

    expect(entries).toHaveLength(1)
    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toEqual(
      expect.objectContaining({
        credit_account_id: "acc_vendor_1",
        amount: 1,
        idempotency_key: "order-payment-order_1-vendor",
      })
    )
    // The consignor's account is never touched for a zero-cent share.
    expect(ctx.getOrCreateSellerEarnings).toHaveBeenCalledTimes(1)
    expect(ctx.getOrCreateSellerEarnings).toHaveBeenCalledWith("vendor_1", "USD")
  })

  it("skips a zero-cent vendor leg at 10000 bps", async () => {
    const { ctx, transfers } = splitCtx()

    const entries = await run(ctx, {
      sellerAmountCents: 100,
      consignorBps: 10000,
    })

    expect(entries).toHaveLength(1)
    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toEqual(
      expect.objectContaining({
        credit_account_id: "acc_sel_consignor",
        amount: 1,
        idempotency_key: "order-payment-order_1-consignor",
      })
    )
  })

  it("produces identical idempotency keys on every retry of the same order", async () => {
    const { ctx: first, transfers: firstTransfers } = splitCtx()
    const { ctx: second, transfers: secondTransfers } = splitCtx()

    await run(first)
    await run(second)

    const keys = (transfers: any[]) => transfers.map((t) => t.idempotency_key)
    expect(keys(firstTransfers)).toEqual([
      "order-payment-order_1-consignor",
      "order-payment-order_1-vendor",
    ])
    expect(keys(secondTransfers)).toEqual(keys(firstTransfers))
  })
})

// Subscriber-level flag semantics: FBM_CONSIGNMENT_SPLIT_LIVE routes the
// seller-side amount through the split fan-out; flag unset (default) keeps
// the plain processOrderPayment call and performs no product reads at all.
describe("hawala-order-payment subscriber consignment wiring", () => {
  const ORIG_ENV = { ...process.env }

  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    delete process.env[CONSIGNMENT_SPLIT_FLAG]
  })

  afterAll(() => {
    process.env = ORIG_ENV
  })

  const consignmentProduct = (
    id: string,
    overrides: Record<string, unknown> = {}
  ) => ({
    id,
    metadata: { consignor_seller_id: "sel_consignor", consignor_bps: 2500 },
    listing_type: { catalog_id: CONSIGNMENT_CATALOG_ID },
    ...overrides,
  })

  const makeHarness = ({
    products = [consignmentProduct("prod_1")] as unknown[],
    graphImpl,
  }: {
    products?: unknown[]
    graphImpl?: jest.Mock
  } = {}) => {
    const order = {
      id: "order_1",
      customer_id: "cus_1",
      seller_id: "vendor_1",
      total: 10000,
      subtotal: 10000,
      currency_code: "usd",
      items: [{ product_id: "prod_1" }],
    }
    const transfers: any[] = []
    const hawalaService = {
      listLedgerAccounts: jest.fn(
        async (filter: { account_type: string }) =>
          filter.account_type === "USER_WALLET"
            ? [{ id: "acc_wallet" }]
            : [{ id: "acc_seller" }]
      ),
      createAccount: jest.fn(),
      getOrCreateSystemAccount: jest.fn(async (type: string) => ({
        id: type === "ESCROW" ? "acc_escrow" : "acc_platform",
      })),
      createTransfer: jest.fn(async (data: any) => {
        transfers.push(data)
        return { id: `le_${data.entry_type.toLowerCase()}` }
      }),
      processConsignmentSplit: jest
        .fn()
        .mockResolvedValue([{ id: "le_consignor" }, { id: "le_vendor" }]),
      processOrderPayment: jest.fn().mockResolvedValue([{ id: "le_pay" }]),
      // Fresh order: no prior settlement, so the idempotency guard proceeds.
      listLedgerEntries: jest.fn().mockResolvedValue([]),
    }
    const payoutService = {
      getEffectivePlatformFee: jest.fn().mockResolvedValue(10),
      calculateBreakdown: jest.fn().mockResolvedValue({}),
      storeOrderBreakdown: jest.fn().mockResolvedValue({}),
    }
    const graph =
      graphImpl ??
      jest.fn(async () => ({
        data: products,
      }))
    const webhooks = { emitBlackout: jest.fn().mockResolvedValue(true) }
    const container = {
      resolve: (token: string) => {
        if (token === HAWALA_LEDGER_MODULE) return hawalaService
        if (token === PAYOUT_BREAKDOWN_MODULE) return payoutService
        if (token === CREATOR_ATTRIBUTION_MODULE)
          return { listOrderAttributions: jest.fn().mockResolvedValue([]) }
        if (token === MARKETPLACE_WEBHOOKS_MODULE) return webhooks
        if (token === "order")
          return { retrieveOrder: jest.fn().mockResolvedValue(order) }
        if (token === "query") return { graph }
        return {}
      },
    }
    return { container, hawalaService, graph, webhooks, transfers }
  }

  const run = (container: unknown) =>
    hawalaOrderPaymentSubscriber({
      event: { data: { id: "order_1" } },
      container,
    } as any)

  it("flag off (default): plain processOrderPayment, zero product reads, no split", async () => {
    const { container, hawalaService, graph } = makeHarness()

    await run(container)

    expect(hawalaService.processOrderPayment).toHaveBeenCalledTimes(1)
    expect(hawalaService.processOrderPayment).toHaveBeenCalledWith({
      customer_account_id: "acc_wallet",
      seller_account_id: "acc_seller",
      order_id: "order_1",
      total_amount: 100,
      platform_fee_amount: 100 * (10 / 100),
      producer_id: null,
      auto_invest_percentage: 0,
      idempotency_key: "order-payment-order_1",
    })
    expect(graph).not.toHaveBeenCalled()
    expect(hawalaService.processConsignmentSplit).not.toHaveBeenCalled()
    expect(hawalaService.createTransfer).not.toHaveBeenCalled()
    expect(hawalaService.getOrCreateSystemAccount).not.toHaveBeenCalled()
  })

  it("flag on + consignment order: purchase/fee legs mirror processOrderPayment and the seller side goes through the split", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    const { container, hawalaService, graph, webhooks, transfers } =
      makeHarness()

    await run(container)

    expect(graph).toHaveBeenCalledWith({
      entity: "product",
      fields: ["id", "metadata", "listing_type.catalog_id"],
      filters: { id: ["prod_1"] },
    })
    expect(hawalaService.processOrderPayment).not.toHaveBeenCalled()

    // Legs 1-2 use the exact processOrderPayment keys and integer-cent
    // amounts in major units (total 10000c, 10% fee of the 10000c subtotal).
    expect(transfers).toHaveLength(2)
    expect(transfers[0]).toEqual(
      expect.objectContaining({
        debit_account_id: "acc_wallet",
        credit_account_id: "acc_escrow",
        amount: 100,
        entry_type: "PURCHASE",
        order_id: "order_1",
        idempotency_key: "order-payment-order_1-purchase",
      })
    )
    expect(transfers[1]).toEqual(
      expect.objectContaining({
        debit_account_id: "acc_escrow",
        credit_account_id: "acc_platform",
        amount: 10,
        entry_type: "COMMISSION",
        order_id: "order_1",
        idempotency_key: "order-payment-order_1-fee",
      })
    )
    expect(hawalaService.processConsignmentSplit).toHaveBeenCalledTimes(1)
    expect(hawalaService.processConsignmentSplit).toHaveBeenCalledWith({
      orderId: "order_1",
      sellerAmountCents: 9000,
      currencyCode: "USD",
      vendorSellerId: "vendor_1",
      consignorSellerId: "sel_consignor",
      consignorBps: 2500,
      idempotencyKey: "order-payment-order_1",
    })

    // The ledger.payment_received bridge still fires, anchored on the
    // purchase entry.
    expect(webhooks.emitBlackout).toHaveBeenCalledWith(
      "ledger.payment_received",
      expect.objectContaining({
        orderId: "order_1",
        vendorId: "vendor_1",
        amountMinorUnits: 10000,
        ledgerTxId: "le_purchase",
      }),
      expect.objectContaining({ eventId: "ledger.payment_received:order_1" })
    )
  })

  it("flag on + non-consignment order: falls back to the plain seller leg", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    const { container, hawalaService, graph } = makeHarness({
      products: [
        consignmentProduct("prod_1", {
          metadata: null,
          listing_type: { catalog_id: "physical_product" },
        }),
      ],
    })

    await run(container)

    expect(graph).toHaveBeenCalledTimes(1)
    expect(hawalaService.processConsignmentSplit).not.toHaveBeenCalled()
    expect(hawalaService.createTransfer).not.toHaveBeenCalled()
    expect(hawalaService.processOrderPayment).toHaveBeenCalledTimes(1)
  })

  it("flag on + invalid split config: falls back to the plain seller leg", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    const { container, hawalaService } = makeHarness({
      products: [
        consignmentProduct("prod_1", {
          metadata: { consignor_seller_id: "sel_consignor", consignor_bps: 99999 },
        }),
      ],
    })

    await run(container)

    expect(hawalaService.processConsignmentSplit).not.toHaveBeenCalled()
    expect(hawalaService.processOrderPayment).toHaveBeenCalledTimes(1)
  })

  it("flag on + product lookup failure: money still moves through the plain path", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    const { container, hawalaService } = makeHarness({
      graphImpl: jest.fn().mockRejectedValue(new Error("graph down")),
    })

    await run(container)

    expect(hawalaService.processConsignmentSplit).not.toHaveBeenCalled()
    expect(hawalaService.processOrderPayment).toHaveBeenCalledTimes(1)
    expect(hawalaService.processOrderPayment).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: "order-payment-order_1" })
    )
  })

  it("flag on + unknown consignor: verification fails, falls back to the plain seller leg", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    // Products resolve to a consignment listing, but the consignor id names no
    // seller, so revenue must not be routed to it — plain path instead.
    const graphImpl = jest.fn(async ({ entity }: { entity: string }) =>
      entity === "seller" ? { data: [] } : { data: [consignmentProduct("prod_1")] }
    )
    const { container, hawalaService } = makeHarness({ graphImpl })

    await run(container)

    expect(hawalaService.processConsignmentSplit).not.toHaveBeenCalled()
    expect(hawalaService.processOrderPayment).toHaveBeenCalledTimes(1)
  })

  it("already-settled order: idempotency guard skips re-settlement entirely", async () => {
    const { container, hawalaService } = makeHarness()
    // The -purchase leg already exists (prior delivery), so neither path runs
    // — this is what prevents a flag-flip redelivery from double-debiting escrow.
    hawalaService.listLedgerEntries.mockResolvedValue([{ id: "le_prior_purchase" }])

    await run(container)

    expect(hawalaService.listLedgerEntries).toHaveBeenCalledWith({
      idempotency_key: "order-payment-order_1-purchase",
    })
    expect(hawalaService.processOrderPayment).not.toHaveBeenCalled()
    expect(hawalaService.processConsignmentSplit).not.toHaveBeenCalled()
  })
})
