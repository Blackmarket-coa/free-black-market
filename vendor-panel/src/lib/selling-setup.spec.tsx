import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { readFileSync } from "fs"
import { join } from "path"
import type { ReactElement } from "react"
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
 * SD-151 (4): a product the panel's form made was listed by the storefront
 * and could not be bought. Adding it to a cart answered "Sales channel … is
 * not associated with any stock location"; with a stock location and no
 * shipping option the checkout answered "Seller shipping method not found!"
 * (both measured), while Mercur marked the store's `locations_shipping` done.
 *
 * `readSellingSetup` says whether a buyer could check out, and
 * `setUpDelivery` makes a store's delivery from nothing with the calls the
 * sweep made successfully.
 */

const browser = await vi.hoisted(async () =>
  (await import("../__tests__/browser-storage")).installBrowserStorage()
)
vi.mock("./logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createBackend, json } from "../__tests__/backend"
import { createFakeStore } from "../__tests__/fake-store"
import {
  sellingSetupQueryKey,
  useSellingSetup,
  useSetUpDelivery,
} from "../hooks/api/selling-setup"
import { setAuthToken } from "./client"
import {
  fulfillmentSetName,
  readSellingSetup,
  recordStock,
  SELLING_LOCATION_FIELDS,
  SetupStepError,
  setUpDelivery,
  type DeliverySetupInput,
} from "./selling-setup"

const backend = createBackend()
let store: ReturnType<typeof createFakeStore>

const barn: DeliverySetupInput["location"] = {
  name: "Bravo Barn",
  address_1: "1 Farm Rd",
  city: "Atlanta",
  postal_code: "30301",
  country_code: "US",
}
const both: DeliverySetupInput = {
  location: barn,
  pickup: { name: "Pickup at the barn" },
  shipping: { name: "Flat delivery", amount: 5 },
}
/** The product form's payload for a published, stock-tracked product. */
const honey = (overrides: Record<string, unknown> = {}) => ({
  title: "Wildflower Honey",
  status: "published",
  variants: [
    {
      title: "Default variant",
      manage_inventory: true,
      variant_rank: 0,
      prices: [{ currency_code: "usd", amount: 12 }],
    },
  ],
  ...overrides,
})
const createProduct = async (payload = honey()) =>
  (
    await (
      await fetch("http://panel.test/vendor/seller-products", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    ).json()
  ).product.id as string
const posts = () => backend.sent.filter((s) => s.method === "POST")

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  backend.reset()
  vi.stubGlobal("fetch", backend.fetch)
  store = createFakeStore(backend)
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("readSellingSetup", () => {
  it("reads the store's channel, locations with their channels and zones, shipping options with their rules, and products, with the seller's bearer", async () => {
    const setup = await readSellingSetup()

    expect(backend.calls()).toEqual([
      "GET /vendor/sales-channels",
      "GET /vendor/stock-locations",
      "GET /vendor/shipping-options",
      "GET /vendor/products",
    ])
    expect(backend.sent[1].query).toEqual({ fields: SELLING_LOCATION_FIELDS })
    expect(SELLING_LOCATION_FIELDS).toContain("*sales_channels")
    expect(backend.sent[2].query).toEqual({ fields: "*rules" })
    expect(
      backend.sent.every(
        (s) => s.headers.get("authorization") === "Bearer tok-seller"
      )
    ).toBe(true)
    expect(setup.ready).toBe(false)
    expect(setup.delivery).toMatchObject({
      channel: { id: "sc_1" },
      location: null,
      locationLinked: false,
      options: [],
      ready: false,
    })
  })

  it("is not ready with a stock location that is not linked to the sales channel, which Mercur calls locations_shipping done", async () => {
    await createProduct()
    await setUpDelivery({ location: barn, pickup: null, shipping: null })
    // Undo the link, leaving what Settings, Locations left before it linked.
    store.db.locations[0].channels = []

    const setup = await readSellingSetup()

    expect(setup.delivery.locationLinked).toBe(false)
    expect(setup.delivery.location?.name).toBe("Bravo Barn")
    expect(setup.ready).toBe(false)
    expect(store.buyerCanCheckOut()).toMatch(
      /is not associated with any stock location/
    )
  })

  it("is not ready with a linked location and no shipping option", async () => {
    const product = await createProduct()
    await setUpDelivery({ location: barn, pickup: null, shipping: null })
    await recordStock({
      productId: product,
      locationId: store.db.locations[0].id,
      stock: [{ variant_rank: 0, quantity: 10 }],
    })

    const setup = await readSellingSetup()

    expect(setup.delivery).toMatchObject({
      locationLinked: true,
      options: [],
      ready: false,
    })
    expect(setup.listing.buyable).toMatchObject({ title: "Wildflower Honey" })
    expect(setup.ready).toBe(false)
    expect(store.buyerCanCheckOut()).toBe("Seller shipping method not found!")
  })

  it("does not count a return option, one hidden from the storefront, or one on a location the channel is not linked to", async () => {
    await setUpDelivery(both)
    const [pickup, shipping] = store.db.options
    pickup.rules = [{ attribute: "is_return", value: "true", operator: "eq" }]
    shipping.rules = [
      { attribute: "is_return", value: "false", operator: "eq" },
      { attribute: "enabled_in_store", value: "false", operator: "eq" },
    ]
    expect((await readSellingSetup()).delivery.options).toEqual([])

    shipping.rules = [{ attribute: "is_return", value: "false", operator: "eq" }]
    expect((await readSellingSetup()).delivery.options).toEqual([
      { id: shipping.id, name: "Flat delivery", kind: "shipping" },
    ])

    store.db.locations[0].channels = []
    const unlinked = await readSellingSetup()
    expect(unlinked.delivery.options).toEqual([])
    expect(unlinked.delivery.ready).toBe(false)
  })

  it("is ready once delivery is set up and a published product is in stock at the linked location", async () => {
    const product = await createProduct()
    await setUpDelivery(both)

    // Published and stock-tracked, with nothing in stock: not buyable.
    const before = await readSellingSetup()
    expect(before.delivery.ready).toBe(true)
    expect(before.listing).toMatchObject({
      total: 1,
      buyable: null,
      needsStock: { id: product, title: "Wildflower Honey" },
    })
    expect(before.ready).toBe(false)
    expect(store.buyerCanCheckOut()).toMatch(/required inventory/)

    await recordStock({
      productId: product,
      locationId: store.db.locations[0].id,
      stock: [{ variant_rank: 0, quantity: 10 }],
    })

    const after = await readSellingSetup()
    expect(after.listing.buyable).toEqual({
      id: product,
      title: "Wildflower Honey",
    })
    expect(after.ready).toBe(true)
    expect(store.buyerCanCheckOut()).toBe(true)
  })

  it("counts a published product that is not stock-tracked, and no draft", async () => {
    await setUpDelivery(both)
    const draft = await createProduct(honey({ status: "draft" }))

    const onlyDraft = await readSellingSetup()
    expect(onlyDraft.listing).toMatchObject({
      buyable: null,
      needsStock: null,
      draft: { id: draft },
    })
    expect(onlyDraft.ready).toBe(false)

    await createProduct(
      honey({
        title: "Coaching session",
        variants: [{ title: "Default variant", manage_inventory: false, variant_rank: 0 }],
      })
    )
    const setup = await readSellingSetup()
    expect(setup.listing.buyable).toMatchObject({ title: "Coaching session" })
    expect(setup.ready).toBe(true)
    expect(store.buyerCanCheckOut()).toBe(true)
  })
})

describe("setUpDelivery, for a store with nothing", () => {
  it("makes the scout's calls in order: location, sales-channel link, provider, fulfillment sets, service zones, a pickup and a flat-rate option, recalculation", async () => {
    const result = await setUpDelivery(both)

    expect(backend.calls()).toEqual([
      "GET /vendor/sales-channels",
      "GET /vendor/stock-locations",
      "GET /vendor/shipping-options",
      "POST /vendor/stock-locations",
      "POST /vendor/stock-locations/sloc_1/sales-channels",
      "GET /vendor/fulfillment-providers",
      "POST /vendor/stock-locations/sloc_1/fulfillment-providers",
      "GET /vendor/shipping-profiles",
      "GET /vendor/fulfillment-providers/manual_manual/options",
      "POST /vendor/stock-locations/sloc_1/fulfillment-sets",
      "POST /vendor/fulfillment-sets/fuset_2/service-zones",
      "POST /vendor/shipping-options",
      "POST /vendor/stock-locations/sloc_1/fulfillment-sets",
      "POST /vendor/fulfillment-sets/fuset_5/service-zones",
      "POST /vendor/shipping-options",
      "POST /vendor/sellers/me/onboarding",
    ])
    expect(posts().map((s) => s.body)).toEqual([
      {
        name: "Bravo Barn",
        address: {
          address_1: "1 Farm Rd",
          city: "Atlanta",
          country_code: "us",
          postal_code: "30301",
        },
      },
      { add: ["sc_1"] },
      { add: ["manual_manual"] },
      { name: "Bravo Barn pick up (sloc_1)", type: "pickup" },
      { name: "US (fuset_2)", geo_zones: [{ type: "country", country_code: "us" }] },
      {
        name: "Pickup at the barn",
        service_zone_id: "serzo_3",
        shipping_profile_id: "sp_default",
        provider_id: "manual_manual",
        prices: [{ currency_code: "usd", amount: 0 }],
        data: { id: "manual-fulfillment" },
        rules: [
          { value: "false", attribute: "is_return", operator: "eq" },
          { value: "true", attribute: "enabled_in_store", operator: "eq" },
        ],
        type: { label: "Pickup", description: "Pickup fulfillment", code: "pickup" },
      },
      { name: "Bravo Barn shipping (sloc_1)", type: "shipping" },
      { name: "US (fuset_5)", geo_zones: [{ type: "country", country_code: "us" }] },
      {
        name: "Flat delivery",
        service_zone_id: "serzo_6",
        shipping_profile_id: "sp_default",
        provider_id: "manual_manual",
        // Major units, as the scout sent 5 for $5.00.
        prices: [{ currency_code: "usd", amount: 5 }],
        data: { id: "manual-fulfillment" },
        rules: [
          { value: "false", attribute: "is_return", operator: "eq" },
          { value: "true", attribute: "enabled_in_store", operator: "eq" },
        ],
        type: { label: "Shipping", description: "Shipping fulfillment", code: "shipping" },
      },
      {},
    ])
    expect(
      backend.sent.every(
        (s) => s.headers.get("authorization") === "Bearer tok-seller"
      )
    ).toBe(true)
    expect(result).toEqual({
      location: { id: "sloc_1", name: "Bravo Barn", created: true },
      options: [
        { id: "so_4", name: "Pickup at the barn", kind: "pickup", created: true },
        { id: "so_7", name: "Flat delivery", kind: "shipping", created: true },
      ],
    })

    const setup = await readSellingSetup()
    expect(setup.delivery).toMatchObject({
      locationLinked: true,
      ready: true,
      options: [
        { name: "Pickup at the barn", kind: "pickup" },
        { name: "Flat delivery", kind: "shipping" },
      ],
    })
  })

  it("makes only a pickup option when that is all the vendor chose", async () => {
    await setUpDelivery({ ...both, shipping: null })

    expect(store.db.options.map((o) => o.name)).toEqual(["Pickup at the barn"])
    expect(store.db.sets.map((s) => s.type)).toEqual(["pickup"])
    expect((await readSellingSetup()).delivery.ready).toBe(true)
  })

  it("makes nothing twice when run again", async () => {
    await setUpDelivery(both)
    const made = posts().length

    const again = await setUpDelivery(both)

    // The second run reads, finds everything, and only recalculates.
    expect(posts().slice(made).map((s) => s.path)).toEqual([
      "/vendor/sellers/me/onboarding",
    ])
    expect(again.location).toEqual({
      id: "sloc_1",
      name: "Bravo Barn",
      created: false,
    })
    expect(again.options.map((o) => o.created)).toEqual([false, false])
    expect(store.db.locations).toHaveLength(1)
    expect(store.db.options).toHaveLength(2)
  })

  it("picks up where a failed run stopped, without a second location or option", async () => {
    // The first shipping-option request, the pickup option's, is refused.
    backend.once("POST", "/vendor/shipping-options", () =>
      json(500, { message: "An unknown error occurred." })
    )

    const error = await setUpDelivery(both).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SetupStepError)
    expect((error as SetupStepError).message).toBe(
      "Could not create the pickup option: An unknown error occurred."
    )
    // The location is there and linked; no option was made.
    expect((await readSellingSetup()).delivery).toMatchObject({
      locationLinked: true,
      options: [],
    })

    await setUpDelivery(both)

    expect(store.db.locations).toHaveLength(1)
    expect(store.db.sets).toHaveLength(2)
    expect(store.db.zones).toHaveLength(2)
    expect(store.db.options.map((o) => o.name)).toEqual([
      "Pickup at the barn",
      "Flat delivery",
    ])
  })

  it("links and reuses a location the vendor already has, instead of making another", async () => {
    // What Settings, Locations leaves when its sales-channel link is undone.
    await setUpDelivery({ location: { ...barn, name: "Home" }, pickup: null, shipping: null })
    store.db.locations[0].channels = []
    backend.sent.length = 0

    await setUpDelivery({ ...both, location: { ...barn, name: "Ignored" } })

    expect(store.db.locations.map((l) => l.name)).toEqual(["Home"])
    expect(posts()[0]).toMatchObject({
      path: "/vendor/stock-locations/sloc_1/sales-channels",
      body: { add: ["sc_1"] },
    })
    expect(store.db.sets.map((s) => s.name)).toEqual([
      "Home pick up (sloc_1)",
      "Home shipping (sloc_1)",
    ])
  })

  it("names its fulfillment sets and zones so that another store's cannot collide: Medusa keeps both unique marketplace-wide", async () => {
    // Another store has a location called Bravo Barn, set up in Settings,
    // Locations, and a zone called US.
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, {
      takenNames: ["Bravo Barn shipping", "Bravo Barn pick up", "US"],
    })

    await setUpDelivery(both)

    expect((await readSellingSetup()).delivery.ready).toBe(true)
  })

  it("Settings, Locations names its fulfillment sets the same way", () => {
    expect(fulfillmentSetName("Home", "sloc_1", "shipping")).toBe(
      "Home shipping (sloc_1)"
    )
    expect(fulfillmentSetName("Home", "sloc_1", "pickup")).toBe(
      "Home pick up (sloc_1)"
    )
    // Two stores whose locations share a name ask for different sets.
    expect(fulfillmentSetName("Home", "sloc_1", "shipping")).not.toBe(
      fulfillmentSetName("Home", "sloc_2", "shipping")
    )

    const screen = readFileSync(
      join(
        __dirname,
        "../routes/locations/location-detail/components/location-general-section/location-general-section.tsx"
      ),
      "utf8"
    )
    const create = screen.slice(screen.indexOf("await createFulfillmentSet("))
    expect(create.slice(0, create.indexOf("onSuccess"))).toContain(
      "name: fulfillmentSetName("
    )
  })

  it("creates a default shipping profile for a store that has none", async () => {
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { noShippingProfile: true })

    await setUpDelivery(both)

    const created = posts().find((s) => s.path === "/vendor/shipping-profiles")
    expect(created?.body).toEqual({
      name: "Default shipping profile",
      type: "default",
    })
    expect(store.db.options.every((o) => o.shipping_profile_id === store.db.profiles[0].id)).toBe(true)
  })

  it("says which step the backend refused, in the backend's words, and stops", async () => {
    backend.on("POST", "/vendor/stock-locations", () =>
      json(400, { type: "invalid_data", message: "Invalid request: Field 'address, country_code' is required" })
    )

    const error = await setUpDelivery(both).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SetupStepError)
    expect((error as SetupStepError).message).toBe(
      "Could not create the stock location: Invalid request: Field 'address, country_code' is required"
    )
    expect(posts().map((s) => s.path)).toEqual(["/vendor/stock-locations"])
  })
})

