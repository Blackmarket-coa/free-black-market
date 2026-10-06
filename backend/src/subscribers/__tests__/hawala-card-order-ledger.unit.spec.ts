import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import hawalaOrderPaymentSubscriber from "../hawala-order-payment"
import hawalaCardCaptureSubscriber, { config as captureConfig } from "../hawala-card-capture"
import hawalaOrderRefundSubscriber from "../hawala-order-refund"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../shared/feature-flags"
import { clearPlanFeatureCache } from "../../shared/plan-entitlement-cache"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"
import {
  CARD_CLEARING_ACCOUNT_TYPE,
  CARD_CLEARING_OWNER_ID,
} from "../../modules/hawala-ledger/card-clearing"
import {
  CARD_PROCESSING_OWNER_ID,
  CARD_PROCESSING_SHORTFALL_LEG,
  CARD_PROCESSING_WRITE_OFF_DAYS,
} from "../../modules/hawala-ledger/card-processing"
import { STRIPE_CONNECT_DIRECT_PROVIDER_ID } from "../../modules/stripe-connect-direct/registration"
import { PAYOUT_BREAKDOWN_MODULE } from "../../modules/payout-breakdown"
import { CREATOR_ATTRIBUTION_MODULE } from "../../modules/creator-attribution"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { TENANCY_MODULE } from "../../modules/tenancy"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks"
import {
  makeAccount,
  makePoolLedger,
  type PoolLedger,
  type Row,
} from "../../modules/hawala-ledger/__tests__/in-memory-pool-ledger"
import { makeBreakdownService } from "../../modules/payout-breakdown/__tests__/fee-first-harness"

