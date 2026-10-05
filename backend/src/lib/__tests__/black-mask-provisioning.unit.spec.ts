jest.mock("../../links/subscription-order", () => ({
  __esModule: true,
  default: { entryPoint: "subscription_order_link_test" },
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks"
import { SUBSCRIPTION_MODULE } from "../../modules/subscription"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"
import { makeHarness } from "../../modules/marketplace-webhooks/__tests__/black-mask-harness"
import { BLACK_MASK_SUBSCRIPTION_ID } from "../../modules/marketplace-webhooks/black-mask"
import {
  BLACK_MASK_MEDUSA_EVENTS,
  enqueueBlackMaskProvisioning,
  makeBlackMaskCustomerLookup,
} from "../black-mask-provisioning"
import subscriber, { config as subscriberConfig } from "../../subscribers/black-mask-provisioning"

/**
 * Medusa event -> Black Mask outbox row, through the REAL
 * MarketplaceWebhooksService (black-mask-harness) resolved on its imported
 * key. Every module key is the imported constant and the scope throws on any
 * other key, so a hand-typed key cannot pass by hitting a fallback.
 */

const FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1
const SELLER = "sel_bmc"
const ENV = [
  FLAG,
  "BLACK_MASK_PROVISIONING_URL",
  "BLACK_MASK_WEBHOOK_SECRET",
  "BLACK_MASK_WEBHOOK_KEY_ID",
  "BLACK_MASK_SELLER_ID",
] as const

function enable() {
  process.env[FLAG] = "true"
  process.env.BLACK_MASK_PROVISIONING_URL = "https://bm.example/hooks/fbm"
  process.env.BLACK_MASK_WEBHOOK_SECRET = "s"
  process.env.BLACK_MASK_WEBHOOK_KEY_ID = "k1"
  process.env.BLACK_MASK_SELLER_ID = SELLER
}

afterEach(() => {
  for (const k of ENV) delete process.env[k]
})

type Product = { id: string; metadata?: Record<string, unknown> | null; seller?: { id: string } | null }
type Order = {
  id: string
  customer_id?: string | null
  created_at?: string
  canceled_at?: string | null
  updated_at?: string
  items?: Array<{ product_id?: string | null; quantity?: number | null; metadata?: Record<string, unknown> }>
}
type Sub = {
  id: string
  customer_id?: string | null
  product_id?: string | null
  quantity?: number
  next_order_date?: string | null
  expiration_date?: string | null
  canceled_at?: string | null
  updated_at?: string
  metadata?: Record<string, unknown> | null
}

const VAULT: Product = { id: "prod_vault", metadata: { black_mask_plan: "vault_monthly" }, seller: { id: SELLER } }
const OTHER_SELLER_WITH_PLAN: Product = { id: "prod_x", metadata: { black_mask_plan: "vault_monthly" }, seller: { id: "sel_other" } }
const BMC_NO_PLAN: Product = { id: "prod_tshirt", metadata: {}, seller: { id: SELLER } }

function makeWorld(opts: {
  orders?: Order[]
  products?: Product[]
  subs?: Sub[]
  links?: Record<string, string>
  linkError?: boolean
  customers?: Array<{ id: string; email: string; metadata?: Record<string, unknown> }>
} = {}) {
  const harness = makeHarness()
  const resolved: string[] = []
  const graphCalls: Array<{ entity: string; filters?: Record<string, unknown> }> = []
  const query = {
    graph: async (args: { entity: string; fields: string[]; filters?: Record<string, unknown> }) => {
      graphCalls.push({ entity: args.entity, filters: args.filters })
      const ids = args.filters?.id
      const pick = <T extends { id: string }>(rows: T[]) =>
        rows.filter((r) => (Array.isArray(ids) ? ids.includes(r.id) : r.id === ids))
      switch (args.entity) {
        case "order":
          return { data: pick(opts.orders ?? []) }
        case "product":
          return { data: pick(opts.products ?? []) }
        case "customer":
          return { data: pick(opts.customers ?? []) }
        case "subscription_order_link_test": {
          if (opts.linkError) throw new Error("link read failed")
          if (args.filters?.subscription_id !== undefined) {
            const linked = Object.entries(opts.links ?? {})
              .filter(([, sub]) => sub === args.filters?.subscription_id)
              .map(([orderId]) => (opts.orders ?? []).find((o) => o.id === orderId) ?? { id: orderId })
            return { data: linked.map((o) => ({ order: { id: o.id, created_at: o.created_at } })) }
          }
          const sub = opts.links?.[String(args.filters?.order_id)]
          return { data: sub ? [{ subscription: { id: sub } }] : [] }
        }
        default:
          throw new Error(`unexpected graph entity ${args.entity}`)
      }
    },
  }
  const subscriptionService = {
    retrieveSubscription: jest.fn(async (id: string) => {
      const s = (opts.subs ?? []).find((x) => x.id === id)
      if (!s) throw new Error(`Subscription with id: ${id} was not found`)
      return s
    }),
  }
  const container = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === ContainerRegistrationKeys.QUERY) return query as unknown as T
      if (key === SUBSCRIPTION_MODULE) return subscriptionService as unknown as T
      if (key === MARKETPLACE_WEBHOOKS_MODULE) return harness.svc as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { ...harness, container, resolved, graphCalls, subscriptionService }
}

const placedOrder: Order = {
  id: "order_1",
  customer_id: "cus_1",
  created_at: "2026-01-01T00:00:00.000Z",
  items: [
    { product_id: "prod_vault", quantity: 2 },
    { product_id: "prod_tshirt", quantity: 1 },
  ],
}

describe("enqueue gating", () => {
  it("flag off: nothing is resolved and nothing is written", async () => {
    const w = makeWorld({ orders: [placedOrder], products: [VAULT] })
    enable()
    delete process.env[FLAG]
    expect(await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })).toEqual({
      status: "skipped",
      reason: "flag_off",
    })
    expect(w.resolved).toEqual([])
    expect(w.rows).toHaveLength(0)
  })

  it("config incomplete: nothing is resolved and nothing is written", async () => {
    const w = makeWorld({ orders: [placedOrder], products: [VAULT] })
    enable()
    delete process.env.BLACK_MASK_SELLER_ID
    expect(await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })).toEqual({
      status: "skipped",
      reason: "unconfigured",
    })
    expect(w.resolved).toEqual([])
    expect(w.rows).toHaveLength(0)
  })

  it("a non-vault order writes nothing: plan on another seller's product, BMC product with no plan", async () => {
    enable()
    const w = makeWorld({
      orders: [
        { ...placedOrder, id: "order_other", items: [{ product_id: "prod_x", quantity: 1 }] },
        { ...placedOrder, id: "order_shirt", items: [{ product_id: "prod_tshirt", quantity: 1 }] },
      ],
      products: [OTHER_SELLER_WITH_PLAN, BMC_NO_PLAN],
    })
    expect(await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_other" })).toEqual({
      status: "skipped",
      reason: "not_vault",
    })
    expect(await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_shirt" })).toEqual({
      status: "skipped",
      reason: "not_vault",
    })
    expect(w.rows).toHaveLength(0)
    expect(w.resolved).not.toContain(MARKETPLACE_WEBHOOKS_MODULE)
  })

  it("a customer-set line-item black_mask_plan on a BMC product without the product marker writes nothing", async () => {
    enable()
    const w = makeWorld({
      orders: [{ ...placedOrder, items: [{ product_id: "prod_tshirt", quantity: 1, metadata: { black_mask_plan: "vault_monthly" } }] }],
      products: [BMC_NO_PLAN],
    })
    expect((await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })).status).toBe("skipped")
    expect(w.rows).toHaveLength(0)
  })

  it("ignores events it does not announce", async () => {
    enable()
    const w = makeWorld()
    expect(await enqueueBlackMaskProvisioning(w.container, "order.updated", { id: "order_1" })).toEqual({
      status: "skipped",
      reason: "unknown_event",
    })
    expect(w.resolved).toEqual([])
  })
})