describe("recordStock", () => {
  it("reads the product's inventory item and creates its level: POST /vendor/inventory-items/location-levels/batch", async () => {
    const product = await createProduct()
    await setUpDelivery({ ...both, shipping: null })
    const location = store.db.locations[0].id
    backend.sent.length = 0

    await recordStock({
      productId: product,
      locationId: location,
      stock: [{ variant_rank: 0, quantity: 10 }],
    })

    const item = store.db.products[0].variants[0].item
    expect(backend.calls()).toEqual([
      `GET /vendor/products/${product}`,
      `GET /vendor/inventory-items/${item}/location-levels`,
      "POST /vendor/inventory-items/location-levels/batch",
    ])
    expect(backend.sent[2].body).toEqual({
      create: [
        { inventory_item_id: item, location_id: location, stocked_quantity: 10 },
      ],
      update: [],
      delete: [],
    })
  })

  it("updates a level that exists, so it can be run again", async () => {
    const product = await createProduct()
    await setUpDelivery({ ...both, shipping: null })
    const location = store.db.locations[0].id
    const stock = (quantity: number) =>
      recordStock({
        productId: product,
        locationId: location,
        stock: [{ variant_rank: 0, quantity }],
      })

    await stock(10)
    await stock(4)

    const item = store.db.products[0].variants[0].item
    expect(backend.sent.at(-1)?.body).toEqual({
      create: [],
      update: [
        { inventory_item_id: item, location_id: location, stocked_quantity: 4 },
      ],
      delete: [],
    })
    expect(store.db.levels).toHaveLength(1)
    expect(store.db.levels[0].stocked).toBe(4)
  })
})

