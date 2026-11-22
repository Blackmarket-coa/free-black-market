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
import { createFakeStore, US_REGION } from "../__tests__/fake-store"
import {
  sellingSetupQueryKey,
  useSellingSetup,
  useSetUpDelivery,
} from "../hooks/api/selling-setup"
import { setAuthToken } from "./client"
import {
  fulfillmentSetName,
  publishFirstListing,
  unofferedReason,
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
      "GET /vendor/regions",
      "GET /vendor/products",
    ])
    expect(backend.sent[1].query).toEqual({ fields: SELLING_LOCATION_FIELDS })
    expect(SELLING_LOCATION_FIELDS).toContain("*sales_channels")
    // Each option's rules, and its prices with theirs.
    expect(backend.sent[2].query).toEqual({ fields: "*rules,*prices.price_rules" })
    // Every region with its countries and currency, as the product form asks.
    expect(backend.sent[3].query).toEqual({ limit: "9999" })
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
      { id: shipping.id, name: "Flat delivery", kind: "shipping", regions: ["reg_us"] },
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

  it("does not count stock held at a location the sales channel is not linked to", async () => {
    const product = await createProduct()
    await setUpDelivery({ ...both, shipping: null })
    // A second location, never linked: Settings, Locations makes these.
    const shed = (
      await (
        await fetch("http://panel.test/vendor/stock-locations", {
          method: "POST",
          body: JSON.stringify({ name: "Old Shed", address: { address_1: "2 Farm Rd", country_code: "us" } }),
        })
      ).json()
    ).stock_location.id as string
    await recordStock({
      productId: product,
      locationId: shed,
      stock: [{ variant_rank: 0, quantity: 10 }],
    })
    // The stock exists, where no cart in the channel can reserve it.
    expect(store.db.levels).toMatchObject([{ location: shed, stocked: 10 }])
    expect(store.buyerCanCheckOut()).toMatch(/required inventory/)

    const setup = await readSellingSetup()

    expect(setup.delivery.ready).toBe(true)
    expect(setup.listing).toMatchObject({
      buyable: null,
      needsStock: { id: product, title: "Wildflower Honey" },
    })
    expect(setup.ready).toBe(false)
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
        variants: [
          {
            title: "Default variant",
            manage_inventory: false,
            variant_rank: 0,
            prices: [{ currency_code: "usd", amount: 40 }],
          },
        ],
      })
    )
    const setup = await readSellingSetup()
    expect(setup.listing.buyable).toMatchObject({ title: "Coaching session" })
    expect(setup.ready).toBe(true)
    expect(store.buyerCanCheckOut()).toBe(true)
  })
})