describe("order events", () => {
  it("order.placed on a vault order enqueues `placed`: seats from vault lines only, subscription correlated by the link, no email", async () => {
    enable()
    const w = makeWorld({ orders: [placedOrder], products: [VAULT, BMC_NO_PLAN], links: { order_1: "sub_1" } })
    const out = await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })
    expect(out).toEqual({
      status: "enqueued",
      delivery_id: "whd_1",
      event_id: "bm:v1:order:order_1:placed:1767225600000",
    })
    expect(w.rows).toHaveLength(1)
    expect(w.rows[0].subscription_id).toBe(BLACK_MASK_SUBSCRIPTION_ID)
    expect(w.rows[0].payload).toEqual({
      event: "placed",
      event_id: "bm:v1:order:order_1:placed:1767225600000",
      sequence: 1767225600000,
      occurred_at: "2026-01-01T00:00:00.000Z",
      subject: { type: "order", id: "order_1" },
      customer_id: "cus_1",
      plan: "vault_monthly",
      seats: 2,
      seller_id: SELLER,
      subscription_id: "sub_1",
    })
    expect(JSON.stringify(w.rows[0])).not.toMatch(/email/i)
  })

  it("a redelivered order.placed is a no-op", async () => {
    enable()
    const w = makeWorld({ orders: [placedOrder], products: [VAULT] })
    await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })
    await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })
    expect(w.rows).toHaveLength(1)
  })

  it("a live renewal order arriving on order.placed writes no `placed` row (and so never re-sends the email)", async () => {
    enable()
    // renewSubscriptionWorkflow mints each renewal order with
    // completeCartWorkflow, which emits order.placed, and links it to the
    // subscription before the event is released.
    const initial: Order = { ...placedOrder, id: "order_first", created_at: "2026-01-01T00:00:00.000Z" }
    const renewal: Order = { ...placedOrder, id: "order_renew", created_at: "2026-02-01T00:00:00.000Z" }
    const w = makeWorld({
      orders: [initial, renewal],
      products: [VAULT],
      links: { order_first: "sub_1", order_renew: "sub_1" },
    })
    expect(await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_renew" })).toEqual({
      status: "skipped",
      reason: "renewal_order",
    })
    expect(w.rows).toHaveLength(0)
    // The subscription's first order is still announced, with the correlation.
    const first = await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_first" })
    expect(first.status).toBe("enqueued")
    expect(w.rows.map((r) => r.event_id)).toEqual(["bm:v1:order:order_first:placed:1767225600000"])
    expect(w.rows[0].payload.subscription_id).toBe("sub_1")
    expect(w.graphCalls).toContainEqual({ entity: "subscription_order_link_test", filters: { subscription_id: "sub_1" } })
  })

  it("a failed subscription-link read on order.placed fails closed: nothing is written", async () => {
    enable()
    const w = makeWorld({ orders: [placedOrder], products: [VAULT], linkError: true })
    await expect(enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })).rejects.toThrow(
      "link read failed"
    )
    expect(w.rows).toHaveLength(0)
  })

  it("order.canceled with no canceled_at enqueues nothing (no updated_at fallback)", async () => {
    enable()
    const w = makeWorld({ orders: [{ ...placedOrder, updated_at: "2026-01-05T00:00:00.000Z" }], products: [VAULT] })
    expect(await enqueueBlackMaskProvisioning(w.container, "order.canceled", { id: "order_1" })).toEqual({
      status: "skipped",
      reason: "no_sequence",
    })
    expect(w.rows).toHaveLength(0)
  })

  it("order.canceled enqueues `cancelled` sequenced from canceled_at, after `placed`", async () => {
    enable()
    const order = { ...placedOrder, canceled_at: "2026-01-02T00:00:00.000Z" }
    const w = makeWorld({ orders: [order], products: [VAULT] })
    await enqueueBlackMaskProvisioning(w.container, "order.placed", { id: "order_1" })
    await enqueueBlackMaskProvisioning(w.container, "order.canceled", { id: "order_1" })
    expect(w.rows.map((r) => r.event_id)).toEqual([
      "bm:v1:order:order_1:placed:1767225600000",
      "bm:v1:order:order_1:cancelled:1767312000000",
    ])
    const [placed, cancelled] = w.rows.map((r) => r.payload.sequence as number)
    expect(cancelled).toBeGreaterThan(placed)
  })
})

