import { processChannelListingSync } from "../channel-listing-sync"
import { CHANNEL_CONNECTOR_MODULE } from "../../modules/channel-connector/module-key"
import { shouldAttemptNow } from "../../modules/channel-connector/throttle"
import { ChannelApiError } from "../../modules/channel-connector/types"
import { reduceToChannelProduct } from "../../shared/channel-products"

/**
 * The sync is where a connector stops being configuration and starts changing
 * a vendor's live wholesale catalogue. These cover the ways that goes wrong
 * expensively rather than the happy path.
 */

const mockProducts = jest.fn()
jest.mock("../../shared/channel-products", () => {
  const actual = jest.requireActual("../../shared/channel-products")
  return { ...actual, loadSellerChannelProducts: () => mockProducts() }
})

const product = (id: string, sku: string) => ({
  id,
  title: `Product ${id}`,
  description: null,
  sku,
  price_amount: 1_000,
  currency_code: "usd",
  inventory_quantity: 5,
  images: [],
  categories: [],
  weight_grams: null,
  active: true,
})

type Listing = { id: string; external_id: string }

const makeContainer = (opts: {
  connections?: Record<string, unknown>[]
  listings?: Record<string, Listing>
  pushListing?: jest.Mock
}) => {
  const listings: Record<string, Listing> = { ...(opts.listings ?? {}) }
  const recordListing = jest.fn(async (input: Record<string, string>) => {
    listings[input.product_id] = {
      id: `cl_${input.product_id}`,
      external_id: input.external_id,
    }
  })
  const recordListingError = jest.fn(async () => undefined)
  const recordSync = jest.fn(async () => undefined)
  const recordFailure = jest.fn(
    async (_input: {
      row: { id: string; channel_id: string }
      status: number
      retryAfterSeconds?: number | null
      message?: string
      now?: Date
    }) => undefined
  )
  const recordSuccess = jest.fn(async (_id: string, _now?: Date) => undefined)

  const service = {
    // The real gate rather than a constant, so a stub cannot quietly disagree
    // with what the service actually does.
    mayAttempt: (row: { throttled_until?: Date | null }, now: Date) =>
      shouldAttemptNow({ throttled_until: row.throttled_until ?? null }, now),
    recordFailure,
    recordSuccess,
    listChannelConnections: async () =>
      opts.connections ?? [
        {
          id: "cc_1",
          seller_id: "sel_1",
          channel_id: "faire",
          api_base_url: "https://faire.test",
          access_token: "tok",
          options: null,
          enabled: true,
        },
      ],
    toCredentials: (row: Record<string, string>) => ({
      api_base_url: row.api_base_url,
      access_token: row.access_token,
    }),
    getListing: async (_s: string, _c: string, productId: string) =>
      listings[productId] ?? null,
    recordListing,
    recordListingError,
    recordSync,
  }

  return {
    container: {
      resolve: (key: string) =>
        key === CHANNEL_CONNECTOR_MODULE ? service : undefined,
    },
    recordListing,
    recordListingError,
    recordSync,
    recordFailure,
    recordSuccess,
  }
}

