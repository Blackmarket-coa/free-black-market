import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import hawalaOrderPaymentSubscriber from "../hawala-order-payment"
import hawalaOrderRefundSubscriber from "../hawala-order-refund"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../shared/feature-flags"
import { clearPlanFeatureCache } from "../../shared/plan-entitlement-cache"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"
import {
  CARD_PROCESSING_LEG,
  CARD_PROCESSING_OWNER_ID,
  CARD_PROCESSING_SHORTFALL_LEG,
  isCardProcessingShortfallLeg,
} from "../../modules/hawala-ledger/card-processing"
import { PAYOUT_BREAKDOWN_MODULE } from "../../modules/payout-breakdown"
import { CREATOR_ATTRIBUTION_MODULE } from "../../modules/creator-attribution"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { TENANCY_MODULE } from "../../modules/tenancy"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks"
import { CONSIGNMENT_SPLIT_FLAG } from "../../lib/consignment"
import {
  makeAccount,
  makePoolLedger,
  type PoolLedger,
  type Row,
} from "../../modules/hawala-ledger/__tests__/in-memory-pool-ledger"
import { makeBreakdownService } from "../../modules/payout-breakdown/__tests__/fee-first-harness"

/**
 * F6-3, real chain end to end. Nothing in the money path is a stand-in:
 *
 *   - the REAL order.placed subscriber and the REAL order refund subscriber;
 *   - the REAL `resolveSellerPlatformFee` (shared/platform-fee.ts) reading the
 *     seller's plan through the REAL `getSellerPlanSnapshot`;
 *   - the REAL `PayoutBreakdownService.calculateBreakdown` and
 *     `storeOrderBreakdown` (prototype + in-memory config/settings rows);
 *   - the REAL `HawalaLedgerModuleService` — `processOrderPayment`,
 *     `processConsignmentSplit`, `createTransfer` with its balance check and
 *     idempotency, `processRefund` — over the in-memory account/entry store
 *     (`in-memory-pool-ledger.ts`), which records every leg.
 *
 * The container is keyed by the IMPORTED module constants and throws on any
 * other key, so a hand-typed key fails loudly instead of exercising a
 * fallback (CLAUDE.md rule 2). The plan read is asserted to have run, so the
 * fee is not the platform-default catch in platform-fee.ts.
 */

const FLAG = PHASE0_FEATURE_FLAGS.FEE_FIRST_SPLIT_V1

type Order = {
  id: string
  customer_id: string
  seller_id: string
  total: number
  subtotal: number
  currency_code: string
  items: Array<{ product_id: string }>
  metadata?: Record<string, unknown>
}

const order40 = (over: Partial<Order> = {}): Order => ({
  id: "order_1",
  customer_id: "cus_1",
  seller_id: "sel_1",
  total: 4000,
  subtotal: 4000,
  currency_code: "usd",
  items: [{ product_id: "prod_1" }],
  ...over,
})