describe("subscription events", () => {
  const sub: Sub = {
    id: "sub_1",
    customer_id: "cus_1",
    product_id: "prod_vault",
    quantity: 1,
    next_order_date: "2026-03-01T00:00:00.000Z",
    expiration_date: "2030-01-01T00:00:00.000Z",
    updated_at: "2026-02-10T00:00:00.000Z",
    metadata: {},
  }

  it("renewal in live mode enqueues `renewed`, sequenced from the renewal order, with period_end", async () => {
    enable()
    const w = makeWorld({
      subs: [sub],
      products: [VAULT],
      orders: [{ id: "order_r2", created_at: "2026-02-01T00:00:00.000Z" }],
    })
    const out = await enqueueBlackMaskProvisioning(w.container, "subscription.renewal_processed", {
      subscription_id: "sub_1",
      order_id: "order_r2",
    })
    expect(out.status).toBe("enqueued")
    expect(w.subscriptionService.retrieveSubscription).toHaveBeenCalledWith("sub_1")
    expect(w.rows[0].payload).toMatchObject({
      event: "renewed",
      subject: { type: "subscription", id: "sub_1" },
      sequence: Date.parse("2026-02-01T00:00:00.000Z"),
      order_id: "order_r2",
      period_end: "2026-03-01T00:00:00.000Z",
      seats: 1,
    })
  })

  it("two renewals of one subscription are two rows; a redelivery of either is not", async () => {
    enable()
    const w = makeWorld({
      subs: [sub],
      products: [VAULT],
      orders: [
        { id: "order_r2", created_at: "2026-02-01T00:00:00.000Z" },
        { id: "order_r3", created_at: "2026-03-01T00:00:00.000Z" },
      ],
    })
    for (const order_id of ["order_r2", "order_r3", "order_r2"]) {
      await enqueueBlackMaskProvisioning(w.container, "subscription.renewal_processed", { subscription_id: "sub_1", order_id })
    }
    expect(w.rows).toHaveLength(2)
  })

  it("a legacy-mode renewal (no order_id) enqueues nothing and reads nothing", async () => {
    enable()
    const w = makeWorld({ subs: [sub], products: [VAULT] })
    expect(
      await enqueueBlackMaskProvisioning(w.container, "subscription.renewal_processed", { subscription_id: "sub_1" })
    ).toEqual({ status: "skipped", reason: "legacy_renewal" })
    expect(w.rows).toHaveLength(0)
    expect(w.resolved).toEqual([])
  })

  it("subscription.canceled enqueues `cancelled` from canceled_at; without canceled_at it enqueues nothing", async () => {
    enable()
    const w = makeWorld({
      subs: [sub, { ...sub, id: "sub_2", canceled_at: "2026-02-15T00:00:00.000Z" }],
      products: [VAULT],
    })
    expect((await enqueueBlackMaskProvisioning(w.container, "subscription.canceled", { subscription_id: "sub_1" })).status).toBe(
      "skipped"
    )
    await enqueueBlackMaskProvisioning(w.container, "subscription.canceled", { subscription_id: "sub_2" })
    expect(w.rows.map((r) => r.event_id)).toEqual([
      `bm:v1:subscription:sub_2:cancelled:${Date.parse("2026-02-15T00:00:00.000Z")}`,
    ])
  })

  it("payment_failed is keyed by the dunning attempt time, so each attempt (and each cycle) is distinct", async () => {
    enable()
    const s = { ...sub, metadata: { dunning_attempts: 1, dunning_last_attempt_at: "2026-03-01T01:00:00.000Z" } }
    const w = makeWorld({ subs: [s], products: [VAULT] })
    await enqueueBlackMaskProvisioning(w.container, "subscription.payment_failed", { subscription_id: "sub_1", attempts: 1 })
    s.metadata = { dunning_attempts: 1, dunning_last_attempt_at: "2026-04-01T01:00:00.000Z" }
    await enqueueBlackMaskProvisioning(w.container, "subscription.payment_failed", { subscription_id: "sub_1", attempts: 1 })
    expect(w.rows).toHaveLength(2)
    expect(w.rows.every((r) => r.payload.event === "payment_failed")).toBe(true)
  })

  it("grace_started / read_only are sequenced from the event's occurred_at; without it nothing is enqueued", async () => {
    enable()
    const w = makeWorld({ subs: [sub], products: [VAULT] })
    await enqueueBlackMaskProvisioning(w.container, "subscription.grace_started", {
      subscription_id: "sub_1",
      occurred_at: "2026-03-04T00:00:00.000Z",
    })
    await enqueueBlackMaskProvisioning(w.container, "subscription.read_only", {
      subscription_id: "sub_1",
      occurred_at: "2026-03-11T00:00:00.000Z",
    })
    // The record's updated_at (2026-02-10) is never used: it moves on any
    // write, so a redelivered event would mint a new event_id.
    expect(
      await enqueueBlackMaskProvisioning(w.container, "subscription.read_only", { subscription_id: "sub_1" })
    ).toEqual({ status: "skipped", reason: "no_sequence" })
    expect(w.rows.map((r) => [r.payload.event, r.payload.occurred_at])).toEqual([
      ["grace_started", "2026-03-04T00:00:00.000Z"],
      ["read_only", "2026-03-11T00:00:00.000Z"],
    ])
  })

  it("a subscription on a non-vault product writes nothing", async () => {
    enable()
    const w = makeWorld({ subs: [{ ...sub, product_id: "prod_x", canceled_at: "2026-02-15T00:00:00.000Z" }], products: [OTHER_SELLER_WITH_PLAN] })
    expect(await enqueueBlackMaskProvisioning(w.container, "subscription.canceled", { subscription_id: "sub_1" })).toEqual({
      status: "skipped",
      reason: "not_vault",
    })
    expect(w.rows).toHaveLength(0)
  })
})

