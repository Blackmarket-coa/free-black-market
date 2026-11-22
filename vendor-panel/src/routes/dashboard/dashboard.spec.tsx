import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

/**
 * SD-151 (4): the dashboard left setup once Mercur's `products` and
 * `locations_shipping` were true. Mercur sets the second for any stock
 * location, so a store whose product could not be added to a cart or checked
 * out was shown as set up. It now leaves setup when a buyer could check out,
 * and its checklist says what is missing.
 *
 * Also: the checklist read `stripe_connect`, where Mercur answers
 * `stripe_connection`, so payouts never appeared in it.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)
vi.mock("../../lib/logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// The two things the dashboard can show, and the checklist's rows.
const shown = vi.hoisted(() => ({
  rows: [] as Array<{
    label: string
    description?: string
    state: boolean
    link: string
  }>,
}))
vi.mock("./components/dashboard-charts", () => ({
  DashboardCharts: () => "STORE-NUMBERS",
}))
vi.mock("./components/economic-standing-card", () => ({
  EconomicStandingCard: () => null,
}))
vi.mock("./components/chart-skeleton", () => ({
  ChartSkeleton: () => "LOADING",
}))
vi.mock("./components/onboarding-row", () => ({
  OnboardingRow: (props: (typeof shown.rows)[number]) => {
    shown.rows.push({
      label: props.label,
      description: props.description,
      state: props.state,
      link: props.link,
    })
    return null
  },
}))
// A Stall seller: products, inventory, support.
vi.mock("../../providers/vendor-type-provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../providers/vendor-type-provider")>()
  return {
    ...actual,
    useVendorType: () => ({
      vendorType: "maker",
      typeLabel: "Maker & Brand",
      features: actual.getDefaultFeatures("maker", "stall"),
    }),
  }
})
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  Link: ({ children }: { children?: unknown }) => children,
}))

import { createBackend, json } from "../../__tests__/backend"
import { createFakeStore } from "../../__tests__/fake-store"
import { ordersQueryKeys } from "../../hooks/api/orders"
import { reviewsQueryKeys } from "../../hooks/api/review"
import { sellingSetupQueryKey } from "../../hooks/api/selling-setup"
import { setAuthToken } from "../../lib/client"
import {
  readSellingSetup,
  recordStock,
  setUpDelivery,
} from "../../lib/selling-setup"
import { getOnboardingSteps, isStoreSetUp } from "./config/dashboard-config"
import { DashboardContent } from "./dashboard"

const backend = createBackend()
let store: ReturnType<typeof createFakeStore>
let client: QueryClient

const barn = {
  name: "Bravo Barn",
  address_1: "1 Farm Rd",
  city: "Atlanta",
  postal_code: "30301",
  country_code: "us",
}
/** A published, stock-tracked product, as the product form used to make it. */
const listHoney = async (status = "published") =>
  (
    await (
      await fetch("http://panel.test/vendor/seller-products", {
        method: "POST",
        body: JSON.stringify({
          title: "Wildflower Honey",
          status,
          variants: [{ title: "Default variant", manage_inventory: true, variant_rank: 0, prices: [{ currency_code: "usd", amount: 12 }] }],
        }),
      })
    ).json()
  ).product.id as string

/**
 * The dashboard as it renders once its reads have answered. `mercur` is what
 * `GET /vendor/sellers/me/onboarding` answers; the store itself is read from
 * the fake, unless the seller has orders.
 */
const dashboard = async ({
  mercur,
  orders = [],
}: {
  mercur: Record<string, boolean>
  orders?: Array<Record<string, unknown>>
}) => {
  client.setQueryData(["onboarding"], { onboarding: mercur })
  client.setQueryData(ordersQueryKeys.list(undefined), {
    orders,
    count: orders.length,
  })
  client.setQueryData(reviewsQueryKeys.list(undefined), { reviews: [] })
  if (orders.length === 0) {
    await client
      .fetchQuery({ queryKey: sellingSetupQueryKey, queryFn: readSellingSetup })
      .catch(() => undefined)
  }
  shown.rows.length = 0
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DashboardContent />
    </QueryClientProvider>
  )
  const row = (key: string) => {
    const index = getOnboardingSteps(
      "maker",
      { hasProducts: true } as never,
      undefined
    ).findIndex((step) => step.key === key)
    return shown.rows[index]
  }
  return { html, inSetup: !html.includes("STORE-NUMBERS"), row }
}

