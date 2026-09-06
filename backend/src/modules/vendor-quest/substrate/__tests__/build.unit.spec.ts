import type { MedusaContainer } from "@medusajs/framework/types"
import { buildSubstrate } from "../build"

/**
 * `buildSubstrate` against a container stub, the house pattern of
 * `shared/__tests__/native-push-seller.unit.spec.ts`. Two things are pinned:
 * the five universal fields that were constants until 2026-09-06 now come
 * from real reads through the right module keys and the `seller_order` link,
 * and a substrate with every source missing still builds with its defaults.
 */

const asOf = new Date("2026-07-01T00:00:00.000Z")
const daysAgo = (days: number) => new Date(asOf.getTime() - days * 86_400_000).toISOString()

type GraphArgs = { entity: string; fields: string[]; filters: Record<string, unknown> }

function makeContainer() {
  const graph = jest.fn(async ({ entity }: GraphArgs) => {
    if (entity === "seller") {
      return {
        data: [
          {
            id: "sel_1",
            created_at: daysAgo(200),
            products: [{ id: "prod_1" }, { id: "prod_2" }],
            members: [{ id: "mem_1" }, { id: "mem_2" }],
          },
        ],
      }
    }
    if (entity === "seller_order") {
      return { data: [{ order_id: "order_1" }, { order_id: "order_2" }, { order_id: "order_2" }] }
    }
    if (entity === "order") {
      return {
        data: [
          { id: "order_1", customer_id: "cus_a", created_at: daysAgo(40), fulfillment_status: "delivered" },
          { id: "order_2", customer_id: "cus_a", created_at: daysAgo(30), fulfillment_status: "shipped" },
          { id: "order_3", customer_id: "cus_b", created_at: daysAgo(20), fulfillment_status: "fulfilled" },
          { id: "order_4", customer_id: "cus_c", created_at: daysAgo(10), fulfillment_status: "delivered" },
          { id: "order_5", customer_id: "cus_d", created_at: daysAgo(90), fulfillment_status: "not_fulfilled" },
          { id: "order_6", customer_id: "cus_e", created_at: daysAgo(2), fulfillment_status: "not_fulfilled" },
        ],
      }
    }
    return { data: [] }
  })

  const modules: Record<string, unknown> = {
    query: { graph },
    vendorRules: {
      listVendorCustomerTiers: jest.fn(async () => [
        { id: "tier_1", tier_type: "WHOLESALE", name: "Shops", active: true, customer_ids: ["cus_a", "cus_b"] },
        { id: "tier_2", tier_type: "WHOLESALE", name: "Co-ops", active: true, customer_ids: ["cus_b"] },
        { id: "tier_3", tier_type: "REGULAR", name: "Retail", active: true, customer_ids: ["cus_c"] },
      ]),
    },
    orderDispute: {
      listOrderDisputes: jest.fn(async () => [{ id: "dsp_1" }, { id: "dsp_2" }]),
    },
    progressionModuleService: {
      listCharacterSheets: jest.fn(async () => [
        { customer_id: "mem_1", total_xp: 120 },
        { customer_id: "mem_2", total_xp: "30" },
      ]),
      getOrCreateCharacterSheet: jest.fn(),
    },
    vendorVerification: {
      getTrustSummary: jest.fn(async () => ({ trustScore: 72, levelLabel: "Verified Producer", badges: [{}] })),
    },
    hawalaLedger: {
      listLedgerAccounts: jest.fn(async () => []),
    },
  }

  const container = {
    resolve: (key: string) => {
      if (key in modules) return modules[key]
      throw new Error(`module ${key} not registered`)
    },
  } as unknown as MedusaContainer

  return { container, graph, modules }
}