describe("readSellingSetup, where buyers are and what they pay in", () => {
  /** Delivery the guided setup made, and a published, untracked product priced in USD. */
  const sellable = async () => {
    await setUpDelivery(both)
    await createProduct(
      honey({
        variants: [
          {
            title: "Default variant",
            manage_inventory: false,
            variant_rank: 0,
            prices: [{ currency_code: "usd", amount: 12 }],
          },
        ],
      })
    )
    expect((await readSellingSetup()).ready).toBe(true)
    expect(store.buyerCanCheckOut()).toBe(true)
  }

  it("is not ready when the only zones cover a country no region holds (measured: a Canadian zone, a US buyer)", async () => {
    await sellable()
    // What Settings, Locations lets a vendor make: zones for Canada only.
    for (const zone of store.db.zones) {
      zone.geo_zones = [{ type: "country", country_code: "ca" }]
    }
    expect(store.buyerCanCheckOut()).toBe("Seller shipping method not found!")

    const setup = await readSellingSetup()

    expect(setup.delivery.options).toEqual([])
    expect(setup.delivery.unoffered).toEqual([
      expect.objectContaining({ name: "Pickup at the barn", reason: "outside" }),
      expect.objectContaining({ name: "Flat delivery", reason: "outside" }),
    ])
    expect(setup.delivery.ready).toBe(false)
    expect(setup.ready).toBe(false)
  })

  it("is not ready when the options have no price in the region's currency (measured: EUR only, a USD region)", async () => {
    await sellable()
    for (const option of store.db.options) {
      option.prices = [{ currency_code: "eur", amount: 5, rules: [] }]
    }
    expect(store.buyerCanCheckOut()).toMatch(/^Shipping options with IDs .* do not have a price$/)

    const setup = await readSellingSetup()

    expect(setup.delivery.options).toEqual([])
    expect(setup.delivery.unoffered).toEqual([
      expect.objectContaining({ name: "Pickup at the barn", reason: "unpriced", currencies: ["USD"] }),
      expect.objectContaining({ name: "Flat delivery", reason: "unpriced", currencies: ["USD"] }),
    ])
    expect(setup.ready).toBe(false)
  })

  it("reads each price's rules: a price for another region does not count, one for this region does", async () => {
    await sellable()
    const [pickup, shipping] = store.db.options
    pickup.prices = [
      { currency_code: "usd", amount: 0, rules: [{ attribute: "region_id", value: "reg_elsewhere" }] },
    ]
    shipping.prices = [
      { currency_code: "usd", amount: 5, rules: [{ attribute: "region_id", value: "reg_us" }] },
    ]

    const setup = await readSellingSetup()

    expect(setup.delivery.options).toEqual([
      { id: shipping.id, name: "Flat delivery", kind: "shipping", regions: ["reg_us"] },
    ])
    expect(setup.delivery.unoffered).toEqual([
      expect.objectContaining({ id: pickup.id, reason: "elsewhere", onlyIn: ["another region"] }),
    ])
    expect(setup.ready).toBe(true)
    expect(store.buyerCanCheckOut()).toBe(true)
  })

  it("counts a product's price only in a region whose buyers are offered delivery", async () => {
    const germany = {
      id: "reg_eu",
      name: "Europe",
      currency_code: "eur",
      countries: [{ iso_2: "de", display_name: "Germany" }],
    }
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { regions: [US_REGION, germany] })
    // Delivery for US buyers only; the product priced only in euros.
    await setUpDelivery(both)
    await createProduct(
      honey({
        variants: [
          { title: "Default variant", manage_inventory: false, variant_rank: 0, prices: [{ currency_code: "eur", amount: 12 }] },
        ],
      })
    )
    // A US buyer cannot pay for it; a German one has no delivery.
    expect(store.buyerCanCheckOut("us")).toMatch(/do not have a price/)
    expect(store.buyerCanCheckOut("de")).toBe("Seller shipping method not found!")

    const setup = await readSellingSetup()

    expect(setup.delivery.ready).toBe(true)
    expect(setup.listing).toMatchObject({ buyable: null, currencies: ["USD"] })
    expect(setup.ready).toBe(false)
  })

  it("says when an option's price is limited to another region, rather than that it has none (measured: a US Territories price on a US zone)", async () => {
    const territories = {
      id: "reg_pr",
      name: "US Territories",
      currency_code: "usd",
      countries: [{ iso_2: "pr", display_name: "Puerto Rico" }],
    }
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { regions: [US_REGION, territories] })
    await sellable()
    for (const option of store.db.options) {
      option.prices = [
        { currency_code: "usd", amount: 5, rules: [{ attribute: "region_id", value: "reg_pr" }] },
      ]
    }
    expect(store.buyerCanCheckOut("us")).toMatch(/do not have a price/)

    const setup = await readSellingSetup()

    expect(setup.ready).toBe(false)
    const flat = setup.delivery.unoffered.find((o) => o.name === "Flat delivery")!
    expect(flat).toMatchObject({
      reason: "elsewhere",
      currencies: ["USD"],
      buyersIn: ["United States"],
      onlyIn: ["US Territories"],
    })
    expect(unofferedReason(flat)).toBe(
      "Flat delivery is priced only for buyers in US Territories, so buyers in United States, where it delivers, cannot choose it."
    )
    expect(unofferedReason(flat)).not.toContain("has no price")
  })

  it("says when an option's price holds only for some orders, and when it has none in the currency", async () => {
    await sellable()
    const [pickup, shipping] = store.db.options
    pickup.prices = [
      { currency_code: "usd", amount: 0, rules: [{ attribute: "item_total", value: "50" }] },
    ]
    shipping.prices = [{ currency_code: "eur", amount: 5, rules: [] }]

    const { delivery } = await readSellingSetup()

    const [conditional, unpriced] = delivery.unoffered
    expect(conditional).toMatchObject({ name: "Pickup at the barn", reason: "conditional" })
    expect(unofferedReason(conditional)).toBe(
      "Pickup at the barn is priced in USD only for some orders (a condition on the order total), so a buyer whose order does not meet it cannot choose it."
    )
    expect(unpriced).toMatchObject({ name: "Flat delivery", reason: "unpriced" })
    expect(unofferedReason(unpriced)).toBe(
      "Flat delivery has no price in USD, the currency buyers there pay in."
    )
  })

  it("does not count a published product with no price in the currency buyers pay in", async () => {
    await setUpDelivery(both)
    const euros = await createProduct(
      honey({
        title: "Euro Honey",
        variants: [
          {
            title: "Default variant",
            manage_inventory: false,
            variant_rank: 0,
            prices: [{ currency_code: "eur", amount: 12 }],
          },
        ],
      })
    )
    expect(store.buyerCanCheckOut()).toMatch(/^Variants with IDs .* do not have a price$/)

    const setup = await readSellingSetup()

    expect(setup.delivery.ready).toBe(true)
    expect(setup.listing).toMatchObject({
      buyable: null,
      needsPrice: { id: euros, title: "Euro Honey" },
      currencies: ["USD"],
    })
    expect(setup.ready).toBe(false)
  })
})