describe("the hooks", () => {
  const newClient = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  const render = (client: QueryClient, element: ReactElement) =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>
    )

  it("useSetUpDelivery runs the setup, and the readiness read after it says ready", async () => {
    const client = newClient()
    const hooks: { setUp?: ReturnType<typeof useSetUpDelivery> } = {}
    const Probe = () => {
      useSellingSetup()
      hooks.setUp = useSetUpDelivery()
      return null
    }
    render(client, <Probe />)
    const query = client
      .getQueryCache()
      .find({ queryKey: sellingSetupQueryKey, exact: true })!

    await query.fetch()
    expect(query.state.data).toMatchObject({ ready: false })

    await hooks.setUp!.mutateAsync(both)
    // The write invalidated the read.
    expect(query.state.isInvalidated).toBe(true)
    await query.fetch()
    expect(query.state.data).toMatchObject({
      delivery: { ready: true, locationLinked: true },
    })
  })

  it("useSetUpDelivery rejects with the step the backend refused, and still refreshes the read", async () => {
    backend.on("POST", "/vendor/shipping-options", () =>
      json(400, { type: "invalid_data", message: "Providers (manual_manual) are not enabled for the service location" })
    )
    const client = newClient()
    const hooks: { setUp?: ReturnType<typeof useSetUpDelivery> } = {}
    const Probe = () => {
      useSellingSetup()
      hooks.setUp = useSetUpDelivery()
      return null
    }
    render(client, <Probe />)
    const query = client
      .getQueryCache()
      .find({ queryKey: sellingSetupQueryKey, exact: true })!
    await query.fetch()

    await expect(hooks.setUp!.mutateAsync(both)).rejects.toThrow(
      "Could not create the pickup option: Providers (manual_manual) are not enabled for the service location"
    )
    expect(query.state.isInvalidated).toBe(true)
  })
})