function makeWorld(opts: {
  order: Order
  planCode?: string
  sellerOpeningBalance?: number
  consignment?: { consignorSellerId: string; bps: number }
  configThrowsFrom?: number
  processingUnusable?: boolean
}) {
  const ledger = makePoolLedger({
    accounts: [
      makeAccount("acc-wallet", { owner_id: opts.order.customer_id }),
      makeAccount("acc-escrow", { account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-platform", { account_type: "PLATFORM_FEE", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-earnings", {
        account_type: "SELLER_EARNINGS",
        owner_type: "SELLER",
        owner_id: opts.order.seller_id,
        balance: opts.sellerOpeningBalance ?? 0,
        available_balance: opts.sellerOpeningBalance ?? 0,
      }),
    ],
  })
  // Postgres `numeric` balances are exact decimals; the in-memory float sum
  // is not (33.33 - 0.96 - 1.27 = 31.099999999999998 < 31.10), which would
  // refuse a leg production accepts. Keep the shadow decimal-exact.
  const shadow = ledger.service as unknown as Record<string, unknown>
  const floatUpdate = shadow.updateBalances as (id: string, delta: number) => Promise<void>
  shadow.updateBalances = async (accountId: string, delta: number) => {
    await floatUpdate(accountId, delta)
    const acc = ledger.accounts.find((a) => a.id === accountId)
    if (acc) {
      acc.balance = Math.round(Number(acc.balance) * 1e8) / 1e8
      acc.available_balance = Math.round(Number(acc.available_balance) * 1e8) / 1e8
    }
  }
  const payouts = makeBreakdownService({
    configThrowsFrom: opts.configThrowsFrom,
    processingUnusable: opts.processingUnusable,
  })
  const ensureAssignment = jest.fn(async () => ({ plan_code: opts.planCode ?? "free" }))
  const getEntitledFeatureKeys = jest.fn(async () => [])
  const graph = jest.fn(async (q: { entity: string }) => {
    if (q.entity === "product") {
      return {
        data: [
          {
            id: "prod_1",
            metadata: opts.consignment
              ? { consignor_seller_id: opts.consignment.consignorSellerId, consignor_bps: opts.consignment.bps }
              : {},
            listing_type: { catalog_id: opts.consignment ? "consignment" : "standard" },
          },
        ],
      }
    }
    if (q.entity === "seller") {
      return { data: opts.consignment ? [{ id: opts.consignment.consignorSellerId }] : [] }
    }
    throw new Error(`unexpected graph entity ${q.entity}`)
  })
  const resolve = jest.fn((key: string) => {
    if (key === HAWALA_LEDGER_MODULE) return ledger.service
    if (key === PAYOUT_BREAKDOWN_MODULE) return payouts.svc
    if (key === Modules.ORDER) return { retrieveOrder: async () => opts.order }
    if (key === CREATOR_ATTRIBUTION_MODULE) return { listOrderAttributions: async () => [] }
    if (key === VENDOR_PLAN_MODULE) return { ensureAssignment, getEntitledFeatureKeys }
    if (key === ENTITLEMENT_MODULE) return { listActiveFeatureKeysForSeller: async () => [] }
    if (key === TENANCY_MODULE) return { resolveSellerTier: async () => "tier0_public" }
    if (key === MARKETPLACE_WEBHOOKS_MODULE) return { emitBlackout: async () => true }
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected container key: ${key}`)
  })
  return { ledger, payouts, ensureAssignment, graph, container: { resolve } as never }
}

const place = (container: never, orderId = "order_1") =>
  hawalaOrderPaymentSubscriber({ event: { data: { id: orderId } }, container } as never)

const refund = (container: never, refundAmount?: number, orderId = "order_1") =>
  hawalaOrderRefundSubscriber({
    event: { data: { id: orderId, refund_amount: refundAmount, reason: "Order cancelled" } },
    container,
  } as never)

const cents = (n: unknown) => Math.round(Number(n) * 100)
const account = (l: PoolLedger, id: string) => l.accounts.find((a) => a.id === id) as Row
const processingAccount = (l: PoolLedger) =>
  l.accounts.find((a) => a.account_type === "PLATFORM_FEE" && a.owner_id === CARD_PROCESSING_OWNER_ID)
const orderLegs = (l: PoolLedger) =>
  l.entries
    .filter((e) => e.entry_type !== "REFUND")
    .map((e) => [e.entry_type, cents(e.amount), e.idempotency_key])
/** Net cents through escrow over every COMPLETED-or-later entry. */
const escrowNetCents = (l: PoolLedger) =>
  l.entries.reduce((sum, e) => {
    if (e.status === "FAILED") return sum
    if (e.credit_account_id === "acc-escrow") return sum + cents(e.amount)
    if (e.debit_account_id === "acc-escrow") return sum - cents(e.amount)
    return sum
  }, 0)

beforeEach(() => {
  clearPlanFeatureCache()
})

afterEach(() => {
  // Flag specs mutate process.env; a leaked value flips later specs.
  delete process.env[FLAG]
  delete process.env[CONSIGNMENT_SPLIT_FLAG]
})

describe("FF_FEE_FIRST_SPLIT_V1", () => {
  it("is registered under the documented env name and defaults off", () => {
    expect(FLAG).toBe("FF_FEE_FIRST_SPLIT_V1")
    expect(featureFlagState.isEnabled("FEE_FIRST_SPLIT_V1")).toBe(false)
    process.env[FLAG] = "1"
    expect(featureFlagState.isEnabled("FEE_FIRST_SPLIT_V1")).toBe(false)
    process.env[FLAG] = "true"
    expect(featureFlagState.isEnabled("FEE_FIRST_SPLIT_V1")).toBe(true)
  })
})

describe("order.placed settlement, flag off — the pre-F6 legs exactly", () => {
  it("$40: PURCHASE 40.00, COMMISSION 1.20, seller 38.80, no processing leg or account", async () => {
    const w = makeWorld({ order: order40() })
    await place(w.container)

    expect(orderLegs(w.ledger)).toEqual([
      ["PURCHASE", 4000, "order-payment-order_1-purchase"],
      ["COMMISSION", 120, "order-payment-order_1-fee"],
      ["TRANSFER", 3880, "order-payment-order_1-seller"],
    ])
    expect(processingAccount(w.ledger)).toBeUndefined()
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(w.ensureAssignment).toHaveBeenCalledWith("sel_1")
  })

  it("keeps the unrounded dollar fee: $33.33 at 3% posts 0.9999, a known defect left byte-identical", async () => {
    const w = makeWorld({ order: order40({ total: 3333, subtotal: 3333 }) })
    await place(w.container)
    const fee = w.ledger.entries.find((e) => e.entry_type === "COMMISSION")
    expect(Number(fee?.amount)).toBeCloseTo(33.33 * 0.03, 12)
    expect(Number(fee?.amount)).not.toBe(1)
  })
})

describe("order.placed settlement, flag on — plain path", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("$40 at 3%: PURCHASE 40.00, COMMISSION 1.16, processing FEE 1.46, seller 37.38; escrow nets 0; COMMISSION x 100 === stored platform fee", async () => {
    const w = makeWorld({ order: order40() })
    await place(w.container)

    expect(orderLegs(w.ledger)).toEqual([
      ["PURCHASE", 4000, "order-payment-order_1-purchase"],
      ["COMMISSION", 116, "order-payment-order_1-fee"],
      ["FEE", 146, "order-payment-order_1-processing"],
      ["TRANSFER", 3738, "order-payment-order_1-seller"],
    ])
    expect(w.ledger.entries.every((e) => e.status === "COMPLETED")).toBe(true)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(Number(account(w.ledger, "acc-escrow").balance)).toBeCloseTo(0, 9)

    // The processing leg goes to the DEDICATED account, never SETTLEMENT and
    // never the shared PLATFORM_FEE balance the disbursers draw on.
    const proc = processingAccount(w.ledger)
    expect(proc).toMatchObject({ account_type: "PLATFORM_FEE", owner_type: "SYSTEM", owner_id: "processing" })
    const fee = w.ledger.entries.find((e) => e.entry_type === "FEE")!
    expect(fee.credit_account_id).toBe(proc!.id)
    expect(fee.debit_account_id).toBe("acc-escrow")
    expect(fee.metadata).toMatchObject({
      leg: CARD_PROCESSING_LEG,
      estimate: true,
      processing_percent: 2.9,
      processing_fixed_cents: 30,
      charged_total_cents: 4000,
    })
    expect(cents(account(w.ledger, "acc-platform").balance)).toBe(116)
    expect(cents(proc!.balance)).toBe(146)
    expect(w.ledger.accounts.some((a) => a.account_type === "SETTLEMENT")).toBe(false)

    // Ledger and stored breakdown agree to the cent.
    const commission = w.ledger.entries.find((e) => e.entry_type === "COMMISSION")!
    const stored = w.payouts.stored[0]
    // In integer cents (1.16 * 100 is 115.99999999999999 in a JS double).
    expect(cents(commission.amount)).toBe(stored.total_platform_fees)
    expect(stored).toMatchObject({
      total_platform_fees: 116,
      total_payment_processing: 146,
      total_to_producers: 3738,
    })
    // The real plan path ran (free plan, 3%), not platform-fee.ts's catch.
    expect(w.ensureAssignment).toHaveBeenCalledWith("sel_1")
  })

  it("$40 on the 0% all_access plan through the real plan read: COMMISSION 0, seller 38.54", async () => {
    const w = makeWorld({ order: order40(), planCode: "all_access" })
    await place(w.container)
    expect(orderLegs(w.ledger)).toEqual([
      ["PURCHASE", 4000, "order-payment-order_1-purchase"],
      ["COMMISSION", 0, "order-payment-order_1-fee"],
      ["FEE", 146, "order-payment-order_1-processing"],
      ["TRANSFER", 3854, "order-payment-order_1-seller"],
    ])
    expect(w.payouts.stored[0].total_platform_fees).toBe(0)
  })

  it("$5 at 3%: COMMISSION 0.14, processing 0.45, seller 4.41", async () => {
    const w = makeWorld({ order: order40({ total: 500, subtotal: 500 }) })
    await place(w.container)
    expect(orderLegs(w.ledger).map(([t, c]) => [t, c])).toEqual([
      ["PURCHASE", 500],
      ["COMMISSION", 14],
      ["FEE", 45],
      ["TRANSFER", 441],
    ])
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("tax, delivery and tip in the charge carry processing; commission stays on the subtotal less processing", async () => {
    // order.total 5020 = 4000 goods + 1020 tax/delivery/tip, all in the seller leg.
    const w = makeWorld({ order: order40({ total: 5020, subtotal: 4000 }) })
    await place(w.container)
    const commission = Math.round(0.03 * (4000 - 176))
    expect(orderLegs(w.ledger).map(([t, c]) => [t, c])).toEqual([
      ["PURCHASE", 5020],
      ["COMMISSION", commission],
      ["FEE", 176],
      ["TRANSFER", 5020 - 176 - commission],
    ])
    expect(w.payouts.stored[0].total_platform_fees).toBe(commission)
    expect(w.payouts.stored[0].total_payment_processing).toBe(176)
  })

  it("rounds the fee to the cent: $33.33 at 3% posts exactly the stored breakdown's fee", async () => {
    const w = makeWorld({ order: order40({ total: 3333, subtotal: 3333 }) })
    await place(w.container)
    const fee = w.ledger.entries.find((e) => e.entry_type === "COMMISSION")!
    expect(Number(fee.amount)).toBe(cents(fee.amount) / 100)
    expect(cents(fee.amount)).toBe(w.payouts.stored[0].total_platform_fees)
    expect(cents(fee.amount)).toBe(96)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })
})

describe("order.placed settlement, flag on — consignment path", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
  })

  it("splits what is left after processing AND commission: seller side 4000 - 146 - 116", async () => {
    const w = makeWorld({ order: order40(), consignment: { consignorSellerId: "sel_consignor", bps: 2500 } })
    await place(w.container)

    const legs = w.ledger.entries.map((e) => [e.entry_type, cents(e.amount), e.idempotency_key])
    expect(legs.slice(0, 3)).toEqual([
      ["PURCHASE", 4000, "order-payment-order_1-purchase"],
      ["COMMISSION", 116, "order-payment-order_1-fee"],
      ["FEE", 146, "order-payment-order_1-processing"],
    ])
    const split = w.ledger.entries.filter((e) => e.entry_type === "TRANSFER")
    expect(split.map((e) => e.idempotency_key).sort()).toEqual([
      "order-payment-order_1-consignor",
      "order-payment-order_1-vendor",
    ])
    expect(split.reduce((s, e) => s + cents(e.amount), 0)).toBe(4000 - 146 - 116)
    expect((split[0].metadata as { seller_amount_cents: number }).seller_amount_cents).toBe(3738)
    expect(escrowNetCents(w.ledger)).toBe(0)
    const proc = w.ledger.entries.find((e) => e.entry_type === "FEE")!
    expect(proc.credit_account_id).toBe(processingAccount(w.ledger)!.id)
    // Linked to its purchase exactly as the plain path's processing leg is.
    const purchase = w.ledger.entries.find((e) => e.entry_type === "PURCHASE")!
    expect(proc.correlation_id).toBe("order-payment-order_1")
    expect(proc.parent_entry_id).toBe(purchase.id)
  })
})

describe("order.placed settlement, flag on — payout_config unreachable", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("a config read that fails after the fee was resolved: still settles on the documented default, stamped config_fallback; only the breakdown is lost", async () => {
    // Read 1 resolves the platform fee (platform-fee.ts); read 2 is the
    // settlement's processing estimate; read 3 is calculateBreakdown's.
    const w = makeWorld({ order: order40(), configThrowsFrom: 2 })
    await place(w.container)
    expect(w.payouts.configReads.count).toBeGreaterThanOrEqual(3)
    expect(orderLegs(w.ledger)).toEqual([
      ["PURCHASE", 4000, "order-payment-order_1-purchase"],
      ["COMMISSION", 116, "order-payment-order_1-fee"],
      ["FEE", 146, "order-payment-order_1-processing"],
      ["TRANSFER", 3738, "order-payment-order_1-seller"],
    ])
    expect(w.ledger.entries.find((e) => e.entry_type === "FEE")?.metadata).toMatchObject({
      leg: CARD_PROCESSING_LEG,
      processing_percent: 2.9,
      processing_fixed_cents: 30,
      config_fallback: true,
    })
    expect(escrowNetCents(w.ledger)).toBe(0)
    // The breakdown's own config read fails too and is swallowed, as flag off.
    expect(w.payouts.stored).toHaveLength(0)
  })

  it("a config row with unusable processing figures: the default estimate, and the breakdown agrees with the ledger", async () => {
    const w = makeWorld({ order: order40(), processingUnusable: true })
    await place(w.container)
    expect(orderLegs(w.ledger).map(([t, c]) => [t, c])).toEqual([
      ["PURCHASE", 4000],
      ["COMMISSION", 116],
      ["FEE", 146],
      ["TRANSFER", 3738],
    ])
    expect(w.ledger.entries.find((e) => e.entry_type === "FEE")?.metadata).toMatchObject({ config_fallback: true })
    expect(w.payouts.stored[0]).toMatchObject({ total_platform_fees: 116, total_payment_processing: 146 })
  })

  it("reads payout_config once for the ledger and hands the same figures to the breakdown", async () => {
    const w = makeWorld({ order: order40() })
    await place(w.container)
    expect(w.ledger.entries.find((e) => e.entry_type === "FEE")?.metadata).not.toHaveProperty("config_fallback")
    expect(w.payouts.stored[0].total_payment_processing).toBe(146)
  })
})

describe("redelivery across a flag flip writes no second leg", () => {
  it("settled flag off, redelivered flag on: still the three pre-F6 legs, no processing leg; the first breakdown survives", async () => {
    const w = makeWorld({ order: order40() })
    await place(w.container)
    process.env[FLAG] = "true"
    await place(w.container)
    expect(orderLegs(w.ledger).map(([t]) => t)).toEqual(["PURCHASE", "COMMISSION", "TRANSFER"])
    expect(processingAccount(w.ledger)).toBeUndefined()
    // order_payout_breakdown.order_id is unique: the redelivery's fee-first
    // breakdown insert fails (and is swallowed), so the stored one is still
    // the flag-off breakdown, agreeing with the flag-off ledger.
    expect(w.payouts.stored).toHaveLength(1)
    const commission = w.ledger.entries.find((e) => e.entry_type === "COMMISSION")!
    expect(w.payouts.stored[0].total_platform_fees).toBe(cents(commission.amount))
    expect(w.payouts.stored[0].total_platform_fees).toBe(120)
  })

  it("settled flag on, redelivered flag off: still the four fee-first legs, no second seller leg; the first breakdown survives", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ order: order40() })
    await place(w.container)
    delete process.env[FLAG]
    await place(w.container)
    expect(orderLegs(w.ledger).map(([t, c]) => [t, c])).toEqual([
      ["PURCHASE", 4000],
      ["COMMISSION", 116],
      ["FEE", 146],
      ["TRANSFER", 3738],
    ])
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(w.payouts.stored).toHaveLength(1)
    const commission = w.ledger.entries.find((e) => e.entry_type === "COMMISSION")!
    expect(w.payouts.stored[0].total_platform_fees).toBe(cents(commission.amount))
    expect(w.payouts.stored[0].total_platform_fees).toBe(116)
  })
})

describe("refund, flag on — the vendor bears the processing Stripe keeps (6e)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("full refund: processing leg NOT reversed, the seller balancing leg absorbs it, escrow nets 0", async () => {
    const w = makeWorld({ order: order40(), sellerOpeningBalance: 50 })
    await place(w.container)
    await refund(w.container)

    const refunds = w.ledger.entries.filter((e) => e.entry_type === "REFUND")
    expect(refunds.map((e) => [e.description, cents(e.amount)])).toEqual([
      ["Order cancelled - platform fee reversal", 116],
      ["Order cancelled - seller portion", 4000 - 116],
      ["Order cancelled - customer refund", 4000],
    ])
    const proc = processingAccount(w.ledger)!
    // Nothing debits the processing account; it keeps the 1.46.
    expect(w.ledger.entries.some((e) => e.debit_account_id === proc.id)).toBe(false)
    expect(cents(proc.balance)).toBe(146)
    // The leg stays COMPLETED (it was not reversed); the others are REVERSED.
    const legStatus = Object.fromEntries(
      w.ledger.entries.filter((e) => e.entry_type !== "REFUND").map((e) => [e.entry_type, e.status])
    )
    expect(legStatus).toEqual({ PURCHASE: "REVERSED", COMMISSION: "REVERSED", FEE: "COMPLETED", TRANSFER: "REVERSED" })
    // Escrow nets to zero; the platform fee is returned in full; the vendor is
    // down exactly the processing on this order.
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(Number(account(w.ledger, "acc-escrow").balance)).toBeCloseTo(0, 9)
    expect(cents(account(w.ledger, "acc-platform").balance)).toBe(0)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(5000 - 146)
    expect(cents(account(w.ledger, "acc-wallet").balance)).toBe(100_000)
  })

  it("partial refund ($20 of $40): processing still not reversed, escrow nets 0", async () => {
    const w = makeWorld({ order: order40(), sellerOpeningBalance: 50 })
    await place(w.container)
    await refund(w.container, 20)

    const refunds = w.ledger.entries.filter((e) => e.entry_type === "REFUND")
    expect(refunds.map((e) => [e.description, cents(e.amount)])).toEqual([
      ["Order cancelled - platform fee reversal", 58],
      ["Order cancelled - seller portion", 2000 - 58],
      ["Order cancelled - customer refund", 2000],
    ])
    expect(cents(processingAccount(w.ledger)!.balance)).toBe(146)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(5000 + 3738 - (2000 - 58))
  })

  it("consignment full refund: both seller-side legs absorb it pro rata, escrow nets 0", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    const w = makeWorld({
      order: order40(),
      sellerOpeningBalance: 50,
      consignment: { consignorSellerId: "sel_consignor", bps: 2500 },
    })
    // The consignor's own earnings account, with prior earnings to absorb from.
    w.ledger.accounts.push(
      makeAccount("acc-consignor", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_consignor", balance: 50, available_balance: 50 })
    )
    await place(w.container)
    await refund(w.container)
    const sellerRefunds = w.ledger.entries.filter((e) => e.entry_type === "REFUND" && /seller portion/.test(String(e.description)))
    expect(sellerRefunds).toHaveLength(2)
    expect(sellerRefunds.reduce((s, e) => s + cents(e.amount), 0)).toBe(4000 - 116)
    expect(cents(processingAccount(w.ledger)!.balance)).toBe(146)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("vendor whose only earnings are this order: the refund still posts and the 1.46 is recorded as owed by the vendor", async () => {
    // The order credited the vendor 37.38; the balancing leg is 38.84. The
    // ledger refuses a negative balance, and refusing the refund would leave
    // 37.38 of earnings for a refunded order payable by ACH. So the vendor's
    // leg takes all 37.38 and the 1.46 gap is a vendor-shortfall leg from the
    // card-processing account: a receivable whose recovery the operator decides.
    const w = makeWorld({ order: order40(), sellerOpeningBalance: 0 })
    await place(w.container)
    await refund(w.container)

    const refunds = w.ledger.entries.filter(
      (e) => e.entry_type === "REFUND" || e.entry_type === "ADJUSTMENT"
    )
    expect(refunds.map((e) => [e.entry_type, cents(e.amount), e.idempotency_key])).toEqual([
      ["REFUND", 116, "order-refund-order_1-fee"],
      ["REFUND", 3738, "order-refund-order_1-seller"],
      ["ADJUSTMENT", 146, "order-refund-order_1-processing-shortfall"],
      ["REFUND", 4000, "order-refund-order_1-customer"],
    ])
    expect(refunds.every((e) => e.status === "COMPLETED")).toBe(true)
    const shortfall = w.ledger.entries.find((e) => isCardProcessingShortfallLeg(e as { entry_type?: string; metadata?: unknown }))!
    const proc = processingAccount(w.ledger)!
    expect(shortfall.debit_account_id).toBe(proc.id)
    expect(shortfall.credit_account_id).toBe("acc-escrow")
    expect(shortfall.metadata).toMatchObject({
      leg: CARD_PROCESSING_SHORTFALL_LEG,
      owed_by_account_id: "acc-earnings",
      receivable: true,
    })
    // The customer is refunded in full, escrow nets to zero, the vendor keeps
    // nothing payable for the refunded order, and the processing leg itself
    // is still COMPLETED (Stripe did keep the fee).
    expect(cents(account(w.ledger, "acc-wallet").balance)).toBe(100_000)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(Number(account(w.ledger, "acc-escrow").balance)).toBeCloseTo(0, 9)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
    expect(cents(account(w.ledger, "acc-platform").balance)).toBe(0)
    expect(w.ledger.entries.find((e) => e.entry_type === "FEE")?.status).toBe("COMPLETED")
    expect(cents(proc.balance)).toBe(0)
  })

  it("partial refund the vendor can only partly absorb: the gap is recorded, never more than the processing", async () => {
    const w = makeWorld({ order: order40(), sellerOpeningBalance: 0 })
    await place(w.container)
    // A payout since: the vendor now holds 19.00 of the order's 37.38.
    const earnings = account(w.ledger, "acc-earnings")
    earnings.balance = 19
    earnings.available_balance = 19
    await refund(w.container, 20)

    // Balancing leg 20 - 0.58 = 19.42; the vendor covers 19.00; 0.42 is owed.
    const legs = w.ledger.entries
      .filter((e) => e.entry_type === "REFUND" || e.entry_type === "ADJUSTMENT")
      .map((e) => [e.entry_type, cents(e.amount)])
    expect(legs).toEqual([
      ["REFUND", 58],
      ["REFUND", 1900],
      ["ADJUSTMENT", 42],
      ["REFUND", 2000],
    ])
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("consignment, both parties with no other earnings: each leg's gap is recorded under its own key", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    const w = makeWorld({
      order: order40(),
      sellerOpeningBalance: 0,
      consignment: { consignorSellerId: "sel_consignor", bps: 2500 },
    })
    w.ledger.accounts.push(
      makeAccount("acc-consignor", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_consignor", balance: 0, available_balance: 0 })
    )
    await place(w.container)
    await refund(w.container)
    const gaps = w.ledger.entries.filter((e) => isCardProcessingShortfallLeg(e as { entry_type?: string; metadata?: unknown }))
    expect(gaps.map((e) => e.idempotency_key).sort()).toEqual([
      "order-refund-order_1-processing-shortfall-consignor",
      "order-refund-order_1-processing-shortfall-vendor",
    ])
    expect(gaps.reduce((s, e) => s + cents(e.amount), 0)).toBe(146)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(cents(account(w.ledger, "acc-wallet").balance)).toBe(100_000)
    const sellerSide = w.ledger.accounts.filter((a) => a.account_type === "SELLER_EARNINGS")
    expect(sellerSide.every((a) => cents(a.balance) === 0)).toBe(true)
  })

  it("refuses cleanly, before any leg, only when the gap exceeds the processing (vendor already paid out)", async () => {
    // The case a flag-off refund cannot post either: the vendor holds nothing.
    const w = makeWorld({ order: order40(), sellerOpeningBalance: 0 })
    await place(w.container)
    const earnings = account(w.ledger, "acc-earnings")
    earnings.balance = 0
    earnings.available_balance = 0
    const before = w.ledger.entries.length
    await refund(w.container) // the subscriber logs and swallows the refusal
    expect(w.ledger.entries).toHaveLength(before)
    expect(escrowNetCents(w.ledger)).toBe(0)
    await expect(w.ledger.service.processRefund({ order_id: "order_1" })).rejects.toThrow(
      /refused before any leg posted: the vendor's earnings fall \$38.84 short of the seller balancing leg, more than the \$1.46/
    )
  })
})

describe("refund, order settled flag off — unchanged", () => {
  it("full refund reverses fee and seller exactly as before; no processing anywhere", async () => {
    const w = makeWorld({ order: order40() })
    await place(w.container)
    await refund(w.container)
    expect(
      w.ledger.entries.filter((e) => e.entry_type === "REFUND").map((e) => [e.description, cents(e.amount)])
    ).toEqual([
      ["Order cancelled - platform fee reversal", 120],
      ["Order cancelled - seller portion", 3880],
      ["Order cancelled - customer refund", 4000],
    ])
    expect(w.ledger.entries.filter((e) => e.entry_type !== "REFUND").every((e) => e.status === "REVERSED")).toBe(true)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })
})