describe("buildSubstrate — universal fields come from real reads", () => {
  it("populates orders, reliability, customers, wholesale, disputes and XP", async () => {
    const { container, graph, modules } = makeContainer()

    const substrate = await buildSubstrate("sel_1", container, { asOf })

    expect(substrate.generated_at).toBe(asOf.toISOString())
    expect(substrate.operating).toMatchObject({
      account_age_days: 200,
      months_active: 6,
      listing_count: 2,
      orders_fulfilled: 4,
      // 4 fulfilled ÷ (4 fulfilled + 1 stale unfulfilled); order_6 is too young to count.
      fulfillment_reliability: 0.8,
    })
    expect(substrate.customers).toEqual({
      distinct_customers: 5,
      repeat_customers: 1,
      repeat_rate: 0.2,
      wholesale_relationships: 2,
    })
    expect(substrate.reputation).toEqual({
      trust_score: 72,
      tier: "Verified Producer",
      total_xp: 150,
      dispute_count: 2,
      verified_credentials: 1,
    })
    expect(substrate.channels).toEqual({
      channels: [
        { key: "WHOLESALE", label: "Shops" },
        { key: "WHOLESALE", label: "Co-ops" },
        { key: "REGULAR", label: "Retail" },
      ],
    })

    // Orders come through the seller_order link, de-duplicated, never `order.seller_id`.
    const linkCall = graph.mock.calls.find(([args]) => args.entity === "seller_order")?.[0]
    expect(linkCall?.filters).toEqual({ seller_id: "sel_1", deleted_at: { $eq: null } })
    const orderCall = graph.mock.calls.find(([args]) => args.entity === "order")?.[0]
    expect(orderCall?.filters).toEqual({ id: ["order_1", "order_2"] })
    expect(orderCall?.fields).toEqual(
      expect.arrayContaining(["customer_id", "created_at", "canceled_at", "status", "fulfillment_status"])
    )

    // Live disputes only, scoped to the seller.
    const disputes = modules.orderDispute as { listOrderDisputes: jest.Mock }
    expect(disputes.listOrderDisputes.mock.calls[0][0]).toEqual({
      seller_id: "sel_1",
      status: ["open", "under_review"],
    })

    // XP over the seller's members, read without creating sheets.
    const progression = modules.progressionModuleService as {
      listCharacterSheets: jest.Mock
      getOrCreateCharacterSheet: jest.Mock
    }
    expect(progression.listCharacterSheets.mock.calls[0][0]).toEqual({ customer_id: ["mem_1", "mem_2"] })
    expect(progression.getOrCreateCharacterSheet).not.toHaveBeenCalled()

    // Tiers are read once and shared by customers and channels.
    const rules = modules.vendorRules as { listVendorCustomerTiers: jest.Mock }
    expect(rules.listVendorCustomerTiers).toHaveBeenCalledTimes(1)
    expect(rules.listVendorCustomerTiers.mock.calls[0][0]).toEqual({ seller_id: "sel_1" })
  })

  it("skips the order query for a seller with no linked orders", async () => {
    const { container, graph } = makeContainer()
    graph.mockImplementation(async ({ entity }: GraphArgs) => {
      if (entity === "seller") return { data: [{ id: "sel_1", created_at: daysAgo(10), products: [], members: [] }] }
      return { data: [] }
    })

    const substrate = await buildSubstrate("sel_1", container, { asOf })

    expect(graph.mock.calls.some(([args]) => args.entity === "order")).toBe(false)
    expect(substrate.operating).toMatchObject({ orders_fulfilled: 0, fulfillment_reliability: null })
    expect(substrate.customers.distinct_customers).toBe(0)
    expect(substrate.reputation.total_xp).toBe(0)
  })

  it("builds with defaults when every source is missing", async () => {
    const container = {
      resolve: (key: string) => {
        throw new Error(`module ${key} not registered`)
      },
    } as unknown as MedusaContainer

    const substrate = await buildSubstrate("sel_none", container, { asOf })

    expect(substrate.operating).toEqual({
      account_created_at: null,
      account_age_days: 0,
      months_active: 0,
      listing_count: 0,
      orders_fulfilled: 0,
      fulfillment_reliability: null,
    })
    expect(substrate.customers).toEqual({
      distinct_customers: 0,
      repeat_customers: 0,
      repeat_rate: null,
      wholesale_relationships: 0,
    })
    expect(substrate.reputation).toEqual({
      trust_score: null,
      tier: null,
      total_xp: 0,
      dispute_count: 0,
      verified_credentials: 0,
    })
    expect(substrate.inventory).toBeNull()
    expect(substrate.channels).toBeNull()
    expect(substrate.documents).toBeNull()
    expect(substrate.collective).toBeNull()
  })
})
