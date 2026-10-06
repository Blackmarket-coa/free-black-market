import PayoutBreakdownService, { type BreakdownInput } from "../service"

/**
 * Shared harness for the fee-first breakdown specs: a REAL
 * `PayoutBreakdownService` (prototype + patched CRUD, the
 * `platform-fee-service.unit.spec.ts` pattern) whose config stub carries the
 * processing estimate. The older stub there omits
 * `payment_processing_percent` / `payment_processing_fixed`, so
 * `totals.paymentProcessing` is NaN in every one of its cases; this one does
 * not, so the processing figure can be asserted.
 *
 * Not a `*.spec.ts`, so never collected as a suite.
 */

export type SettingsRow = {
  id: string
  seller_id: string
  custom_platform_fee_percent?: number | null
  additional_community_contribution?: number
}

export function makeBreakdownService(opts: {
  defaultPercent?: number
  processingPercent?: number
  processingFixed?: number
  pluginDeveloperPercent?: number
  referralPercent?: number
  communityFundPercent?: number
  settings?: SettingsRow[]
  /**
   * Make the Nth payout_config read (1-based) and every later one throw: a
   * config store that fails partway through a settlement.
   */
  configThrowsFrom?: number
  /** A config row whose processing figures are missing (read as NaN). */
  processingUnusable?: boolean
} = {}) {
  const svc = Object.create(PayoutBreakdownService.prototype) as Record<string, unknown>
  const rows: SettingsRow[] = [...(opts.settings ?? [])]
  const stored: Record<string, unknown>[] = []
  const configReads = { count: 0 }

  svc.listPayoutConfigs = (async () => {
    configReads.count++
    if (opts.configThrowsFrom !== undefined && configReads.count >= opts.configThrowsFrom) {
      throw new Error("payout_config unreachable")
    }
    return [
      {
        id: "pc_1",
        is_default: true,
        platform_fee_percent: opts.defaultPercent ?? 3,
        payment_processing_percent: opts.processingUnusable ? undefined : opts.processingPercent ?? 2.9,
        payment_processing_fixed: opts.processingUnusable ? undefined : opts.processingFixed ?? 30,
        community_fund_percent: opts.communityFundPercent ?? 0,
        plugin_developer_percent: opts.pluginDeveloperPercent ?? 0,
        referral_percent: opts.referralPercent ?? 0,
      },
    ]
  }) as never
  svc.listSellerPayoutSettings = (async (filters: { seller_id?: string }) =>
    rows.filter((r) => !filters?.seller_id || r.seller_id === filters.seller_id)) as never
  svc.createOrderPayoutBreakdowns = (async (data: Record<string, unknown>) => {
    // order_payout_breakdown.order_id is unique (models/order-payout-breakdown.ts),
    // so a second insert for one order fails as it does in Postgres.
    if (stored.some((r) => r.order_id === data.order_id)) {
      throw new Error(`duplicate key value violates unique constraint on order_id ${String(data.order_id)}`)
    }
    const row = { id: `opb_${stored.length + 1}`, ...data }
    stored.push(row)
    return row
  }) as never
  svc.listOrderPayoutBreakdowns = (async (filters: { order_id?: string }) =>
    stored.filter((r) => !filters?.order_id || r.order_id === filters.order_id)) as never

  return { svc: svc as unknown as PayoutBreakdownService, stored, configReads }
}

/**
 * The flag-off fixtures. Each one's whole `calculateBreakdown` output was
 * captured from the pre-F6 service (main d51aa0b9) into
 * `fee-first-breakdown.golden.json`; the spec asserts today's output still
 * deep-equals it, field for field.
 */
export const FLAG_OFF_FIXTURES: Array<{
  name: string
  opts: Parameters<typeof makeBreakdownService>[0]
  input: BreakdownInput
}> = [
  {
    name: "single seller $40 at the default",
    opts: {},
    input: { subtotal: 4000, sellerId: "sel_1" },
  },
  {
    name: "single seller $5 on a 2% plan",
    opts: {},
    input: { subtotal: 500, sellerId: "sel_1", planFeePercentBySeller: { sel_1: 2 } },
  },
  {
    name: "multi-seller with per-seller plan rates",
    opts: {},
    input: {
      subtotal: 4000,
      sellerBreakdown: [
        { sellerId: "sel_1", subtotal: 2500, sellerName: "A" },
        { sellerId: "sel_2", subtotal: 1500, sellerName: "B" },
      ],
      planFeePercentBySeller: { sel_1: 3, sel_2: 0 },
    },
  },
  {
    name: "plugin + referral carve-outs",
    opts: { pluginDeveloperPercent: 1, referralPercent: 1 },
    input: {
      subtotal: 10_000,
      sellerId: "sel_1",
      pluginsBySeller: { sel_1: [{ slug: "analytics", author_seller_id: "sel_dev" }] },
      referralBySeller: { sel_1: { referrer_seller_id: "sel_ref" } },
    },
  },
  {
    name: "tax, delivery, tip, pickup discount and donation",
    opts: {},
    input: {
      subtotal: 4000,
      sellerId: "sel_1",
      tax: 320,
      deliveryFee: 500,
      tip: 200,
      pickupDiscount: -100,
      donation: 1000,
      donationRecipientName: "Org",
    },
  },
  {
    name: "creator commission and a community contribution",
    opts: {
      communityFundPercent: 1,
      settings: [{ id: "sps_1", seller_id: "sel_1", additional_community_contribution: 2 }],
    },
    input: {
      subtotal: 4000,
      sellerId: "sel_1",
      creatorCommissionCents: 250,
      creatorSellerId: "sel_creator",
      creatorName: "Creator",
    },
  },
  {
    name: "a negotiated 0 override",
    opts: { settings: [{ id: "sps_1", seller_id: "sel_1", custom_platform_fee_percent: 0 }] },
    input: { subtotal: 3333, sellerId: "sel_1" },
  },
]