describe("subscriber", () => {
  it("listens to every announced event, including the grace slice's two", () => {
    expect(subscriberConfig.event).toEqual([...BLACK_MASK_MEDUSA_EVENTS])
    expect(BLACK_MASK_MEDUSA_EVENTS).toEqual([
      "order.placed",
      "order.canceled",
      "subscription.renewal_processed",
      "subscription.canceled",
      "subscription.payment_failed",
      "subscription.grace_started",
      "subscription.read_only",
    ])
  })

  it("routes the event name through to the real enqueue and swallows errors", async () => {
    enable()
    const w = makeWorld({ orders: [placedOrder], products: [VAULT] })
    await subscriber({ event: { name: "order.placed", data: { id: "order_1" } }, container: w.container } as never)
    expect(w.rows).toHaveLength(1)

    const broken = {
      resolve: () => {
        throw new Error("boom")
      },
    }
    await expect(
      subscriber({ event: { name: "order.placed", data: { id: "order_1" } }, container: broken } as never)
    ).resolves.toBeUndefined()
  })
})

describe("send-time customer lookup", () => {
  it("reads the customer's email and metadata through query on its imported key", async () => {
    const w = makeWorld({ customers: [{ id: "cus_1", email: "m@example.org", metadata: { a: 1 } }] })
    const find = makeBlackMaskCustomerLookup(w.container)
    expect(await find("cus_1")).toEqual({ email: "m@example.org", metadata: { a: 1 } })
    expect(await find("cus_missing")).toBeNull()
    expect(w.resolved.every((k) => k === ContainerRegistrationKeys.QUERY)).toBe(true)
  })
})