const mockAdapterPush = jest.fn()
jest.mock("../../modules/channel-connector/adapters", () => ({
  getChannelAdapter: (id: string) =>
    id === "faire"
      ? {
          id: "faire",
          capabilities: ["push_listing"],
          supports: (c: string) => c === "push_listing",
          pushListing: (...args: unknown[]) => mockAdapterPush(...args),
        }
      : null,
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockProducts.mockResolvedValue({ products: [], skipped: [] })
})

describe("processChannelListingSync", () => {
  it("creates a listing the first time and records its external id", async () => {
    mockProducts.mockResolvedValue({ products: [product("p1", "S1")], skipped: [] })
    mockAdapterPush.mockResolvedValue({ external_id: "faire_1", created: true })

    const { container, recordListing } = makeContainer({})
    const result = await processChannelListingSync(container as never)

    expect(result).toMatchObject({ pushed: 1, created: 1, updated: 0, failed: 0 })
    expect(recordListing).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: "p1", external_id: "faire_1" })
    )
  })

  it("updates via the stored external id rather than matching on SKU", async () => {
    // The load-bearing case. Without the stored id, the first product a vendor
    // renames appears twice in their live wholesale catalogue.
    mockProducts.mockResolvedValue({ products: [product("p1", "RENAMED")], skipped: [] })
    mockAdapterPush.mockResolvedValue({ external_id: "faire_1", created: false })

    const { container } = makeContainer({
      listings: { p1: { id: "cl_1", external_id: "faire_1" } },
    })
    const result = await processChannelListingSync(container as never)

    expect(result).toMatchObject({ updated: 1, created: 0 })
    // Third argument is the external id — an update, not a create.
    expect(mockAdapterPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "faire_1"
    )
  })

  it("keeps going past one product's rejection", async () => {
    // A vendor with one bad SKU should get every other listing, not a run that
    // died on product two.
    mockProducts.mockResolvedValue({
      products: [product("p1", "S1"), product("p2", "S2"), product("p3", "S3")],
      skipped: [],
    })
    mockAdapterPush
      .mockResolvedValueOnce({ external_id: "f1", created: true })
      .mockRejectedValueOnce(new ChannelApiError("bad sku", 422, "faire"))
      .mockResolvedValueOnce({ external_id: "f3", created: true })

    const { container, recordListingError } = makeContainer({})
    const result = await processChannelListingSync(container as never)

    expect(result).toMatchObject({ pushed: 2, failed: 1 })
    expect(recordListingError).toHaveBeenCalledWith(
      "sel_1",
      "faire",
      "p2",
      expect.stringContaining("bad sku")
    )
  })

  describe("standing down (Phase 12)", () => {
    const now = new Date("2026-08-04T12:00:00.000Z")

    it("does not even load the catalogue for a connection backing off", async () => {
      // Checked before `loadSellerChannelProducts`, which is the expensive part
      // of this loop. A connection asked to wait should cost nothing.
      const { container } = makeContainer({
        connections: [
          {
            id: "cc_1",
            seller_id: "sel_1",
            channel_id: "faire",
            api_base_url: "https://faire.test",
            access_token: "tok",
            options: null,
            enabled: true,
            throttled_until: new Date("2026-08-04T12:30:00.000Z"),
          },
        ],
      })

      const result = await processChannelListingSync(container as never, { now })

      expect(result.throttled).toBe(1)
      expect(result.connections).toBe(0)
      expect(mockProducts).not.toHaveBeenCalled()
      expect(mockAdapterPush).not.toHaveBeenCalled()
    })

    it("passes the channel's own Retry-After through to the backoff", async () => {
      mockProducts.mockResolvedValue({
        products: [product("p1", "S1")],
        skipped: [],
      })
      mockAdapterPush.mockRejectedValue(
        new ChannelApiError("slow down", 429, "faire", undefined, 600)
      )

      const { container, recordFailure } = makeContainer({})
      await processChannelListingSync(container as never, { now })

      expect(recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ status: 429, retryAfterSeconds: 600 })
      )
    })

    it("does not clear the stand-down on a run that aborted", async () => {
      // The abort has just set a backoff. Clearing it here would erase it
      // before the next tick ever read it.
      mockProducts.mockResolvedValue({
        products: [product("p1", "S1"), product("p2", "S2")],
        skipped: [],
      })
      mockAdapterPush
        .mockResolvedValueOnce({ external_id: "f1", created: true })
        .mockRejectedValueOnce(new ChannelApiError("down", 503, "faire"))

      const { container, recordSuccess } = makeContainer({})
      await processChannelListingSync(container as never, { now })

      expect(recordSuccess).not.toHaveBeenCalled()
    })

    it("clears it on a clean run", async () => {
      mockProducts.mockResolvedValue({
        products: [product("p1", "S1")],
        skipped: [],
      })
      mockAdapterPush.mockResolvedValue({ external_id: "f1", created: true })

      const { container, recordSuccess } = makeContainer({})
      await processChannelListingSync(container as never, { now })

      expect(recordSuccess).toHaveBeenCalledWith("cc_1", now)
    })

    it("keeps running past a rejection without pausing the connection", async () => {
      // A 422 is one bad product. It is recorded so a wholly broken connection
      // stays visible, but pausing here would stop the products that are fine.
      mockProducts.mockResolvedValue({
        products: [product("p1", "S1"), product("p2", "S2")],
        skipped: [],
      })
      mockAdapterPush
        .mockRejectedValueOnce(new ChannelApiError("bad sku", 422, "faire"))
        .mockResolvedValueOnce({ external_id: "f2", created: true })

      const { container, recordFailure, recordListingError, recordSuccess } =
        makeContainer({})
      const result = await processChannelListingSync(container as never, { now })

      expect(result).toMatchObject({ failed: 1, pushed: 1 })
      // Recorded against the product, not against the connection: otherwise a
      // catalogue with twenty bad SKUs would overwrite the connection's error
      // twenty times and cost a write for each.
      expect(recordFailure).not.toHaveBeenCalled()
      expect(recordListingError).toHaveBeenCalledWith(
        "sel_1",
        "faire",
        "p1",
        expect.stringContaining("bad sku")
      )
      // Something did push, so the connection is demonstrably healthy.
      expect(recordSuccess).toHaveBeenCalled()
    })
  })

  it("stops the seller's run on a retryable failure instead of hammering", async () => {
    // A 429 or a 502 will hit every remaining product too. Stopping and letting
    // the next pass retry beats burning the whole catalogue against a channel
    // that is rate-limiting.
    mockProducts.mockResolvedValue({
      products: [product("p1", "S1"), product("p2", "S2"), product("p3", "S3")],
      skipped: [],
    })
    mockAdapterPush
      .mockResolvedValueOnce({ external_id: "f1", created: true })
      .mockRejectedValueOnce(new ChannelApiError("slow down", 429, "faire"))

    const { container, recordSync } = makeContainer({})
    const result = await processChannelListingSync(container as never)

    expect(result.pushed).toBe(1)
    expect(mockAdapterPush).toHaveBeenCalledTimes(2)
    // And the reason is recorded so the panel can explain the stall.
    expect(recordSync).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("slow down") })
    )
  })

  it("records a clean run with no error", async () => {
    mockProducts.mockResolvedValue({ products: [product("p1", "S1")], skipped: [] })
    mockAdapterPush.mockResolvedValue({ external_id: "f1", created: true })

    const { container, recordSync } = makeContainer({})
    await processChannelListingSync(container as never)

    expect(recordSync).toHaveBeenCalledWith(
      expect.objectContaining({ error: null })
    )
  })

  it("skips a paused connection without touching the channel", async () => {
    // Pausing keeps credentials and the listing map so resuming is safe.
    mockProducts.mockResolvedValue({ products: [product("p1", "S1")], skipped: [] })
    const { container } = makeContainer({
      connections: [
        {
          id: "cc_1",
          seller_id: "sel_1",
          channel_id: "faire",
          api_base_url: "https://x",
          access_token: "t",
          enabled: false,
        },
      ],
    })

    const result = await processChannelListingSync(container as never)
    expect(result.connections).toBe(0)
    expect(mockAdapterPush).not.toHaveBeenCalled()
  })

  it("skips a connection whose channel this build no longer ships", async () => {
    // Real state after a rollback — must not crash the run for everyone else.
    const { container } = makeContainer({
      connections: [
        {
          id: "cc_1",
          seller_id: "sel_1",
          channel_id: "shopify",
          api_base_url: "https://x",
          access_token: "t",
          enabled: true,
        },
      ],
    })

    const result = await processChannelListingSync(container as never)
    expect(result.connections).toBe(0)
    expect(mockAdapterPush).not.toHaveBeenCalled()
  })

  it("reports products it could not push rather than dropping them", async () => {
    // A run that silently syncs 12 of 20 erodes trust in the integration
    // permanently.
    mockProducts.mockResolvedValue({
      products: [],
      skipped: [{ product_id: "p9", reason: "Product has no variants to list." }],
    })

    const { container, recordSync } = makeContainer({})
    const result = await processChannelListingSync(container as never)

    expect(result.skipped).toBe(1)
    expect(recordSync).toHaveBeenCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({
          errors: [{ product_id: "p9", reason: "Product has no variants to list." }],
        }),
      })
    )
  })
})

