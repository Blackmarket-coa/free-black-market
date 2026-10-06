import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import hawalaOrderPaymentSubscriber from "../hawala-order-payment"
import hawalaOrderRefundSubscriber from "../hawala-order-refund"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../shared/feature-flags"
import { clearPlanFeatureCache } from "../../shared/plan-entitlement-cache"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"
import {
  CARD_PROCESSING_LEG,
  CARD_PROCESSING_OWNER_ID,
  CARD_PROCESSING_RECOVERY_LEG,
  CARD_PROCESSING_SHORTFALL_LEG,
  isCardProcessingRecoveryLeg,
  isCardProcessingShortfallLeg,
} from "../../modules/hawala-ledger/card-processing"
import HawalaLedgerModuleService from "../../modules/hawala-ledger/service"
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
  /** Further orders the order module can retrieve by id (later sales). */
  orders?: Order[]
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
  // The ledger's unique index on idempotency_key (models/ledger-entry.ts):
  // a second insert under a key throws a Postgres-shaped 23505, after a tick
  // so two concurrent writers both pass createTransfer's pre-read and the
  // index is what decides. Production has it; without it a race the index
  // would refuse could post twice here.
  const keyRejections: string[] = []
  const insertEntry = shadow.createLedgerEntries as (d: Record<string, unknown>) => Promise<Row>
  // Postgres stamps created_at on every row; a strictly increasing clock here
  // so "posted before / after" reads the way it does in production.
  let clock = 0
  shadow.createLedgerEntries = async (data: Record<string, unknown>) => {
    await new Promise<void>((r) => setTimeout(r, 0))
    const key = data.idempotency_key
    if (typeof key === "string" && ledger.entries.some((e) => e.idempotency_key === key)) {
      keyRejections.push(key)
      throw Object.assign(new Error(`duplicate key value violates unique constraint "IDX_ledger_entry_idempotency_key"`), {
        code: "23505",
      })
    }
    return insertEntry({ created_at: new Date(Date.UTC(2026, 9, 1) + ++clock * 1000), ...data })
  }
  // Payout persistence for requestPayout (in-memory rows). PAYOUT_TIERS is a
  // class field the prototype-built service does not run; WEEKLY is the
  // fee-free ACH tier the backstop specs use.
  shadow.PAYOUT_TIERS = {
    WEEKLY: { fee_rate: 0, name: "Weekly", speed: "Every Friday", method: "ACH_BATCH" },
  }
  const payoutRequests: Row[] = []
  shadow.listPayoutConfigs = async () => []
  // The vendor dashboard's other reads (no advances, no pools here).
  shadow.listVendorAdvances = async () => []
  shadow.listInvestmentPools = async () => []
  // Vendor-to-vendor payment records (createVendorToVendorPayment).
  const vendorPayments: Row[] = []
  shadow.createVendorPayments = async (data: Record<string, unknown>) => {
    const row = { id: `vp_${vendorPayments.length + 1}`, ...data } as Row
    vendorPayments.push(row)
    return row
  }
  shadow.createPayoutRequests = async (data: Record<string, unknown>) => {
    const row = { id: `pr_${payoutRequests.length + 1}`, ...data } as Row
    payoutRequests.push(row)
    return row
  }
  shadow.updatePayoutRequests = async (data: Record<string, unknown> & { id: string }) => {
    const row = payoutRequests.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }
  const allOrders = [opts.order, ...(opts.orders ?? [])]
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
    if (key === Modules.ORDER)
      return { retrieveOrder: async (id: string) => allOrders.find((o) => o.id === id) ?? opts.order }
    if (key === CREATOR_ATTRIBUTION_MODULE) return { listOrderAttributions: async () => [] }
    if (key === VENDOR_PLAN_MODULE) return { ensureAssignment, getEntitledFeatureKeys }
    if (key === ENTITLEMENT_MODULE) return { listActiveFeatureKeysForSeller: async () => [] }
    if (key === TENANCY_MODULE) return { resolveSellerTier: async () => "tier0_public" }
    if (key === MARKETPLACE_WEBHOOKS_MODULE) return { emitBlackout: async () => true }
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected container key: ${key}`)
  })
  return { ledger, payouts, ensureAssignment, graph, keyRejections, payoutRequests, vendorPayments, container: { resolve } as never }
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

// ==================== F6 shortfall recovery (operator answer 2026-10-06) ====================

const recoveryLegs = (l: PoolLedger) =>
  l.entries.filter((e) => isCardProcessingRecoveryLeg(e as { entry_type?: string; metadata?: unknown }))
const shortfallLegs = (l: PoolLedger) =>
  l.entries.filter((e) => isCardProcessingShortfallLeg(e as { entry_type?: string; metadata?: unknown }))
const sellerLeg = (l: PoolLedger, orderId: string) =>
  l.entries.find((e) => e.idempotency_key === `order-payment-${orderId}-seller`)!
const owedCents = async (l: PoolLedger, accountId = "acc-earnings") =>
  (await l.service.getCardProcessingReceivable(accountId)).total_cents

/**
 * Order 1 ($40, fee-first) refunded to a vendor holding nothing else: the
 * 1.46 the vendor could not absorb is recorded as a shortfall leg owed by
 * acc-earnings (the shape asserted above).
 */
async function worldWithShortfall(extra: { orders?: Order[]; consignment?: { consignorSellerId: string; bps: number } } = {}) {
  process.env[FLAG] = "true"
  const w = makeWorld({ order: order40(), sellerOpeningBalance: 0, ...extra })
  if (extra.consignment) {
    w.ledger.accounts.push(
      makeAccount("acc-consignor", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: extra.consignment.consignorSellerId, balance: 0, available_balance: 0 })
    )
  }
  await place(w.container)
  await refund(w.container)
  expect(shortfallLegs(w.ledger).length).toBeGreaterThan(0)
  return w
}

describe("shortfall recovery — from the vendor's next earnings", () => {
  it("the next order repays the whole 1.46: one ADJUSTMENT leg, vendor -> card processing, no order_id, on the statement", async () => {
    const w = await worldWithShortfall({ orders: [order40({ id: "order_2" })] })
    const [shortfall] = shortfallLegs(w.ledger)
    expect(await owedCents(w.ledger)).toBe(146)
    const before = await w.ledger.service.getVendorDashboard("sel_1")
    expect(before.card_processing_owed).toEqual({
      outstanding: 1.46,
      open: [{ order_id: "order_1", amount: 1.46, since: shortfall.created_at }],
      // Nothing is 180 days old here, so nothing is forgiven.
      forgiven: [],
    })

    await place(w.container, "order_2")

    const legs = recoveryLegs(w.ledger)
    expect(legs).toHaveLength(1)
    const [leg] = legs
    const proc = processingAccount(w.ledger)!
    expect(leg).toMatchObject({
      entry_type: "ADJUSTMENT",
      status: "COMPLETED",
      debit_account_id: "acc-earnings",
      credit_account_id: proc.id,
      reference_type: "ORDER",
      reference_id: "order_1",
      parent_entry_id: shortfall.id,
      correlation_id: "order-payment-order_2",
      idempotency_key: `cp-recovery-${shortfall.id}-0`,
    })
    expect(cents(leg.amount)).toBe(146)
    // No order_id: a later refund of order 2 must not flip it to REVERSED.
    expect(leg.order_id).toBeUndefined()
    expect(leg.metadata).toMatchObject({
      leg: CARD_PROCESSING_RECOVERY_LEG,
      recovers_entry_id: shortfall.id,
      owed_by_account_id: "acc-earnings",
      recovered_from_order_id: "order_1",
      source: "seller_credit",
      source_entry_id: sellerLeg(w.ledger, "order_2").id,
      source_order_id: "order_2",
      seq: 0,
    })
    // The vendor keeps order 2's credit less what was owed; the processing
    // account gets back what the shortfall used up; escrow still nets to 0.
    expect(cents(sellerLeg(w.ledger, "order_2").amount)).toBe(3738)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(3738 - 146)
    expect(cents(proc.balance)).toBe(146 /* order 2's processing */ + 146 /* repaid */)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(await owedCents(w.ledger)).toBe(0)

    // The vendor's statement reads it plainly; the owed line is gone.
    const after = await w.ledger.service.getVendorDashboard("sel_1")
    expect(after.card_processing_owed).toEqual({ outstanding: 0, open: [], forgiven: [] })
    const debit = after.recent_transactions.find((t: { id: string }) => t.id === leg.id)!
    expect(debit).toMatchObject({ direction: "DEBIT", entry_type: "ADJUSTMENT", amount: 1.46 })
    expect(debit.description).toBe(
      "Card processing repaid from order order_2: card processing on order order_1 is not returned on a refund, and your earnings did not cover it"
    )
    expect(debit.description).not.toMatch(/increase|penalty|Stripe/i)
  })

  it("partial over two orders: a $1 sale repays what it can, the next sale the rest, oldest-first, never below zero", async () => {
    const w = await worldWithShortfall({
      orders: [order40({ id: "order_2", total: 100, subtotal: 100 }), order40({ id: "order_3" })],
    })
    const [shortfall] = shortfallLegs(w.ledger)

    await place(w.container, "order_2")
    const small = cents(sellerLeg(w.ledger, "order_2").amount)
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThan(146)
    expect(recoveryLegs(w.ledger).map((e) => [cents(e.amount), e.idempotency_key])).toEqual([
      [small, `cp-recovery-${shortfall.id}-0`],
    ])
    // All of the $1 sale's credit went to the receivable; nothing below zero.
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
    expect(await owedCents(w.ledger)).toBe(146 - small)

    await place(w.container, "order_3")
    expect(recoveryLegs(w.ledger).map((e) => [cents(e.amount), e.idempotency_key, (e.metadata as { source_order_id: string }).source_order_id])).toEqual([
      [small, `cp-recovery-${shortfall.id}-0`, "order_2"],
      [146 - small, `cp-recovery-${shortfall.id}-1`, "order_3"],
    ])
    expect(await owedCents(w.ledger)).toBe(0)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(3738 - (146 - small))
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("consignment: the consignor's shortfall is recovered from the consignor's own next credit, the vendor's from the vendor's", async () => {
    process.env[CONSIGNMENT_SPLIT_FLAG] = "1"
    const w = await worldWithShortfall({
      consignment: { consignorSellerId: "sel_consignor", bps: 2500 },
      orders: [order40({ id: "order_2" })],
    })
    const owedBy = Object.fromEntries(
      shortfallLegs(w.ledger).map((e) => [(e.metadata as { owed_by_account_id: string }).owed_by_account_id, e])
    )
    expect(Object.keys(owedBy).sort()).toEqual(["acc-consignor", "acc-earnings"])

    await place(w.container, "order_2")

    const legs = recoveryLegs(w.ledger)
    expect(legs).toHaveLength(2)
    for (const leg of legs) {
      const meta = leg.metadata as { recovers_entry_id: string; owed_by_account_id: string; source_entry_id: string }
      // Each leg debits the account that owes, repays THAT account's shortfall,
      // and is sourced from that account's own credit on order 2.
      expect(leg.debit_account_id).toBe(meta.owed_by_account_id)
      expect(owedBy[meta.owed_by_account_id].id).toBe(meta.recovers_entry_id)
      expect(cents(leg.amount)).toBe(cents(owedBy[meta.owed_by_account_id].amount))
      const source = w.ledger.entries.find((e) => e.id === meta.source_entry_id)!
      expect(source.credit_account_id).toBe(meta.owed_by_account_id)
      expect(source.idempotency_key).toMatch(/^order-payment-order_2-(consignor|vendor)$/)
    }
    expect(await owedCents(w.ledger, "acc-consignor")).toBe(0)
    expect(await owedCents(w.ledger, "acc-earnings")).toBe(0)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("redelivery writes nothing twice: neither a redelivered order.placed nor a direct re-run of the settlement re-collects from a credit already used", async () => {
    const w = await worldWithShortfall({ orders: [order40({ id: "order_2", total: 100, subtotal: 100 })] })
    await place(w.container, "order_2")
    const small = cents(sellerLeg(w.ledger, "order_2").amount)
    expect(recoveryLegs(w.ledger).map((e) => cents(e.amount))).toEqual([small])
    // Still owed after the $1 sale gave all it had.
    expect(await owedCents(w.ledger)).toBe(146 - small)
    const count = w.ledger.entries.length

    await place(w.container, "order_2") // the subscriber skips a settled order
    expect(w.ledger.entries).toHaveLength(count)

    // Bypass the subscriber's guard: the settlement itself re-run under the
    // same key, with the vendor now holding $10 from elsewhere. Every leg
    // comes back as the existing row, and that seller credit has already
    // given everything it had to the receivable, so the recovery posts
    // nothing although 146 - small is still owed and there is balance to
    // take it from (that is the payout backstop's job, not this credit's —
    // a second leg here would also count toward order 2's refund cap twice).
    const e = account(w.ledger, "acc-earnings")
    e.balance = 10
    e.available_balance = 10
    await w.ledger.service.processOrderPayment({
      customer_account_id: "acc-wallet",
      seller_account_id: "acc-earnings",
      order_id: "order_2",
      total_amount: 1,
      platform_fee_amount: Number(w.ledger.entries.find((e) => e.idempotency_key === "order-payment-order_2-fee")!.amount),
      processing_fee_amount: Number(w.ledger.entries.find((e) => e.idempotency_key === "order-payment-order_2-processing")!.amount),
      idempotency_key: "order-payment-order_2",
    })
    expect(w.ledger.entries).toHaveLength(count)
    expect(await owedCents(w.ledger)).toBe(146 - small)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(1000)
  })
})

describe("shortfall recovery — payout backstop", () => {
  /** A credit that never ran the next-earnings recovery (a crash before it, whose redelivery the subscriber skips, or a non-order credit). */
  const creditOutsideSettlement = (w: ReturnType<typeof makeWorld>, dollars: number) => {
    const e = account(w.ledger, "acc-earnings")
    e.balance = Number(e.balance) + dollars
    e.available_balance = Number(e.available_balance) + dollars
  }

  it("recovers what is owed BEFORE the WITHDRAWAL, then refuses only the excess", async () => {
    const w = await worldWithShortfall()
    creditOutsideSettlement(w, 20)

    const options = await w.ledger.service.getPayoutOptions("sel_1")
    expect(options).toMatchObject({ available_balance: 20, payable_balance: 18.54, card_processing_owed: 1.46 })
    expect(options.options.find((o: { tier: string }) => o.tier === "WEEKLY")).toMatchObject({ net_amount: 18.54 })

    // Asking for the whole balance: the 1.46 is repaid first, the balance is
    // re-read, and the payout is refused — nothing is withdrawn.
    await expect(
      w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 20, payout_tier: "WEEKLY" })
    ).rejects.toThrow(
      "Insufficient balance: $18.54 is available to pay out after $1.46 of card processing owed was repaid from your balance"
    )
    const [leg] = recoveryLegs(w.ledger)
    expect(leg).toMatchObject({ debit_account_id: "acc-earnings", status: "COMPLETED" })
    expect(leg.metadata).toMatchObject({ source: "payout", recovered_from_order_id: "order_1" })
    expect(leg.description).toBe(
      "Card processing repaid from your balance before payout: card processing on order order_1 is not returned on a refund, and your earnings did not cover it"
    )
    expect(w.ledger.entries.some((e) => e.entry_type === "WITHDRAWAL")).toBe(false)
    expect(w.payoutRequests).toHaveLength(0)
    expect(await owedCents(w.ledger)).toBe(0)

    // One cent over the net is still refused; the net itself goes through.
    await expect(
      w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 18.55, payout_tier: "WEEKLY" })
    ).rejects.toThrow("Insufficient balance")
    await w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 18.54, payout_tier: "WEEKLY" })
    const withdrawal = w.ledger.entries.find((e) => e.entry_type === "WITHDRAWAL")!
    expect(cents(withdrawal.amount)).toBe(1854)
    expect(w.ledger.entries.indexOf(withdrawal)).toBeGreaterThan(w.ledger.entries.indexOf(leg))
    expect(recoveryLegs(w.ledger)).toHaveLength(1)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
  })

  it("a balance smaller than what is owed: takes it all, still owes the rest, and no payout can leave", async () => {
    const w = await worldWithShortfall()
    creditOutsideSettlement(w, 1)
    await expect(
      w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 0.5, payout_tier: "WEEKLY" })
    ).rejects.toThrow(
      "Insufficient balance: $0.00 is available to pay out after $1.00 of card processing owed was repaid from your balance; $0.46 of card processing is still owed and is taken from your next sales"
    )
    expect(recoveryLegs(w.ledger).map((e) => cents(e.amount))).toEqual([100])
    expect(await owedCents(w.ledger)).toBe(46)
    expect(w.ledger.entries.some((e) => e.entry_type === "WITHDRAWAL")).toBe(false)
  })

  it("if the backstop's own leg cannot post, the payout is still limited to the balance net of what is owed", async () => {
    const w = await worldWithShortfall()
    creditOutsideSettlement(w, 20)
    const shadow = w.ledger.service as unknown as Record<string, unknown>
    shadow.recoverCardProcessingShortfallLocked_ = async () => {
      throw new Error("recovery unavailable")
    }
    await expect(
      w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 20, payout_tier: "WEEKLY" })
    ).rejects.toThrow("Insufficient balance: $18.54 is available to pay out; $1.46 of card processing is still owed")
    await w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 18.54, payout_tier: "WEEKLY" })
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(146)
  })
})

describe("shortfall recovery — races, refunds, flags", () => {
  it("two concurrent recoveries of the same receivable make ONE leg: the second loses on the unique key and re-reads", async () => {
    const w = await worldWithShortfall()
    const e = account(w.ledger, "acc-earnings")
    e.balance = 20
    e.available_balance = 20
    const run = () =>
      w.ledger.service.recoverCardProcessingShortfall({
        sellerAccountId: "acc-earnings",
        maxAmountCents: 2000,
        source: "payout",
      })
    const [a, b] = await Promise.all([run(), run()])
    // The race really happened: both writers reached the insert under the
    // same seq, and the index refused one of them.
    expect(w.keyRejections.filter((k) => k.startsWith("cp-recovery-"))).toHaveLength(1)
    expect(a.length + b.length).toBe(1)
    expect(recoveryLegs(w.ledger)).toHaveLength(1)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(2000 - 146)
    expect(await owedCents(w.ledger)).toBe(0)
  })

  it("two orders settling at once repay the 1.46 once between them", async () => {
    const w = await worldWithShortfall({ orders: [order40({ id: "order_2" }), order40({ id: "order_3" })] })
    await Promise.all([place(w.container, "order_2"), place(w.container, "order_3")])
    expect(recoveryLegs(w.ledger).reduce((sum, e) => sum + cents(e.amount), 0)).toBe(146)
    expect(await owedCents(w.ledger)).toBe(0)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(2 * 3738 - 146)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("a refund of an order whose earnings repaid a receivable succeeds: the cap rises by what it repaid and the receivable is re-recorded", async () => {
    const w = await worldWithShortfall({ orders: [order40({ id: "order_2" })] })
    const [first] = shortfallLegs(w.ledger)
    await place(w.container, "order_2")
    const [recovery] = recoveryLegs(w.ledger)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(3738 - 146)

    await refund(w.container, undefined, "order_2")

    const legs = w.ledger.entries
      .filter((e) => (e.entry_type === "REFUND" || e.entry_type === "ADJUSTMENT") && String(e.idempotency_key).startsWith("order-refund-order_2"))
      .map((e) => [e.entry_type, cents(e.amount), e.idempotency_key])
    // Vendor holds 35.92 of the 38.84 balancing leg: the gap 2.92 is order
    // 2's own 1.46 plus the 1.46 its earnings repaid toward order 1.
    expect(legs).toEqual([
      ["REFUND", 116, "order-refund-order_2-fee"],
      ["REFUND", 3592, "order-refund-order_2-seller"],
      ["ADJUSTMENT", 292, "order-refund-order_2-processing-shortfall"],
      ["REFUND", 4000, "order-refund-order_2-customer"],
    ])
    const reopened = shortfallLegs(w.ledger).find((e) => e.idempotency_key === "order-refund-order_2-processing-shortfall")!
    expect(reopened.metadata).toMatchObject({
      owed_by_account_id: "acc-earnings",
      processing_retained: 1.46,
      repaid_from_this_order: 1.46,
      reopens_entry_ids: [first.id],
    })
    // The recovery leg stays COMPLETED (no order_id, so the refund never
    // listed it); the first shortfall still reads repaid; what is owed now
    // is both orders' processing.
    expect(w.ledger.entries.find((e) => e.id === recovery.id)?.status).toBe("COMPLETED")
    expect(await owedCents(w.ledger)).toBe(292)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
    expect(cents(account(w.ledger, "acc-wallet").balance)).toBe(100_000)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(cents(processingAccount(w.ledger)!.balance)).toBe(0)
  })

  it("rolling the flag back with a receivable outstanding: a flag-off sale still repays it", async () => {
    const w = await worldWithShortfall({ orders: [order40({ id: "order_2" })] })
    delete process.env[FLAG]
    await place(w.container, "order_2")
    expect(orderLegs(w.ledger).filter(([, , k]) => String(k).startsWith("order-payment-order_2"))).toEqual([
      ["PURCHASE", 4000, "order-payment-order_2-purchase"],
      ["COMMISSION", 120, "order-payment-order_2-fee"],
      ["TRANSFER", 3880, "order-payment-order_2-seller"],
    ])
    expect(recoveryLegs(w.ledger).map((e) => [cents(e.amount), (e.metadata as { source_order_id: string }).source_order_id])).toEqual([
      [146, "order_2"],
    ])
    expect(await owedCents(w.ledger)).toBe(0)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(3880 - 146)

    // And a flag-off refund of that order is not refused for it either.
    await refund(w.container, undefined, "order_2")
    expect(w.ledger.entries.find((e) => e.idempotency_key === "order-refund-order_2-customer")).toBeDefined()
    expect(await owedCents(w.ledger)).toBe(146)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("no shortfall anywhere: flag off, a sale, a refund and a payout make no extra leg, never create the processing account, and read it once each", async () => {
    const w = makeWorld({ order: order40(), orders: [order40({ id: "order_2" })] })
    const shadow = w.ledger.service as unknown as Record<string, unknown>
    const listAccounts = shadow.listLedgerAccounts as (f: Record<string, unknown>) => Promise<Row[]>
    const processingReads: number[] = []
    shadow.listLedgerAccounts = async (f: Record<string, unknown>) => {
      if (f.owner_id === CARD_PROCESSING_OWNER_ID) processingReads.push(1)
      return listAccounts(f)
    }
    const lock = jest.spyOn(HawalaLedgerModuleService.prototype as never, "withSellerAccountLock_" as never)

    await place(w.container)
    expect(processingReads).toHaveLength(1)
    expect(orderLegs(w.ledger).map(([t]) => t)).toEqual(["PURCHASE", "COMMISSION", "TRANSFER"])
    await place(w.container, "order_2")
    await refund(w.container, undefined, "order_2")
    await w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 10, payout_tier: "WEEKLY" })

    expect(processingAccount(w.ledger)).toBeUndefined()
    expect(w.ledger.entries.some((e) => e.entry_type === "ADJUSTMENT")).toBe(false)
    expect(processingReads).toHaveLength(4)
    expect(lock).not.toHaveBeenCalled()
    expect(w.ledger.entries.find((e) => e.entry_type === "WITHDRAWAL")?.idempotency_key).toBe("payout-pr_1-net")
    lock.mockRestore()
  })

  it("flag on, nothing owed: the four fee-first legs and nothing else; the payout takes no lock", async () => {
    process.env[FLAG] = "true"
    const w = makeWorld({ order: order40() })
    const lock = jest.spyOn(HawalaLedgerModuleService.prototype as never, "withSellerAccountLock_" as never)
    await place(w.container)
    await w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 37.38, payout_tier: "WEEKLY" })
    expect(w.ledger.entries.map((e) => e.entry_type)).toEqual(["PURCHASE", "COMMISSION", "FEE", "TRANSFER", "WITHDRAWAL"])
    expect(lock).not.toHaveBeenCalled()
    lock.mockRestore()
  })
})

describe("shortfall recovery — per-account serialization", () => {
  it("with a pg connection, recovery and payout run under a transaction-scoped advisory lock on the seller account, bounded by lock_timeout", async () => {
    const svc = Object.create(HawalaLedgerModuleService.prototype) as Record<string, unknown>
    const sql: Array<[string, unknown[]]> = []
    let inside = false
    svc.resolvePgConnection = () => ({
      raw: async () => {
        throw new Error("the lock never runs a statement outside its transaction")
      },
      transaction: async (work: (trx: unknown) => Promise<unknown>) => {
        inside = true
        try {
          return await work({
            raw: async (text: string, bindings: unknown[] = []) => {
              sql.push([text, bindings])
              return { rowCount: 1 }
            },
          })
        } finally {
          inside = false
        }
      },
    })
    const lock = svc.withSellerAccountLock_ as (id: string, fn: () => Promise<string>) => Promise<string>
    const ran = await lock.call(svc, "acc-earnings", async () => {
      expect(inside).toBe(true)
      return "ok"
    })
    expect(ran).toBe("ok")
    expect(sql).toEqual([
      ["SET LOCAL lock_timeout = '5s'", []],
      ["SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))", ["hawala-seller-earnings", "acc-earnings"]],
    ])
  })

  it("a payout with a receivable on record runs inside that lock", async () => {
    const w = await worldWithShortfall()
    const e = account(w.ledger, "acc-earnings")
    e.balance = 20
    e.available_balance = 20
    const lock = jest.spyOn(HawalaLedgerModuleService.prototype as never, "withSellerAccountLock_" as never)
    await w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 18.54, payout_tier: "WEEKLY" })
    expect(lock).toHaveBeenCalledTimes(1)
    expect((lock.mock.calls[0] as unknown[])[0]).toBe("acc-earnings")
    lock.mockRestore()
  })
})

describe("shortfall recovery — vendor-to-vendor payments (no way around the backstop)", () => {
  const withPayee = (w: ReturnType<typeof makeWorld>) => {
    w.ledger.accounts.push(
      makeAccount("acc-payee", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_2", balance: 0, available_balance: 0 })
    )
  }
  const holding = (w: ReturnType<typeof makeWorld>, dollars: number) => {
    const e = account(w.ledger, "acc-earnings")
    e.balance = Number(e.balance) + dollars
    e.available_balance = Number(e.available_balance) + dollars
  }
  const pay = (w: ReturnType<typeof makeWorld>, amount: number) =>
    w.ledger.service.createVendorToVendorPayment({
      payer_vendor_id: "sel_1",
      payee_vendor_id: "sel_2",
      amount,
      payment_type: "INVOICE",
    })
  const vendorPaymentLegs = (l: PoolLedger) => l.entries.filter((e) => e.entry_type === "VENDOR_PAYMENT")

  it("a vendor who owes cannot pay the whole balance to a second seller account: what is owed is repaid first and only the excess is refused", async () => {
    const w = await worldWithShortfall()
    withPayee(w)
    holding(w, 20)

    await expect(pay(w, 20)).rejects.toThrow(
      "Insufficient balance: $18.54 is available to pay after $1.46 of card processing owed was repaid from your balance"
    )
    const [leg] = recoveryLegs(w.ledger)
    expect(leg).toMatchObject({ debit_account_id: "acc-earnings", status: "COMPLETED" })
    expect(cents(leg.amount)).toBe(146)
    expect(leg.metadata).toMatchObject({ source: "vendor_payment", recovered_from_order_id: "order_1" })
    expect(leg.description).toBe(
      "Card processing repaid from your balance before a vendor payment: card processing on order order_1 is not returned on a refund, and your earnings did not cover it"
    )
    expect(vendorPaymentLegs(w.ledger)).toHaveLength(0)
    expect(w.vendorPayments).toHaveLength(0)
    expect(cents(account(w.ledger, "acc-payee").balance)).toBe(0)
    expect(await owedCents(w.ledger)).toBe(0)

    // The net goes through, after the recovery, and nothing is taken twice.
    await pay(w, 18.54)
    const [moved] = vendorPaymentLegs(w.ledger)
    expect(cents(moved.amount)).toBe(1854)
    expect(w.ledger.entries.indexOf(moved)).toBeGreaterThan(w.ledger.entries.indexOf(leg))
    expect(recoveryLegs(w.ledger)).toHaveLength(1)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
    expect(cents(account(w.ledger, "acc-payee").balance)).toBe(1854)
    expect(w.vendorPayments).toHaveLength(1)
  })

  it("if the recovery leg cannot post, the payment is still limited to the balance net of what is owed", async () => {
    const w = await worldWithShortfall()
    withPayee(w)
    holding(w, 20)
    const shadow = w.ledger.service as unknown as Record<string, unknown>
    shadow.recoverCardProcessingShortfallLocked_ = async () => {
      throw new Error("recovery unavailable")
    }
    await expect(pay(w, 20)).rejects.toThrow(
      "Insufficient balance: $18.54 is available to pay; $1.46 of card processing is still owed"
    )
    await pay(w, 18.54)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(146)
    expect(await owedCents(w.ledger)).toBe(146)
  })

  it("nothing owed: a vendor payment of the whole balance is unchanged and takes no lock", async () => {
    const w = makeWorld({ order: order40() })
    withPayee(w)
    holding(w, 20)
    const lock = jest.spyOn(HawalaLedgerModuleService.prototype as never, "withSellerAccountLock_" as never)
    await pay(w, 20)
    expect(lock).not.toHaveBeenCalled()
    expect(w.ledger.entries.map((e) => e.entry_type)).toEqual(["VENDOR_PAYMENT"])
    expect(cents(account(w.ledger, "acc-payee").balance)).toBe(2000)
    expect(processingAccount(w.ledger)).toBeUndefined()
    lock.mockRestore()
  })
})

describe("shortfall recovery — refund cap when the outflow backstop, not the settlement, repaid", () => {
  it("next-earnings recovery missed order 2; the payout backstop then took the 1.46 from order 2's money: the refund of order 2 still succeeds", async () => {
    const w = await worldWithShortfall({ orders: [order40({ id: "order_2" })] })
    const shadow = w.ledger.service as unknown as Record<string, unknown>
    // Point A misses order 2's credit (a swallowed lock timeout, say).
    shadow.recoverFromSellerCredit_ = async () => undefined
    await place(w.container, "order_2")
    delete shadow.recoverFromSellerCredit_
    expect(recoveryLegs(w.ledger)).toHaveLength(0)
    expect(await owedCents(w.ledger)).toBe(146)

    // The vendor asks for everything; the backstop repays first and refuses.
    await expect(
      w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 37.38, payout_tier: "WEEKLY" })
    ).rejects.toThrow("Insufficient balance: $35.92 is available to pay out after $1.46")
    expect(recoveryLegs(w.ledger).map((e) => (e.metadata as { source: string }).source)).toEqual(["payout"])

    await refund(w.container, undefined, "order_2")

    expect(w.ledger.entries.find((e) => e.idempotency_key === "order-refund-order_2-customer")).toBeDefined()
    const reopened = shortfallLegs(w.ledger).find((e) => e.idempotency_key === "order-refund-order_2-processing-shortfall")!
    expect(cents(reopened.amount)).toBe(292)
    expect(reopened.metadata).toMatchObject({ repaid_from_this_order: 1.46 })
    expect(await owedCents(w.ledger)).toBe(292)
    expect(cents(account(w.ledger, "acc-earnings").balance)).toBe(0)
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("a backstop recovery posted BEFORE the order's credit does not raise that order's cap", async () => {
    const w = await worldWithShortfall({ orders: [order40({ id: "order_2" })] })
    const e = account(w.ledger, "acc-earnings")
    e.balance = 1.46
    e.available_balance = 1.46
    // The backstop repays the 1.46 from money that is not order 2's.
    await expect(
      w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 0.01, payout_tier: "WEEKLY" })
    ).rejects.toThrow("Insufficient balance: $0.00 is available to pay out after $1.46")
    expect(await owedCents(w.ledger)).toBe(0)

    await place(w.container, "order_2")
    expect(recoveryLegs(w.ledger)).toHaveLength(1)
    // The vendor then cashes out 1.46 of order 2's credit.
    await w.ledger.service.requestPayout({ vendor_id: "sel_1", amount: 1.46, payout_tier: "WEEKLY" })

    // Gap 2.92 against order 2's own 1.46: the vendor was paid out, refused.
    await expect(w.ledger.service.processRefund({ order_id: "order_2" })).rejects.toThrow(
      /refused before any leg posted: the vendor's earnings fall \$2.92 short of the seller balancing leg, more than the \$1.46 card processing retained on the order \(the vendor/
    )
  })
})