/**
 * SD-36, real chain end to end: the REAL order.placed subscriber, the REAL
 * payment.captured subscriber, the REAL refund subscriber and the REAL
 * HawalaLedgerModuleService (`createTransfer` with its clearing guard,
 * `processOrderPayment`, `processRefund`) over the in-memory account / entry
 * store. Container keys are the imported constants and anything else throws
 * (CLAUDE.md rule 2), so no fallback path can pass these silently.
 *
 * The customer has NO wallet and NO balance in every world here: before this
 * change that is exactly the state in which a card order posted nothing.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1
const FEE_FIRST = PHASE0_FEATURE_FLAGS.FEE_FIRST_SPLIT_V1

type Order = {
  id: string
  customer_id: string
  seller_id: string
  total: number
  subtotal: number
  currency_code: string
  items: Array<{ product_id: string }>
}

const order40: Order = {
  id: "order_1",
  customer_id: "cus_1",
  seller_id: "sel_1",
  total: 4000,
  subtotal: 4000,
  currency_code: "usd",
  items: [{ product_id: "prod_1" }],
}

function makeWorld(opts: {
  providerId?: string
  /** The order-funding read at placement throws. */
  orderGraphThrows?: boolean
  /** A funded customer wallet (the pre-SD-36 path, for "other" providers). */
  walletBalance?: number
  extraAccounts?: Row[]
}) {
  const ledger = makePoolLedger({
    accounts: [
      makeAccount("acc-escrow", { account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-platform", { account_type: "PLATFORM_FEE", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-earnings", {
        account_type: "SELLER_EARNINGS",
        owner_type: "SELLER",
        owner_id: order40.seller_id,
        balance: 0,
        available_balance: 0,
      }),
      ...(opts.walletBalance !== undefined
        ? [makeAccount("acc-wallet", { owner_id: order40.customer_id, balance: opts.walletBalance, available_balance: opts.walletBalance })]
        : []),
      ...(opts.extraAccounts ?? []),
    ],
  })
  const shadow = ledger.service as unknown as Record<string, unknown>
  // Decimal-exact balances, as Postgres numeric is (see the fee-first spec).
  const floatUpdate = shadow.updateBalances as (id: string, delta: number) => Promise<void>
  shadow.updateBalances = async (accountId: string, delta: number) => {
    await floatUpdate(accountId, delta)
    const acc = ledger.accounts.find((a) => a.id === accountId)
    if (acc) {
      acc.balance = Math.round(Number(acc.balance) * 1e8) / 1e8
      acc.available_balance = Math.round(Number(acc.available_balance) * 1e8) / 1e8
    }
  }
  const insertEntry = shadow.createLedgerEntries as (d: Record<string, unknown>) => Promise<Row>
  let clock = 0
  shadow.createLedgerEntries = async (data: Record<string, unknown>) => {
    const key = data.idempotency_key
    if (typeof key === "string" && ledger.entries.some((e) => e.idempotency_key === key)) {
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" })
    }
    return insertEntry({ created_at: new Date(Date.UTC(2026, 9, 1) + ++clock * 1000), ...data })
  }
  shadow.listPayoutConfigs = async () => []
  shadow.listVendorAdvances = async () => []
  shadow.listInvestmentPools = async () => []

  const payouts = makeBreakdownService({})
  const providerId = opts.providerId ?? "pp_stripe_stripe"
  // The collection, in MAJOR units as Medusa stores it (the real-database
  // spec, integration-tests/http/hawala-card-order-settlement.spec.ts, pins
  // these query shapes). Mutable, so a test can capture and refund.
  const collection = { id: "paycol_1", amount: 40, captured_amount: 0, refunded_amount: 0 }
  const graph = jest.fn(async (q: { entity: string; filters?: Record<string, unknown> }) => {
    if (q.entity === "order") {
      if (opts.orderGraphThrows) throw new Error("graph unavailable")
      return {
        data: [
          {
            id: order40.id,
            customer_id: order40.customer_id,
            currency_code: "usd",
            metadata: {},
            total: 40,
            subtotal: 40,
            items: [{ product_id: "prod_1" }],
            seller: { id: order40.seller_id },
            split_order_payment: null,
            payment_collections: [{ ...collection, payments: [{ id: "pay_1", provider_id: providerId }] }],
          },
        ],
      }
    }
    if (q.entity === "order_payment_collection") {
      return { data: [{ order_id: order40.id, payment_collection_id: collection.id }] }
    }
    if (q.entity === "split_order_payment") return { data: [] }
    if (q.entity === "payment") {
      return { data: [{ id: q.filters?.id, provider_id: providerId, payment_collection_id: collection.id }] }
    }
    throw new Error(`unexpected graph entity ${q.entity}`)
  })
  const resolve = jest.fn((key: string) => {
    if (key === HAWALA_LEDGER_MODULE) return ledger.service
    if (key === PAYOUT_BREAKDOWN_MODULE) return payouts.svc
    if (key === Modules.ORDER) return { retrieveOrder: async () => order40 }
    if (key === CREATOR_ATTRIBUTION_MODULE) return { listOrderAttributions: async () => [] }
    if (key === VENDOR_PLAN_MODULE)
      return { ensureAssignment: async () => ({ plan_code: "free" }), getEntitledFeatureKeys: async () => [] }
    if (key === ENTITLEMENT_MODULE) return { listActiveFeatureKeysForSeller: async () => [] }
    if (key === TENANCY_MODULE) return { resolveSellerTier: async () => "tier0_public" }
    if (key === MARKETPLACE_WEBHOOKS_MODULE) return { emitBlackout: async () => true }
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected container key: ${key}`)
  })
  const captureAll = () => {
    collection.captured_amount = collection.amount
  }
  const refundTotal = (major: number) => {
    collection.refunded_amount = major
  }
  return { ledger, graph, collection, captureAll, refundTotal, container: { resolve } as never }
}

const place = (container: never) =>
  hawalaOrderPaymentSubscriber({ event: { data: { id: order40.id } }, container } as never)
const capture = (container: never, paymentId = "pay_1") =>
  hawalaCardCaptureSubscriber({ event: { data: { id: paymentId } }, container } as never)
const refund = (container: never) =>
  hawalaOrderRefundSubscriber({ event: { data: { id: order40.id, reason: "Order cancelled" } }, container } as never)

const cents = (n: unknown) => Math.round(Number(n) * 100)
const clearingAccount = (l: PoolLedger) =>
  l.accounts.find((a) => a.account_type === CARD_CLEARING_ACCOUNT_TYPE)
const wallets = (l: PoolLedger) => l.accounts.filter((a) => a.account_type === "USER_WALLET")
const legs = (l: PoolLedger) =>
  l.entries.map((e) => [e.entry_type, cents(e.amount), e.debit_account_id, e.credit_account_id, e.status])
const balanceCents = (l: PoolLedger, id: string) => cents(l.accounts.find((a) => a.id === id)?.balance)
const escrowNetCents = (l: PoolLedger) =>
  l.entries.reduce((sum, e) => {
    if (e.status === "FAILED") return sum
    if (e.credit_account_id === "acc-escrow") return sum + cents(e.amount)
    if (e.debit_account_id === "acc-escrow") return sum - cents(e.amount)
    return sum
  }, 0)

beforeEach(() => clearPlanFeatureCache())
afterEach(() => {
  delete process.env[CARD]
  delete process.env[FEE_FIRST]
})

describe("FF_CARD_ORDER_LEDGER_V1", () => {
  it("is registered under the documented env name and defaults off", () => {
    expect(CARD).toBe("FF_CARD_ORDER_LEDGER_V1")
    expect(featureFlagState.isEnabled("CARD_ORDER_LEDGER_V1")).toBe(false)
    process.env[CARD] = "true"
    expect(featureFlagState.isEnabled("CARD_ORDER_LEDGER_V1")).toBe(true)
  })

  it("the capture subscriber listens to Medusa's payment.captured", () => {
    expect(captureConfig.event).toBe("payment.captured")
  })
})

describe("flag off — exactly the pre-SD-36 behaviour", () => {
  it("a card order with no customer balance posts nothing, and neither subscriber reads how it was paid", async () => {
    const w = makeWorld({})
    await place(w.container)
    await capture(w.container)
    expect(w.ledger.entries).toEqual([])
    // The old path still creates the $0 wallet it then fails to debit.
    expect(wallets(w.ledger)).toHaveLength(1)
    expect(clearingAccount(w.ledger)).toBeUndefined()
    expect(w.graph).not.toHaveBeenCalled()
  })
})

describe("flag on — a card order settles from card clearing at capture", () => {
  beforeEach(() => {
    process.env[CARD] = "true"
  })

  it("authorised at placement: nothing, no wallet; full capture posts purchase, fee and seller legs from clearing", async () => {
    const w = makeWorld({})
    await place(w.container)
    expect(w.ledger.entries).toEqual([])
    expect(wallets(w.ledger)).toEqual([])

    w.captureAll()
    await capture(w.container)
    const clearing = clearingAccount(w.ledger)!
    expect(clearing).toMatchObject({ owner_type: "SYSTEM", owner_id: CARD_CLEARING_OWNER_ID, currency_code: "USD" })
    expect(legs(w.ledger)).toEqual([
      ["PURCHASE", 4000, clearing.id, "acc-escrow", "COMPLETED"],
      ["COMMISSION", 120, "acc-escrow", "acc-platform", "COMPLETED"],
      ["TRANSFER", 3880, "acc-escrow", "acc-earnings", "COMPLETED"],
    ])
    expect(w.ledger.entries[0].metadata).toMatchObject({ funding: "card", payment_id: "pay_1", customer_id: "cus_1" })
    expect(balanceCents(w.ledger, clearing.id)).toBe(-4000)
    expect(balanceCents(w.ledger, "acc-earnings")).toBe(3880)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(wallets(w.ledger)).toEqual([])
  })

  it("already captured at placement (Mercur captures right after the order set is placed): settles at placement", async () => {
    const w = makeWorld({})
    w.captureAll()
    await place(w.container)
    expect(legs(w.ledger)[0]).toEqual(["PURCHASE", 4000, clearingAccount(w.ledger)!.id, "acc-escrow", "COMPLETED"])
    await capture(w.container)
    expect(w.ledger.entries.filter((e) => e.entry_type === "PURCHASE")).toHaveLength(1)
  })

  it("a redelivered capture, or a second capture event on the order, posts nothing more", async () => {
    const w = makeWorld({})
    w.captureAll()
    await capture(w.container)
    await capture(w.container)
    await capture(w.container, "pay_2")
    expect(w.ledger.entries.filter((e) => e.entry_type === "PURCHASE")).toHaveLength(1)
    expect(w.ledger.entries).toHaveLength(3)
  })

  it("a partial capture waits for the rest", async () => {
    const w = makeWorld({})
    w.collection.captured_amount = 25
    await capture(w.container)
    expect(w.ledger.entries).toEqual([])
    expect(clearingAccount(w.ledger)).toBeUndefined()
  })

  it("cancelling with nothing refunded yet posts nothing: a card order follows the money, not the order event", async () => {
    const w = makeWorld({})
    w.captureAll()
    await capture(w.container)
    await refund(w.container)
    expect(w.ledger.entries.filter((e) => e.entry_type === "REFUND")).toEqual([])
  })

  it("a full refund goes back to clearing (the card), never into a wallet, and everything nets to zero", async () => {
    const w = makeWorld({})
    w.captureAll()
    await capture(w.container)
    w.refundTotal(40)
    await refund(w.container)
    const clearing = clearingAccount(w.ledger)!
    const customerRefund = w.ledger.entries.find(
      (e) => e.entry_type === "REFUND" && e.credit_account_id === clearing.id
    )
    expect(customerRefund).toMatchObject({ debit_account_id: "acc-escrow", amount: 40, status: "COMPLETED" })
    expect(balanceCents(w.ledger, clearing.id)).toBe(0)
    expect(balanceCents(w.ledger, "acc-earnings")).toBe(0)
    expect(balanceCents(w.ledger, "acc-platform")).toBe(0)
    expect(escrowNetCents(w.ledger)).toBe(0)
    expect(wallets(w.ledger)).toEqual([])
  })

  it("a Stripe Connect direct charge is the partner's money: nothing posts at placement or capture", async () => {
    const w = makeWorld({ providerId: STRIPE_CONNECT_DIRECT_PROVIDER_ID })
    await place(w.container)
    await capture(w.container)
    expect(w.ledger.entries).toEqual([])
    expect(wallets(w.ledger)).toEqual([])
    expect(clearingAccount(w.ledger)).toBeUndefined()
  })

  it("another provider keeps the old wallet path (a funded wallet still settles from the wallet), and capture ignores it", async () => {
    const w = makeWorld({ providerId: "pp_system_default", walletBalance: 100 })
    await place(w.container)
    await capture(w.container)
    expect(legs(w.ledger)[0]).toEqual(["PURCHASE", 4000, "acc-wallet", "acc-escrow", "COMPLETED"])
    expect(w.ledger.entries.filter((e) => e.entry_type === "PURCHASE")).toHaveLength(1)
    expect(clearingAccount(w.ledger)).toBeUndefined()
  })

  it("if how the order was paid cannot be read at placement, it keeps the old path", async () => {
    const w = makeWorld({ orderGraphThrows: true, walletBalance: 100 })
    await place(w.container)
    expect(legs(w.ledger)[0]).toEqual(["PURCHASE", 4000, "acc-wallet", "acc-escrow", "COMPLETED"])
  })

  it("placed with the flag off (nothing posted, as before) and captured with it on: settles at capture from clearing", async () => {
    delete process.env[CARD]
    const w = makeWorld({})
    await place(w.container)
    expect(w.ledger.entries).toEqual([])
    process.env[CARD] = "true"
    w.captureAll()
    await capture(w.container)
    expect(legs(w.ledger)[0]).toEqual(["PURCHASE", 4000, clearingAccount(w.ledger)!.id, "acc-escrow", "COMPLETED"])
    expect(escrowNetCents(w.ledger)).toBe(0)
  })

  it("an order already settled from a wallet at placement is not settled again at capture", async () => {
    // Flag flipped on between placement and capture, for an order the old
    // path did settle (the customer happened to hold a balance).
    delete process.env[CARD]
    const w = makeWorld({ walletBalance: 100 })
    await place(w.container)
    process.env[CARD] = "true"
    w.captureAll()
    await capture(w.container)
    expect(w.ledger.entries.filter((e) => e.entry_type === "PURCHASE")).toHaveLength(1)
    expect(clearingAccount(w.ledger)).toBeUndefined()
  })
})

describe("with F6 on too: processing, a refund shortfall and its recovery now run for card orders", () => {
  beforeEach(() => {
    process.env[CARD] = "true"
    process.env[FEE_FIRST] = "true"
  })

  it("$40 card order: processing leg posts; a full refund leaves the vendor owing the processing, refunded to the card", async () => {
    const w = makeWorld({})
    w.captureAll()
    await capture(w.container)
    const processing = w.ledger.accounts.find(
      (a) => a.account_type === "PLATFORM_FEE" && a.owner_id === CARD_PROCESSING_OWNER_ID
    )!
    expect(legs(w.ledger)).toEqual([
      ["PURCHASE", 4000, clearingAccount(w.ledger)!.id, "acc-escrow", "COMPLETED"],
      ["COMMISSION", 116, "acc-escrow", "acc-platform", "COMPLETED"],
      ["FEE", 146, "acc-escrow", processing.id, "COMPLETED"],
      ["TRANSFER", 3738, "acc-escrow", "acc-earnings", "COMPLETED"],
    ])

    w.refundTotal(40)
    await refund(w.container)
    const shortfall = w.ledger.entries.find(
      (e) => (e.metadata as { leg?: string } | null)?.leg === CARD_PROCESSING_SHORTFALL_LEG
    )
    expect(shortfall).toMatchObject({ amount: 1.46, status: "COMPLETED" })
    expect(balanceCents(w.ledger, clearingAccount(w.ledger)!.id)).toBe(0)
    expect(balanceCents(w.ledger, "acc-earnings")).toBe(0)
    expect(escrowNetCents(w.ledger)).toBe(0)
    const owed = await (w.ledger.service as never as {
      getCardProcessingReceivable: (id: string) => Promise<{ total_cents: number }>
    }).getCardProcessingReceivable("acc-earnings")
    expect(owed.total_cents).toBe(146)
  })

  it("a shortfall older than the write-off age is forgiven: the next card sale repays nothing", async () => {
    const DAY = 24 * 60 * 60 * 1000
    const w = makeWorld({
      extraAccounts: [
        makeAccount("acc-processing", {
          account_type: "PLATFORM_FEE",
          owner_type: "SYSTEM",
          owner_id: CARD_PROCESSING_OWNER_ID,
          balance: 0,
          available_balance: 0,
        }),
      ],
    })
    // A shortfall recorded on a refund CARD_PROCESSING_WRITE_OFF_DAYS + 1 ago.
    w.ledger.entries.push({
      id: "le_old_shortfall",
      entry_type: "ADJUSTMENT",
      status: "COMPLETED",
      amount: 1.46,
      order_id: "order_old",
      debit_account_id: "acc-processing",
      credit_account_id: "acc-escrow",
      created_at: new Date(Date.now() - (CARD_PROCESSING_WRITE_OFF_DAYS + 1) * DAY),
      metadata: { leg: CARD_PROCESSING_SHORTFALL_LEG, owed_by_account_id: "acc-earnings", receivable: true },
    } as Row)

    w.captureAll()
    await capture(w.container)
    expect(w.ledger.entries.filter((e) => e.entry_type === "ADJUSTMENT")).toHaveLength(1)
    expect(balanceCents(w.ledger, "acc-earnings")).toBe(3738)

    const svc = w.ledger.service as never as {
      getCardProcessingReceivable: (id: string) => Promise<{ total_cents: number; written_off_cents: number }>
    }
    const owed = await svc.getCardProcessingReceivable("acc-earnings")
    expect(owed.total_cents).toBe(0)
    expect(owed.written_off_cents).toBe(146)
  })
})
