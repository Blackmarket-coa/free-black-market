import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { isValidElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { matchRoutes, type RouteObject } from "react-router-dom"
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
 * SD-151 (4): a store needs a stock location linked to its sales channel and
 * a shipping option before a buyer can check out, and nothing in the panel
 * said so. The guided setup takes a vendor who has neither to both from one
 * screen, with the vendor routes the MVP sweep called successfully.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)
const ui = await vi.hoisted(async () =>
  (await import("../../__tests__/ui-capture")).createUiCapture()
)
vi.mock("@medusajs/ui", async (importOriginal) =>
  ui.mock(await importOriginal<typeof import("@medusajs/ui")>())
)
vi.mock("../../lib/logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createBackend, json } from "../../__tests__/backend"
import { createFakeStore, US_REGION } from "../../__tests__/fake-store"
import { ProtectedRoute } from "../authentication/protected-route"
import { MainLayout } from "../layout/main-layout"
import { sellingSetupQueryKey } from "../../hooks/api/selling-setup"
import { setAuthToken } from "../../lib/client"
import { readSellingSetup } from "../../lib/selling-setup"
import { RouteMap } from "../../providers/router-provider/route-map"
import { DeliverySetup } from "../../routes/delivery-setup/delivery-setup"
import {
  DEFAULT_DELIVERY_ANSWERS,
  deliveryInputFrom,
  DeliverySetupForm,
  type DeliveryAnswers,
} from "./delivery-setup-form"

const backend = createBackend()
let store: ReturnType<typeof createFakeStore>
let client: QueryClient

/** What a vendor with nothing types: an address, pickup, and $5 shipping. */
const typed: DeliveryAnswers = {
  ...DEFAULT_DELIVERY_ANSWERS,
  locationName: "Bravo Barn",
  address1: "1 Farm Rd",
  city: "Atlanta",
  postalCode: "30301",
  countryCode: "us",
  offerPickup: true,
  pickupName: "Pickup at the barn",
  offerShipping: true,
  shippingName: "Flat delivery",
  shippingPrice: "5",
}

/** Read the store's setup as the screen does when it opens. */
const load = () =>
  client.fetchQuery({ queryKey: sellingSetupQueryKey, queryFn: readSellingSetup })
const render = (props: Parameters<typeof DeliverySetupForm>[0] = {}) => {
  ui.buttons.length = 0
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DeliverySetupForm {...props} />
    </QueryClientProvider>
  )
}
const posts = () => backend.sent.filter((s) => s.method === "POST")
const settled = () =>
  vi.waitFor(() => expect(client.isMutating()).toBe(0))

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  backend.reset()
  ui.reset()
  vi.stubGlobal("fetch", backend.fetch)
  store = createFakeStore(backend)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("the guided delivery setup", () => {
  it("tells a vendor with nothing that buyers cannot check out, and does not say delivery is set up", async () => {
    await load()

    const html = render({ initial: typed })

    expect(html).toContain(
      "Buyers cannot check out yet: your store has no stock location and no pickup or shipping option."
    )
    expect(html).not.toContain("Delivery is set up")
    expect(ui.has("Save delivery")).toBe(true)
  })

  it("takes a vendor with neither a location nor an option to both from this one screen", async () => {
    await load()
    render({ initial: typed })
    backend.sent.length = 0

    ui.press(ui.button("Save delivery"))
    await settled()

    expect(posts().map((s) => s.path)).toEqual([
      "/vendor/stock-locations",
      "/vendor/stock-locations/sloc_1/sales-channels",
      "/vendor/stock-locations/sloc_1/fulfillment-providers",
      "/vendor/stock-locations/sloc_1/fulfillment-sets",
      "/vendor/fulfillment-sets/fuset_2/service-zones",
      "/vendor/shipping-options",
      "/vendor/stock-locations/sloc_1/fulfillment-sets",
      "/vendor/fulfillment-sets/fuset_5/service-zones",
      "/vendor/shipping-options",
      "/vendor/sellers/me/onboarding",
    ])
    expect(posts()[0].body).toEqual({
      name: "Bravo Barn",
      address: {
        address_1: "1 Farm Rd",
        city: "Atlanta",
        country_code: "us",
        postal_code: "30301",
      },
    })
    expect(posts()[1].body).toEqual({ add: ["sc_1"] })
    expect(
      posts()
        .filter((s) => s.path === "/vendor/shipping-options")
        .map((s) => s.body)
    ).toMatchObject([
      {
        name: "Pickup at the barn",
        provider_id: "manual_manual",
        prices: [{ currency_code: "usd", amount: 0 }],
        type: { code: "pickup" },
      },
      {
        name: "Flat delivery",
        provider_id: "manual_manual",
        // $5.00 typed as "5" is sent as 5: major units.
        prices: [{ currency_code: "usd", amount: 5 }],
        type: { code: "shipping" },
      },
    ])
    expect(
      backend.sent.every(
        (s) => s.headers.get("authorization") === "Bearer tok-seller"
      )
    ).toBe(true)

    // The screen reads the store again and only then says it is set up.
    await load()
    const html = render()
    expect(html).toContain("Delivery is set up. Stock is held at Bravo Barn")
    expect(html).toContain("Pickup at the barn, Flat delivery")
    expect(ui.toast.success).toHaveBeenCalledTimes(1)
  })

  it("sets up pickup alone when that is all the vendor ticks", async () => {
    await load()
    render({ initial: { ...typed, offerShipping: false } })

    ui.press(ui.button("Save delivery"))
    await settled()

    expect(store.db.options.map((o) => o.name)).toEqual(["Pickup at the barn"])
    expect((await load()).delivery.ready).toBe(true)
  })

  it("sends nothing until the vendor has said where the goods are and ticked pickup or shipping", async () => {
    await load()
    backend.sent.length = 0

    render()
    ui.press(ui.button("Save delivery"))
    render({ initial: { ...typed, offerPickup: false, offerShipping: false } })
    ui.press(ui.button("Save delivery"))
    render({ initial: { ...typed, shippingPrice: "" } })
    ui.press(ui.button("Save delivery"))
    await settled()

    expect(backend.sent).toEqual([])
    expect(ui.toast.error.mock.calls.map(([message]) => message)).toEqual([
      "Give the place you keep your goods a name.",
      "Tick pickup, shipping, or both: a buyer has to choose one at checkout.",
      "Enter what you charge for shipping, in USD. Enter 0 to ship free.",
    ])
  })

  it("offers only the countries buyers are in, and asks the flat rate in their region's currency", async () => {
    const europe = {
      id: "reg_eu",
      name: "Europe",
      currency_code: "eur",
      countries: [
        { iso_2: "de", display_name: "Germany" },
        { iso_2: "fr", display_name: "France" },
      ],
    }
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { regions: [europe] })
    await load()

    // The vendor's default country, the United States, is not one of them.
    const html = render({ initial: { ...typed } })

    const offered = [...html.matchAll(/<option value="([a-z]{2})"/g)].map((m) => m[1])
    expect(offered.sort()).toEqual(["de", "fr"])
    expect(html).toContain("Price per order (EUR)")
    expect(html).not.toContain("(USD)")

    ui.press(ui.button("Save delivery"))
    await settled()

    // The first of their countries until the vendor chooses, priced in euros.
    expect(store.db.locations[0].address).toMatchObject({ country_code: "de" })
    expect(store.db.options.map((o) => o.prices)).toEqual([
      [{ currency_code: "eur", amount: 0, rules: [] }],
      [{ currency_code: "eur", amount: 5, rules: [] }],
    ])
  })

  it("refuses a country no region holds, and sends nothing", () => {
    expect(
      deliveryInputFrom(
        { ...typed, countryCode: "ca" },
        { location: null, options: [], regions: [US_REGION] }
      )
    ).toEqual({
      problem: "Choose a country buyers on this marketplace are in: United States.",
    })
    expect(
      deliveryInputFrom(typed, { location: null, options: [], regions: [US_REGION] })
    ).toHaveProperty("input")
  })

  it("says when the store's location is in a country where the marketplace has no buyers", async () => {
    await fetch("http://panel.test/vendor/stock-locations", {
      method: "POST",
      body: JSON.stringify({ name: "Toronto Shed", address: { address_1: "1 Queen St", country_code: "ca" } }),
    })
    await load()

    const html = render({ initial: typed })

    expect(html).toContain("Toronto Shed is in")
    expect(html).toContain("CA")
    expect(html).toContain("where this marketplace has no buyers: it sells to")
    expect(html).toContain("United States")
  })

  it("says why an option the store has is offered to no buyer", async () => {
    await load()
    render({ initial: typed })
    ui.press(ui.button("Save delivery"))
    await settled()
    for (const option of store.db.options) {
      option.prices = [{ currency_code: "eur", amount: 5, rules: [] }]
    }
    await load()

    const html = render({ initial: typed })

    expect(html).not.toContain("Delivery is set up")
    expect(html).toContain("no buyer is offered your pickup or shipping")
    expect(html).toContain(
      "Flat delivery has no price in USD, the currency buyers there pay in."
    )
  })

  it("ticks neither pickup nor shipping for the vendor", () => {
    expect(DEFAULT_DELIVERY_ANSWERS.offerPickup).toBe(false)
    expect(DEFAULT_DELIVERY_ANSWERS.offerShipping).toBe(false)
    expect(
      deliveryInputFrom(
        { ...typed, offerPickup: false, offerShipping: false },
        { location: null, options: [], regions: [US_REGION] }
      )
    ).toHaveProperty("problem")
  })

  it("sends one setup for a double click, and disables the button while it runs", async () => {
    await load()
    const release = backend.hold("POST", "/vendor/stock-locations")
    render({ initial: typed })
    const save = ui.button("Save delivery")
    backend.sent.length = 0

    ui.press(save)
    // The second click lands on the same, not yet re-rendered, button.
    ui.press(save)
    await vi.waitFor(() =>
      expect(posts().map((s) => s.path)).toEqual(["/vendor/stock-locations"])
    )

    // Re-rendered while the setup runs: disabled, with its spinner.
    render({ initial: typed })
    expect(ui.button("Save delivery")).toMatchObject({
      disabled: true,
      isLoading: true,
    })
    ui.press(ui.button("Save delivery"))

    release()
    await settled()
    expect(
      posts().filter((s) => s.path === "/vendor/stock-locations")
    ).toHaveLength(1)
    expect(store.db.locations).toHaveLength(1)
    expect(store.db.options).toHaveLength(2)
  })

  it("says nothing is saved before the backend has answered, and calls onDone only after", async () => {
    await load()
    const release = backend.hold("POST", "/vendor/shipping-options")
    const onDone = vi.fn()
    render({ initial: typed, onDone })

    ui.press(ui.button("Save delivery"))
    await vi.waitFor(() =>
      expect(posts().some((s) => s.path === "/vendor/shipping-options")).toBe(true)
    )
    expect(onDone).not.toHaveBeenCalled()
    expect(ui.toast.success).not.toHaveBeenCalled()

    release()
    await settled()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0]).toMatchObject({
      location: { name: "Bravo Barn", created: true },
      options: [{ kind: "pickup" }, { kind: "shipping" }],
    })
    expect(ui.toast.success).toHaveBeenCalledTimes(1)
  })

  it("shows the step the backend refused in its own words, and claims nothing", async () => {
    await load()
    backend.on("POST", "/vendor/shipping-options", () =>
      json(400, {
        type: "invalid_data",
        message: "Providers (manual_manual) are not enabled for the service location",
      })
    )
    const onDone = vi.fn()
    render({ initial: typed, onDone })

    ui.press(ui.button("Save delivery"))
    await settled()

    expect(ui.toast.error).toHaveBeenCalledWith("Delivery was not fully set up", {
      description:
        "Could not create the pickup option: Providers (manual_manual) are not enabled for the service location",
    })
    expect(ui.toast.success).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    // Read back: a linked location, no option, so still not set up.
    await load()
    const html = render({ initial: typed })
    expect(html).toContain(
      "Buyers cannot check out yet: Bravo Barn has no pickup or shipping option."
    )
    expect(html).not.toContain("Delivery is set up")
  })

  it("does not ask a vendor who has a stock location for an address, and links that location", async () => {
    // A location made in Settings, Locations whose sales-channel link is gone.
    store.db.locations.push({
      id: "sloc_home",
      name: "Home",
      address: { address_1: "2 Main St", city: "Macon", country_code: "us" },
      channels: [],
      providers: [],
    })
    await load()

    const html = render({
      initial: { ...DEFAULT_DELIVERY_ANSWERS, offerPickup: true },
    })
    expect(html).toContain(
      "Buyers cannot add your products to a cart yet: Home is not linked to your sales channel."
    )
    expect(html).not.toContain("Street address")

    ui.press(ui.button("Save delivery"))
    await settled()

    expect(store.db.locations).toHaveLength(1)
    expect(store.db.locations[0].channels).toEqual(["sc_1"])
    expect(store.db.options.map((o) => o.name)).toEqual(["Pickup"])
  })
})

describe("/delivery-setup", () => {
  it("is served by the guided setup page, inside the signed-in layout", async () => {
    const matches = matchRoutes(RouteMap as RouteObject[], "/delivery-setup") ?? []
    const route = matches.at(-1)?.route
    expect(route?.path).toBe("delivery-setup")

    const loaded = (await route?.lazy?.()) as { Component?: unknown } | undefined
    expect(loaded?.Component).toBe(DeliverySetup)
    const elements = matches.map((m) => m.route.element).filter(isValidElement)
    expect(elements.map((element) => element.type)).toEqual(
      expect.arrayContaining([ProtectedRoute, MainLayout])
    )
  })
})