describe("reduceToChannelProduct", () => {
  const base = {
    id: "prod_1",
    title: "Jam",
    description: "Sweet",
    status: "published",
    thumbnail: "https://cdn/t.jpg",
    images: [{ url: "https://cdn/a.jpg" }],
    categories: [{ name: "Pantry" }],
    variants: [
      {
        sku: "JAM-1",
        weight: 300,
        manage_inventory: true,
        inventory_quantity: 12,
        prices: [{ amount: 750, currency_code: "usd" }],
      },
    ],
  }

  it("reduces a single-variant product", () => {
    const reduced = reduceToChannelProduct(base)
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    expect(reduced.product).toMatchObject({
      id: "prod_1",
      sku: "JAM-1",
      price_amount: 750,
      inventory_quantity: 12,
      weight_grams: 300,
      active: true,
    })
    // Thumbnail first, then gallery, de-duplicated.
    expect(reduced.product.images).toEqual(["https://cdn/t.jpg", "https://cdn/a.jpg"])
  })

  it("reports a multi-variant product instead of flattening it silently", () => {
    // Pushing only the first variant without saying so leaves a vendor
    // wondering where their other sizes went.
    const reduced = reduceToChannelProduct({
      ...base,
      variants: [base.variants[0], { ...base.variants[0], sku: "JAM-2" }],
    })
    expect(reduced.ok).toBe(false)
    if (reduced.ok) return
    expect(reduced.reason).toContain("2 variants")
  })

  it("reports a product with no variants", () => {
    const reduced = reduceToChannelProduct({ ...base, variants: [] })
    expect(reduced.ok).toBe(false)
  })

  it("maps untracked inventory to null, not zero", () => {
    // `manage_inventory: false` means Medusa is deliberately not counting —
    // which the mapper must read as "do not claim stock", not as a sell-out.
    const reduced = reduceToChannelProduct({
      ...base,
      variants: [{ ...base.variants[0], manage_inventory: false }],
    })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    expect(reduced.product.inventory_quantity).toBeNull()
  })

  it("marks a draft product inactive rather than refusing it", () => {
    const reduced = reduceToChannelProduct({ ...base, status: "draft" })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    // So unpublishing in FBM unpublishes on the channel, instead of leaving it
    // live to buyers.
    expect(reduced.product.active).toBe(false)
  })
})