/** What Mercur answered the scout's store once it had a location and a product. */
const mercurSaysDone = {
  store_information: true,
  stripe_connection: false,
  locations_shipping: true,
  products: true,
}

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  backend.reset()
  vi.stubGlobal("fetch", backend.fetch)
  store = createFakeStore(backend)
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false },
      mutations: { retry: false },
    },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("the dashboard does not say a store is set up until a buyer could check out", () => {
  it("stays in setup with a stock location that is not linked to the sales channel, though Mercur says locations_shipping and products are done", async () => {
    await listHoney()
    await setUpDelivery({ location: barn, pickup: null, shipping: null })
    store.db.locations[0].channels = []
    expect(store.buyerCanCheckOut()).toMatch(/not associated with any stock location/)

    const { inSetup, row } = await dashboard({ mercur: mercurSaysDone })

    expect(inSetup).toBe(true)
    expect(row("delivery")).toEqual({
      label: "Set up pickup or shipping",
      description:
        "Bravo Barn is not linked to your sales channel, so buyers cannot add your products to a cart.",
      state: false,
      link: "/delivery-setup",
    })
  })

  it("stays in setup with a linked location and no shipping option", async () => {
    const product = await listHoney()
    await setUpDelivery({ location: barn, pickup: null, shipping: null })
    await recordStock({
      productId: product,
      locationId: store.db.locations[0].id,
      stock: [{ variant_rank: 0, quantity: 10 }],
    })
    expect(store.buyerCanCheckOut()).toBe("Seller shipping method not found!")

    const { inSetup, row } = await dashboard({ mercur: mercurSaysDone })

    expect(inSetup).toBe(true)
    expect(row("delivery")).toMatchObject({
      description:
        "Bravo Barn has no pickup or shipping option, so buyers cannot check out.",
      state: false,
    })
    // The product itself is fine.
    expect(row("products")).toMatchObject({ state: true })
  })

  it("stays in setup while no buyer is offered the option or charged for the product in their currency", async () => {
    const product = await listHoney()
    store.db.products[0].variants[0].prices = [{ currency_code: "eur", amount: 12, rules: [] }]
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    await recordStock({
      productId: product,
      locationId: store.db.locations[0].id,
      stock: [{ variant_rank: 0, quantity: 10 }],
    })
    expect(store.buyerCanCheckOut()).toMatch(/do not have a price/)

    const priced = await dashboard({ mercur: mercurSaysDone })
    expect(priced.inSetup).toBe(true)
    expect(priced.row("delivery")).toMatchObject({ state: true })
    expect(priced.row("products")).toEqual({
      label: "Price Wildflower Honey in USD",
      description:
        "It is published, but it has no price in USD, the currency buyers pay in, so they cannot add it to a cart.",
      state: false,
      link: `/products/${product}/prices`,
    })

    // The product priced, the option now in euros only.
    store.db.products[0].variants[0].prices = [{ currency_code: "usd", amount: 12, rules: [] }]
    store.db.options[0].prices = [{ currency_code: "eur", amount: 0, rules: [] }]
    expect(store.buyerCanCheckOut()).toMatch(/^Shipping options with IDs/)
    const unpriced = await dashboard({ mercur: mercurSaysDone })
    expect(unpriced.inSetup).toBe(true)
    expect(unpriced.row("delivery")).toMatchObject({
      description:
        "No buyer is offered your pickup or shipping, so buyers cannot check out. Pickup has no price in USD, the currency buyers there pay in.",
      state: false,
    })
  })

  it("stays in setup while the published product has no stock, and sends the vendor to its stock", async () => {
    const product = await listHoney()
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    expect(store.buyerCanCheckOut()).toMatch(/required inventory/)

    const { inSetup, row } = await dashboard({ mercur: mercurSaysDone })

    expect(inSetup).toBe(true)
    expect(row("delivery")).toMatchObject({
      description: "Buyers can choose: Pickup.",
      state: true,
    })
    expect(row("products")).toEqual({
      label: "Add stock to Wildflower Honey",
      description:
        "It is published, but none is in stock, so buyers cannot add it to a cart.",
      state: false,
      link: `/products/${product}/stock`,
    })
  })

  it("stays in setup with only a draft, and sends the vendor to publish it", async () => {
    const draft = await listHoney("draft")
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })

    const { inSetup, row } = await dashboard({ mercur: mercurSaysDone })

    expect(inSetup).toBe(true)
    expect(row("products")).toMatchObject({
      label: "Publish Wildflower Honey",
      state: false,
      link: `/products/${draft}`,
    })
  })

  it("leaves setup once the location is linked, an option exists and the product is in stock", async () => {
    const product = await listHoney()
    await setUpDelivery({
      location: barn,
      pickup: { name: "Pickup" },
      shipping: { name: "Flat delivery", amount: 5 },
    })
    await recordStock({
      productId: product,
      locationId: store.db.locations[0].id,
      stock: [{ variant_rank: 0, quantity: 10 }],
    })
    expect(store.buyerCanCheckOut()).toBe(true)

    const { inSetup } = await dashboard({ mercur: mercurSaysDone })

    expect(inSetup).toBe(false)
  })

  it("stays in setup until the profile is complete, as before", async () => {
    const product = await listHoney()
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    await recordStock({
      productId: product,
      locationId: store.db.locations[0].id,
      stock: [{ variant_rank: 0, quantity: 1 }],
    })

    const { inSetup, row } = await dashboard({
      mercur: { ...mercurSaysDone, store_information: false },
    })

    expect(inSetup).toBe(true)
    expect(row("store_information")).toMatchObject({ state: false })
    expect(row("delivery")).toMatchObject({ state: true })
    expect(row("products")).toMatchObject({ state: true })
  })

  it("shows the error, not the store's numbers, when the store cannot be read", async () => {
    backend.on("GET", "/vendor/shipping-options", () =>
      json(500, { message: "An unknown error occurred." })
    )

    const { html, inSetup } = await dashboard({ mercur: mercurSaysDone })

    expect(inSetup).toBe(true)
    expect(html).toContain("Dashboard data unavailable")
    expect(shown.rows).toEqual([])
  })

  it("keeps a store buyers have ordered from out of setup, and does not read its setup", async () => {
    // Sold out, or selling at a till: the checklist must not cover its orders.
    backend.sent.length = 0

    const { inSetup } = await dashboard({
      mercur: mercurSaysDone,
      orders: [{ id: "order_1", fulfillment_status: "not_fulfilled" }],
    })

    expect(inSetup).toBe(false)
    expect(backend.sent).toEqual([])
  })

  it("isStoreSetUp: the profile, and either an order or a store a buyer could check out from", () => {
    const profile = { store_information: true }
    expect(isStoreSetUp({ onboarding: profile, selling: { ready: true }, orderCount: 0 })).toBe(true)
    expect(isStoreSetUp({ onboarding: profile, selling: { ready: false }, orderCount: 0 })).toBe(false)
    expect(isStoreSetUp({ onboarding: profile, selling: undefined, orderCount: 0 })).toBe(false)
    expect(isStoreSetUp({ onboarding: profile, selling: { ready: false }, orderCount: 1 })).toBe(true)
    expect(isStoreSetUp({ onboarding: {}, selling: { ready: true }, orderCount: 3 })).toBe(false)
    expect(isStoreSetUp({ onboarding: undefined, selling: { ready: true }, orderCount: 0 })).toBe(false)
  })
})

describe("payouts in the checklist", () => {
  it("is a step, done when Mercur's stripe_connection is true", async () => {
    const before = await dashboard({ mercur: { store_information: false } })
    expect(before.row("stripe_connection")).toEqual({
      label: "Set up payouts",
      description:
        "Connect a US bank account through Stripe so your sales can be paid out to you.",
      state: false,
      link: "/stripe-connect",
    })

    const after = await dashboard({
      mercur: { store_information: false, stripe_connection: true },
    })
    expect(after.row("stripe_connection")).toMatchObject({ state: true })
  })

  it("is not read from stripe_connect, which no response carries", async () => {
    const { row } = await dashboard({
      mercur: { store_information: false, stripe_connect: true },
    })

    expect(row("stripe_connection")).toMatchObject({ state: false })
  })

  it("does not hold a store in setup", () => {
    // Buyers can order before the store can be paid: it was not required
    // before either.
    expect(
      isStoreSetUp({
        onboarding: { store_information: true },
        selling: { ready: true },
        orderCount: 0,
      })
    ).toBe(true)
  })
})