describe("setUpDelivery, for a store with nothing", () => {
  it("makes the scout's calls in order: location, sales-channel link, provider, fulfillment sets, service zones, a pickup and a flat-rate option, recalculation", async () => {
    const result = await setUpDelivery(both)

    expect(backend.calls()).toEqual([
      "GET /vendor/sales-channels",
      "GET /vendor/stock-locations",
      "GET /vendor/shipping-options",
      "GET /vendor/regions",
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

  it("prices the options in the currency of the region the location is in, and covers its country", async () => {
    const germany = {
      id: "reg_eu",
      name: "Europe",
      currency_code: "eur",
      countries: [{ iso_2: "de", display_name: "Germany" }],
    }
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { regions: [US_REGION, germany] })

    await setUpDelivery({ ...both, location: { ...barn, country_code: "DE" } })

    const options = posts().filter((s) => s.path === "/vendor/shipping-options")
    expect(options.map((s) => (s.body as { prices: unknown }).prices)).toEqual([
      [{ currency_code: "eur", amount: 0 }],
      [{ currency_code: "eur", amount: 5 }],
    ])
    const zones = posts().filter((s) => s.path.endsWith("/service-zones"))
    expect(zones.map((s) => (s.body as { geo_zones: unknown }).geo_zones)).toEqual([
      [{ type: "country", country_code: "de" }],
      [{ type: "country", country_code: "de" }],
    ])
    await createProduct(
      honey({
        variants: [
          { title: "Default variant", manage_inventory: false, variant_rank: 0, prices: [{ currency_code: "eur", amount: 12 }] },
        ],
      })
    )
    const setup = await readSellingSetup()
    expect(setup.delivery.options.map((o) => o.regions)).toEqual([["reg_eu"], ["reg_eu"]])
    expect(setup.ready).toBe(true)
    expect(store.buyerCanCheckOut("de")).toBe(true)
  })

  it("refuses a new place in a country no region holds, before writing anything", async () => {
    const error = await setUpDelivery({
      ...both,
      location: { ...barn, country_code: "CA" },
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SetupStepError)
    expect((error as SetupStepError).message).toBe(
      "Could not work out where you deliver: buyers on this marketplace are in United States, and that place is in CA: an option there would be offered to no one. Choose a place in one of those countries."
    )
    expect(posts()).toEqual([])
  })

  it("refuses to add options at an existing location outside every region, and says where to change it", async () => {
    // A location Settings, Locations made in Canada.
    await fetch("http://panel.test/vendor/stock-locations", {
      method: "POST",
      body: JSON.stringify({ name: "Toronto Shed", address: { address_1: "1 Queen St", country_code: "ca" } }),
    })
    backend.sent.length = 0

    const error = await setUpDelivery(both).catch((e: unknown) => e)

    expect((error as SetupStepError).message).toBe(
      "Could not work out where you deliver: buyers on this marketplace are in United States, and Toronto Shed is in CA: an option there would be offered to no one. Change its address in Settings, Locations."
    )
    expect(posts()).toEqual([])
    expect(store.db.sets).toEqual([])
  })

  it("refuses when the marketplace has no region at all", async () => {
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { regions: [] })

    await expect(setUpDelivery(both)).rejects.toThrow(
      "Could not work out where you deliver: this marketplace has no buyer regions yet, so no option would be offered to anyone. Contact support."
    )
    expect(posts()).toEqual([])
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

  it("records each quantity against the variant of that rank, whatever order the backend answers the variants in", async () => {
    // The product form's two variants, as the review measured (5 Small, 7 Large).
    const product = await createProduct(
      honey({
        title: "Wreath",
        options: [{ title: "Size", values: ["Small", "Large"] }],
        variants: [
          { title: "Small", manage_inventory: true, variant_rank: 0, prices: [{ currency_code: "usd", amount: 30 }] },
          { title: "Large", manage_inventory: true, variant_rank: 1, prices: [{ currency_code: "usd", amount: 40 }] },
        ],
      })
    )
    await setUpDelivery({ ...both, shipping: null })
    const location = store.db.locations[0].id
    // The detail answer does not list them by rank.
    const detail = await (await fetch(`http://panel.test/vendor/products/${product}`)).json()
    expect(detail.product.variants.map((v: { variant_rank: number }) => v.variant_rank)).toEqual([1, 0])

    await recordStock({
      productId: product,
      locationId: location,
      stock: [
        { variant_rank: 0, quantity: 5 },
        { variant_rank: 1, quantity: 7 },
      ],
    })

    const [small, large] = store.db.products[0].variants
    const stocked = (item: string | null) =>
      store.db.levels.find((level) => level.item === item)?.stocked
    expect([small.title, stocked(small.item)]).toEqual(["Small", 5])
    expect([large.title, stocked(large.item)]).toEqual(["Large", 7])
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

describe("publishFirstListing", () => {
  it("publishes the product, then records it as the store's first listing", async () => {
    const product = await createProduct(honey({ status: "draft" }))
    backend.sent.length = 0

    const result = await publishFirstListing(product)

    expect(posts().map((s) => [s.path, s.body])).toEqual([
      [`/vendor/products/${product}/status`, { status: "published" }],
      ["/vendor/onboarding/publish", { listing_id: product }],
    ])
    expect(result.product).toMatchObject({ id: product, status: "published" })
    expect(result.state).toMatchObject({ wizard_step: "published" })
  })

  it.each([
    // FBM's status route answers `{ product: products?.[0] }`: `{}` when the
    // product is not read back.
    ["no product", () => json(200, {})],
    ["the product still a draft", () => json(200, { product: { id: "x", status: "draft" } })],
    ["the product proposed for review", () => json(200, { product: { id: "x", status: "proposed" } })],
  ])("does not record a listing, or resolve, when the status answer shows %s", async (_, reply) => {
    const product = await createProduct(honey({ status: "draft" }))
    backend.sent.length = 0
    backend.on("POST", /^\/vendor\/products\/[^/]+\/status$/, reply)

    await expect(publishFirstListing(product)).rejects.toThrow(
      "The backend did not confirm that the product is published."
    )

    expect(posts().map((s) => s.path)).toEqual([`/vendor/products/${product}/status`])
    expect(store.db.onboarding.wizard_step).not.toBe("published")
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
