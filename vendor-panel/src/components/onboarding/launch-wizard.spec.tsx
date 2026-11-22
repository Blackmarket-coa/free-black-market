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
 * SD-151 (4), measured: after the default wizard's "Your first listing" step
 * the store had no product; its delivery step said "We'll set up a default
 * manual shipping option" and nothing did; and its publish step, given
 * `prod_does_not_exist`, answered 200 `published` and said "You're live!".
 *
 * Each step now does what it says: the listing step creates a draft product
 * through the hook the product form uses, the delivery step runs the guided
 * setup, the publish step publishes the product the wizard made, and "You're
 * live!" is said only when a buyer could check out.
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
import { setAuthToken } from "../../lib/client"
import { readSellingSetup, setUpDelivery } from "../../lib/selling-setup"
import { LaunchWizard, SELLING_TYPE_DEFAULTS } from "./launch-wizard"
import {
  DeliveryStep,
  ListingStep,
  PublishedScreen,
  PublishStep,
  readWizardProduct,
  writeWizardProduct,
  type ListingAnswers,
  type WizardProduct,
} from "./launch-wizard-steps"

const backend = createBackend()
let store: ReturnType<typeof createFakeStore>
let client: QueryClient

const honey: Partial<ListingAnswers> = {
  title: "Wildflower Honey",
  price: "12",
  description: "Raw, from our own hives.",
  sku: "HONEY-1",
  trackStock: true,
  quantity: "10",
}
const barn = {
  name: "Bravo Barn",
  address_1: "1 Farm Rd",
  city: "Atlanta",
  postal_code: "30301",
  country_code: "us",
}

const render = (element: ReactElement) => {
  ui.buttons.length = 0
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>
  )
}
/**
 * Render a screen as the vendor sees it once its reads have answered: every
 * read it registers is run, as its mounted queries would run them, and it is
 * rendered again, until a render registers nothing new (a step's own reads
 * appear only once the wizard knows which step it is on).
 */
const show = async (element: ReactElement) => {
  let html = render(element)
  const queries = () => client.getQueryCache().getAll()
  await Promise.all(queries().map((q) => q.fetch().catch(() => undefined)))
  for (let round = 0; round < 5; round++) {
    html = render(element)
    const unread = queries().filter((q) => q.state.status === "pending")
    if (unread.length === 0) break
    await Promise.all(unread.map((q) => q.fetch().catch(() => undefined)))
  }
  backend.sent.length = 0
  return html
}
const settled = () => vi.waitFor(() => expect(client.isMutating()).toBe(0))
const writes = () =>
  backend.sent
    .filter((s) => s.method !== "GET")
    .map((s) => `${s.method} ${s.path}`)

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  backend.reset()
  ui.reset()
  vi.stubGlobal("fetch", backend.fetch)
  store = createFakeStore(backend)
  // `retryOnMount: false`: a static render mounts a new observer each time,
  // which for a read that failed would report "loading, about to retry"; the
  // mounted screen is handed the failure.
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

describe("the listing step", () => {
  const step = (props: Partial<Parameters<typeof ListingStep>[0]> = {}) => (
    <ListingStep
      sellingType="physical"
      existing={null}
      initial={honey}
      onCreated={vi.fn()}
      onContinue={vi.fn()}
      onStartOver={vi.fn()}
      onBack={vi.fn()}
      {...props}
    />
  )

  it("creates a draft product from what was typed: POST /vendor/seller-products, price in major units", async () => {
    const onCreated = vi.fn()
    await show(step({ onCreated }))

    ui.press(ui.button("Save draft and continue"))
    await settled()

    expect(writes()).toEqual(["POST /vendor/seller-products"])
    const sent = backend.sent.find((s) => s.method === "POST")!
    expect(sent.headers.get("authorization")).toBe("Bearer tok-seller")
    expect(sent.body).toMatchObject({
      title: "Wildflower Honey",
      // Product handles are unique marketplace-wide: this one is the store's.
      handle: "wildflower-honey-bravo-pantry",
      description: "Raw, from our own hives.",
      status: "draft",
      sales_channels: [{ id: "sc_1", name: "Default Sales Channel" }],
      options: [{ title: "Default option", values: ["Default option value"] }],
    })
    expect((sent.body as { variants: unknown[] }).variants).toEqual([
      {
        title: "Default variant",
        sku: "HONEY-1",
        manage_inventory: true,
        allow_backorder: false,
        variant_rank: 0,
        options: { "Default option": "Default option value" },
        // $12.00 typed as "12" is sent as 12, not 1200.
        prices: [{ currency_code: "usd", amount: 12 }],
      },
    ])

    // The store has the product, a draft, as the vendor's.
    expect(store.db.products).toHaveLength(1)
    expect(store.db.products[0]).toMatchObject({
      title: "Wildflower Honey",
      status: "draft",
    })
    // No stock location yet: the quantity is carried to the delivery step.
    expect(onCreated).toHaveBeenCalledWith({
      id: store.db.products[0].id,
      title: "Wildflower Honey",
      pendingStock: 10,
    })
  })

  it("prices the listing in the currency of the region the store's location is in", async () => {
    const europe = {
      id: "reg_eu",
      name: "Europe",
      currency_code: "eur",
      countries: [{ iso_2: "de", display_name: "Germany" }],
    }
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { regions: [US_REGION, europe] })
    await setUpDelivery({
      location: { ...barn, country_code: "de" },
      pickup: { name: "Abholung" },
      shipping: null,
    })
    const html = await show(step({ initial: { ...honey, trackStock: false, quantity: "" } }))
    expect(html).toContain("Price (EUR)")

    ui.press(ui.button("Save draft and continue"))
    await settled()

    const sent = backend.sent.find((s) => s.path === "/vendor/seller-products")!
    expect((sent.body as { variants: Array<{ prices: unknown }> }).variants[0].prices).toEqual([
      { currency_code: "eur", amount: 12 },
    ])
    // Published, a buyer in Germany could buy it.
    store.db.products[0].status = "published"
    expect(store.buyerCanCheckOut("de")).toBe(true)
  })

  it("before there is a location, prices the listing in the first region's currency", async () => {
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, {
      regions: [{ id: "reg_ca", name: "Canada", currency_code: "cad", countries: [{ iso_2: "ca", display_name: "Canada" }] }],
    })
    const html = await show(step())
    expect(html).toContain("Price (CAD)")

    ui.press(ui.button("Save draft and continue"))
    await settled()

    const sent = backend.sent.find((s) => s.path === "/vendor/seller-products")!
    expect((sent.body as { variants: Array<{ prices: unknown }> }).variants[0].prices).toEqual([
      { currency_code: "cad", amount: 12 },
    ])
  })

  it("records the quantity at once when the store already has a stock location", async () => {
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    const onCreated = vi.fn()
    const html = await show(step({ onCreated }))
    expect(html).toContain("Held at Bravo Barn.")

    ui.press(ui.button("Save draft and continue"))
    await settled()

    expect(writes()).toEqual([
      "POST /vendor/seller-products",
      "POST /vendor/inventory-items/location-levels/batch",
    ])
    expect(store.db.levels).toMatchObject([
      { location: store.db.locations[0].id, stocked: 10 },
    ])
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ pendingStock: null })
    )
  })

  it("uploads the photo first and lists the product with it", async () => {
    const photo = new File(["jpeg"], "honey.jpg", { type: "image/jpeg" })
    await show(step({ initialPhoto: photo }))

    ui.press(ui.button("Save draft and continue"))
    await settled()

    expect(writes()).toEqual([
      "POST /vendor/uploads",
      "POST /vendor/seller-products",
    ])
    const upload = backend.sent.find((s) => s.path === "/vendor/uploads")!
    expect((upload.body as FormData).getAll("files")).toEqual([photo])
    expect(store.db.products[0].thumbnail).toBe(
      "https://files.fbm.test/0-honey.jpg"
    )
  })

  it("sends an untracked variant when the vendor chose not to track stock, and asks for no quantity", async () => {
    const onCreated = vi.fn()
    await show(step({ initial: { ...honey, trackStock: false, quantity: "" }, onCreated }))

    ui.press(ui.button("Save draft and continue"))
    await settled()

    expect(store.db.products[0].variants[0].manage_inventory).toBe(false)
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ pendingStock: null })
    )
  })

  it("sends nothing without a title, a price, or an answer about stock", async () => {
    const onCreated = vi.fn()
    for (const initial of [
      { ...honey, title: " " },
      { ...honey, price: "" },
      { ...honey, quantity: "" },
      { ...honey, quantity: "0" },
    ]) {
      await show(step({ initial, onCreated }))
      ui.press(ui.button("Save draft and continue"))
      await settled()
    }

    expect(writes()).toEqual([])
    expect(onCreated).not.toHaveBeenCalled()
    expect(ui.toast.error.mock.calls.map(([message]) => message)).toEqual([
      "Give your listing a title.",
      "Enter a price in USD. Enter 0 for something free.",
      "Enter how many you have (1 or more), or choose not to track stock.",
      "Enter how many you have (1 or more), or choose not to track stock.",
    ])
  })

  it("creates one product for a double click, and disables the button while it saves", async () => {
    const release = backend.hold("POST", "/vendor/seller-products")
    await show(step())
    const save = ui.button("Save draft and continue")

    ui.press(save)
    ui.press(save)
    await vi.waitFor(() => expect(store.db.products).toHaveLength(1))
    render(step())
    expect(ui.button("Save draft and continue")).toMatchObject({
      disabled: true,
      isLoading: true,
    })
    ui.press(ui.button("Save draft and continue"))

    release()
    await settled()
    expect(store.db.products).toHaveLength(1)
    expect(writes()).toEqual(["POST /vendor/seller-products"])
  })

  it("lists a title another store already used (measured: a second \"Pat's Pickles\" was refused)", async () => {
    backend.reset()
    vi.stubGlobal("fetch", backend.fetch)
    store = createFakeStore(backend, { takenHandles: ["pats-pickles"] })
    const onCreated = vi.fn()
    await show(step({ initial: { ...honey, title: "Pat's Pickles" }, onCreated }))

    ui.press(ui.button("Save draft and continue"))
    await settled()

    expect(ui.toast.error).not.toHaveBeenCalled()
    expect(store.db.products.map((p) => p.handle)).toEqual(["pats-pickles-bravo-pantry"])
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: store.db.products[0].id, title: "Pat's Pickles" })
    )
  })

  it("after a lost answer, goes on with the draft the request made instead of reporting a failure", async () => {
    store.loseNextAnswer("POST", "/vendor/seller-products")
    const onCreated = vi.fn()
    await show(step({ onCreated }))

    ui.press(ui.button("Save draft and continue"))
    await settled()

    expect(writes()).toEqual(["POST /vendor/seller-products"])
    expect(store.db.products).toHaveLength(1)
    expect(ui.toast.error).not.toHaveBeenCalled()
    expect(ui.toast.success).toHaveBeenCalledWith("Wildflower Honey is saved as a draft")
    expect(onCreated).toHaveBeenCalledWith({
      id: store.db.products[0].id,
      title: "Wildflower Honey",
      pendingStock: 10,
    })
  })

  it("shows the backend's refusal in its own words, and reports no product", async () => {
    const refusal =
      'Listing type "physical_product" is not allowed on the Service playbook. Allowed types: event, digital, recurring, bookable. Switch playbooks (vendor settings → playbook) if your offering shape no longer fits.'
    backend.on("POST", "/vendor/seller-products", () =>
      json(400, { type: "invalid_data", message: refusal })
    )
    const onCreated = vi.fn()
    await show(step({ onCreated }))

    ui.press(ui.button("Save draft and continue"))
    await settled()

    expect(ui.toast.error).toHaveBeenCalledWith("The listing was not created", {
      description: refusal,
    })
    expect(ui.toast.success).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it("does not make a second product when the vendor comes back to the step", async () => {
    const onContinue = vi.fn()
    const html = await show(
      step({ existing: { id: "prod_1", title: "Wildflower Honey" }, onContinue })
    )

    expect(html).toContain("Wildflower Honey is saved as a draft.")
    expect(ui.has("Save draft and continue")).toBe(false)
    ui.press(ui.button("Continue"))
    await settled()

    expect(writes()).toEqual([])
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})

describe("the delivery step", () => {
  const product: WizardProduct = { id: "", title: "Wildflower Honey", pendingStock: 10 }
  const makeDraft = async () => {
    const response = await fetch("http://panel.test/vendor/seller-products", {
      method: "POST",
      body: JSON.stringify({
        title: "Wildflower Honey",
        status: "draft",
        variants: [{ title: "Default variant", manage_inventory: true, variant_rank: 0, prices: [{ currency_code: "usd", amount: 12 }] }],
      }),
    })
    return (await response.json()).product.id as string
  }

  it("is the guided setup, and cannot be passed until a buyer has a delivery choice", async () => {
    const onContinue = vi.fn()
    const html = await show(
      <DeliveryStep
        sellingType="physical"
        product={null}
        onStockRecorded={vi.fn()}
        onContinue={onContinue}
        onBack={vi.fn()}
      />
    )

    // The guided setup's own form and button.
    expect(ui.has("Save delivery")).toBe(true)
    expect(html).toContain("Save pickup or shipping above to continue.")
    expect(ui.button("Continue")).toMatchObject({ disabled: true })
    ui.press(ui.button("Continue"))
    // And a click that reaches the handler all the same goes nowhere.
    await ui.button("Continue").onClick?.()
    await settled()
    expect(onContinue).not.toHaveBeenCalled()
  })

  it("once delivery is set up, records the quantity from the listing step at the stock location, then continues", async () => {
    const id = await makeDraft()
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    const onContinue = vi.fn()
    const onStockRecorded = vi.fn()
    await show(
      <DeliveryStep
        sellingType="physical"
        product={{ ...product, id }}
        onStockRecorded={onStockRecorded}
        onContinue={onContinue}
        onBack={vi.fn()}
      />
    )

    ui.press(ui.button("Continue"))
    await settled()

    expect(writes()).toEqual([
      "POST /vendor/inventory-items/location-levels/batch",
    ])
    expect(backend.sent.at(-1)?.body).toEqual({
      create: [
        {
          inventory_item_id: store.db.products[0].variants[0].item,
          location_id: store.db.locations[0].id,
          stocked_quantity: 10,
        },
      ],
      update: [],
      delete: [],
    })
    expect(onStockRecorded).toHaveBeenCalledWith({
      id,
      title: "Wildflower Honey",
      pendingStock: null,
    })
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it("records the stock once and continues once for a double click", async () => {
    const id = await makeDraft()
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    const release = backend.hold(
      "POST",
      "/vendor/inventory-items/location-levels/batch"
    )
    const onContinue = vi.fn()
    const step = (
      <DeliveryStep
        sellingType="physical"
        product={{ ...product, id }}
        onStockRecorded={vi.fn()}
        onContinue={onContinue}
        onBack={vi.fn()}
      />
    )
    await show(step)
    const next = ui.button("Continue")

    ui.press(next)
    ui.press(next)
    await vi.waitFor(() => expect(writes()).toHaveLength(1))
    render(step)
    expect(ui.button("Continue")).toMatchObject({ disabled: true, isLoading: true })

    release()
    await settled()
    expect(writes()).toEqual([
      "POST /vendor/inventory-items/location-levels/batch",
    ])
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it("does not continue when the stock could not be recorded", async () => {
    const id = await makeDraft()
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    backend.on("POST", "/vendor/inventory-items/location-levels/batch", () =>
      json(500, { message: "An unknown error occurred." })
    )
    const onContinue = vi.fn()
    await show(
      <DeliveryStep
        sellingType="physical"
        product={{ ...product, id }}
        onStockRecorded={vi.fn()}
        onContinue={onContinue}
        onBack={vi.fn()}
      />
    )

    ui.press(ui.button("Continue"))
    await settled()

    expect(onContinue).not.toHaveBeenCalled()
    expect(ui.toast.error).toHaveBeenCalledWith("Your stock was not recorded", {
      description: "An unknown error occurred.",
    })
  })

  it("promises nothing the wizard does not do, for any selling type", () => {
    const copy = [
      ...Object.values(SELLING_TYPE_DEFAULTS).flatMap((entry) => [
        entry.delivery_label,
        entry.delivery_hint,
      ]),
      readFileSync(join(__dirname, "launch-wizard.tsx"), "utf8"),
      readFileSync(join(__dirname, "launch-wizard-steps.tsx"), "utf8"),
    ].join("\n")

    for (const promise of [
      "We'll set up a default manual shipping option",
      "receive a download link immediately",
      "receive a contact link to schedule",
      "We'll generate a ticket or access pass",
      "Paste an existing draft listing",
    ]) {
      expect(copy).not.toContain(promise)
    }
  })
})

describe("the publish step", () => {
  /** A store whose wizard made a draft and set up pickup. */
  const ready = async () => {
    const response = await fetch("http://panel.test/vendor/seller-products", {
      method: "POST",
      body: JSON.stringify({
        title: "Wildflower Honey",
        status: "draft",
        variants: [{ title: "Default variant", manage_inventory: false, variant_rank: 0, prices: [{ currency_code: "usd", amount: 12 }] }],
      }),
    })
    const id = (await response.json()).product.id as string
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    return { id, title: "Wildflower Honey" }
  }
  const step = (props: Partial<Parameters<typeof PublishStep>[0]>) => (
    <PublishStep
      product={null}
      onPublished={vi.fn()}
      onMakeListing={vi.fn()}
      onForget={vi.fn()}
      onBack={vi.fn()}
      {...props}
    />
  )

  it("publishes the product the wizard made, then records it: no id is typed", async () => {
    const product = await ready()
    const onPublished = vi.fn()
    const html = await show(step({ product, onPublished }))

    expect(html).not.toContain("Listing ID")
    expect(html).not.toContain("prod_...")
    ui.press(ui.button("Publish Wildflower Honey"))
    await settled()

    expect(writes()).toEqual([
      `POST /vendor/products/${product.id}/status`,
      "POST /vendor/onboarding/publish",
    ])
    expect(
      backend.sent.filter((s) => s.method === "POST").map((s) => s.body)
    ).toEqual([{ status: "published" }, { listing_id: product.id }])
    expect(store.db.products[0].status).toBe("published")
    expect(onPublished).toHaveBeenCalledWith(
      expect.objectContaining({
        wizard_step: "published",
        first_published_listing_id: product.id,
      }),
      expect.objectContaining({ id: product.id, status: "published" })
    )
    expect(ui.toast.success).toHaveBeenCalledWith("Wildflower Honey is published")
  })

  it("reports nothing published when the backend refuses the product", async () => {
    await ready()
    const onPublished = vi.fn()
    await show(
      step({ product: { id: "prod_does_not_exist", title: "Ghost" }, onPublished })
    )

    ui.press(ui.button("Publish Ghost"))
    await settled()

    expect(writes()).toEqual(["POST /vendor/products/prod_does_not_exist/status"])
    expect(onPublished).not.toHaveBeenCalled()
    expect(ui.toast.success).not.toHaveBeenCalled()
    // Mercur's ownership check, in its words (measured).
    expect(ui.toast.error).toHaveBeenCalledWith("The listing was not published", {
      description: "You are not allowed to perform this action",
    })
    expect(store.db.onboarding.wizard_step).not.toBe("published")
  })

  it("does not say published when the product is published but not recorded", async () => {
    const product = await ready()
    backend.on("POST", "/vendor/onboarding/publish", () =>
      json(400, {
        type: "invalid_data",
        message: "listing_id must be the id of a product in your store.",
      })
    )
    const onPublished = vi.fn()
    await show(step({ product, onPublished }))

    ui.press(ui.button("Publish Wildflower Honey"))
    await settled()

    expect(onPublished).not.toHaveBeenCalled()
    expect(ui.toast.error).toHaveBeenCalledWith("The listing was not published", {
      description: "listing_id must be the id of a product in your store.",
    })
  })

  it("does not say published when the backend answers without a published state", async () => {
    const product = await ready()
    backend.on("POST", "/vendor/onboarding/publish", () =>
      json(200, { state: { ...store.db.onboarding, wizard_step: "step_4" } })
    )
    const onPublished = vi.fn()
    await show(step({ product, onPublished }))

    ui.press(ui.button("Publish Wildflower Honey"))
    await settled()

    expect(onPublished).not.toHaveBeenCalled()
    expect(ui.toast.success).not.toHaveBeenCalled()
    expect(ui.toast.error).toHaveBeenCalledWith("The listing was not published", {
      description:
        "The product is published, but the backend did not record it as your first listing.",
    })
  })

  it("offers the store's own products when this browser does not remember the wizard's", async () => {
    const product = await ready()
    const onPublished = vi.fn()
    await show(step({ onPublished }))

    // One product in the store: it is the one.
    ui.press(ui.button("Publish Wildflower Honey"))
    await settled()

    expect(writes()).toEqual([
      `POST /vendor/products/${product.id}/status`,
      "POST /vendor/onboarding/publish",
    ])
    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it("sends the vendor to make a listing when the store has no product", async () => {
    const onMakeListing = vi.fn()
    const html = await show(step({ onMakeListing }))

    expect(html).toContain("Your store has no product to publish yet.")
    ui.press(ui.button("Make your first listing"))
    expect(onMakeListing).toHaveBeenCalledTimes(1)
    expect(writes()).toEqual([])
  })

  it("does not publish while a buyer could not check out", async () => {
    const { id } = await ready()
    store.db.options.length = 0
    const html = await show(step({ product: { id, title: "Wildflower Honey" } }))

    expect(html).toContain("Buyers could not check out yet")
    expect(ui.button("Publish Wildflower Honey")).toMatchObject({ disabled: true })
    ui.press(ui.button("Publish Wildflower Honey"))
    // And a click that reaches the handler all the same publishes nothing.
    await ui.button("Publish Wildflower Honey").onClick?.()
    await settled()
    expect(writes()).toEqual([])
    expect(store.db.products[0].status).toBe("draft")
  })

  it("publishes once for a double click", async () => {
    const product = await ready()
    const release = backend.hold("POST", `/vendor/products/${product.id}/status`)
    await show(step({ product }))
    const publish = ui.button("Publish Wildflower Honey")

    ui.press(publish)
    ui.press(publish)
    await vi.waitFor(() => expect(writes()).toHaveLength(1))
    render(step({ product }))
    expect(ui.button("Publish Wildflower Honey")).toMatchObject({
      disabled: true,
      isLoading: true,
    })

    release()
    await settled()
    expect(writes()).toEqual([
      `POST /vendor/products/${product.id}/status`,
      "POST /vendor/onboarding/publish",
    ])
  })
})

describe('"You\'re live!"', () => {
  it("is said when a buyer could check out", async () => {
    await fetch("http://panel.test/vendor/seller-products", {
      method: "POST",
      body: JSON.stringify({
        title: "Wildflower Honey",
        status: "published",
        variants: [{ title: "Default variant", manage_inventory: false, variant_rank: 0, prices: [{ currency_code: "usd", amount: 12 }] }],
      }),
    })
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    expect(store.buyerCanCheckOut()).toBe(true)

    const html = await show(<PublishedScreen />)

    expect(html).toContain("You&#x27;re live!")
    expect(html).toContain("Wildflower Honey is published")
  })

  it("is not said for a published product with no stock location and no shipping option: the screen says what stops a buyer", async () => {
    // What the old wizard left: a product, published, and nothing else.
    const response = await fetch("http://panel.test/vendor/seller-products", {
      method: "POST",
      body: JSON.stringify({
        title: "Wildflower Honey",
        status: "published",
        variants: [{ title: "Default variant", manage_inventory: true, variant_rank: 0, prices: [{ currency_code: "usd", amount: 12 }] }],
      }),
    })
    const id = (await response.json()).product.id
    expect(store.buyerCanCheckOut()).not.toBe(true)

    const html = await show(<PublishedScreen />)

    expect(html).not.toContain("live!")
    expect(html).toContain("Your listing is published")
    expect(html).toContain("Buyers cannot buy it yet.")
    expect(html).toContain(
      "Your store has no stock location and no pickup or shipping option."
    )
    expect(html).toContain('href="/delivery-setup"')
    expect(html).toContain("Wildflower Honey tracks stock and has none.")
    expect(html).toContain(`href="/products/${id}/stock"`)
  })

  it("is not said for a product with no price in the currency buyers pay in: the screen says so and where to set it", async () => {
    const response = await fetch("http://panel.test/vendor/seller-products", {
      method: "POST",
      body: JSON.stringify({
        title: "Wildflower Honey",
        status: "published",
        variants: [{ title: "Default variant", manage_inventory: false, variant_rank: 0, prices: [{ currency_code: "eur", amount: 12 }] }],
      }),
    })
    const id = (await response.json()).product.id
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    expect(store.buyerCanCheckOut()).toMatch(/do not have a price/)

    const html = await show(<PublishedScreen />)

    expect(html).not.toContain("live!")
    expect(html).toContain(
      "Wildflower Honey has no price in USD, the currency buyers pay in."
    )
    expect(html).toContain(`href="/products/${id}/prices"`)
    expect(html).not.toContain("tracks stock and has none")
  })

  it("is not said when the store could not be read", async () => {
    backend.on("GET", "/vendor/stock-locations", () =>
      json(500, { message: "An unknown error occurred." })
    )

    const html = await show(<PublishedScreen />)

    expect(html).not.toContain("live!")
    expect(html).toContain("We could not check whether buyers can check out")
  })
})

describe("the wizard", () => {
  it("records the selling type and the step once for a double click", async () => {
    // A vendor who chose a selling type and came back to the first step.
    store.db.onboarding.wizard_step = "step_1"
    store.db.onboarding.selling_type = "physical"
    const release = backend.hold("PATCH", "/vendor/onboarding")
    await show(<LaunchWizard />)
    const next = ui.button("Continue")

    ui.press(next)
    ui.press(next)
    await vi.waitFor(() => expect(writes()).toHaveLength(1))
    render(<LaunchWizard />)
    expect(ui.button("Continue")).toMatchObject({ disabled: true, isLoading: true })

    release()
    await settled()
    expect(writes()).toEqual(["PATCH /vendor/onboarding"])
    expect(backend.sent.at(-1)?.body).toEqual({
      step: "step_2",
      selling_type: "physical",
    })
    expect(render(<LaunchWizard />)).toContain("Your first listing")
  })

  it("at the listing step, remembers the product a vendor made and moves on without making another", async () => {
    store.db.onboarding.wizard_step = "step_2"
    store.db.onboarding.selling_type = "physical"
    writeWizardProduct("onb_1", { id: "prod_made", title: "Wildflower Honey" })

    const html = await show(<LaunchWizard />)
    expect(html).toContain("Wildflower Honey is saved as a draft.")

    const next = ui.button("Continue")
    ui.press(next)
    ui.press(next)
    await settled()

    // Recorded once, however fast the button is pressed.
    expect(writes()).toEqual(["PATCH /vendor/onboarding"])
    expect(backend.sent.at(-1)?.body).toEqual({ step: "step_3" })
    expect(render(<LaunchWizard />)).toContain("Delivery")
  })

  it("at the listing step with nothing made, offers the form that creates the draft", async () => {
    store.db.onboarding.wizard_step = "step_2"
    store.db.onboarding.selling_type = "physical"

    const html = await show(<LaunchWizard />)

    expect(html).toContain("This saves a draft product in your store")
    expect(ui.has("Save draft and continue")).toBe(true)
  })

  it("takes a vendor from the delivery step to a live store: stock recorded, product published, then \"You're live!\"", async () => {
    // The listing step made a draft before the store had a stock location.
    const made = await (
      await fetch("http://panel.test/vendor/seller-products", {
        method: "POST",
        body: JSON.stringify({
          title: "Wildflower Honey",
          status: "draft",
          variants: [{ title: "Default variant", manage_inventory: true, variant_rank: 0, prices: [{ currency_code: "usd", amount: 12 }] }],
        }),
      })
    ).json()
    writeWizardProduct("onb_1", {
      id: made.product.id,
      title: "Wildflower Honey",
      pendingStock: 10,
    })
    store.db.onboarding.wizard_step = "step_3"
    store.db.onboarding.selling_type = "physical"
    // The delivery step's guided setup, as the vendor saves it.
    await setUpDelivery({
      location: barn,
      pickup: { name: "Pickup" },
      shipping: { name: "Flat delivery", amount: 5 },
    })

    await show(<LaunchWizard />)
    ui.press(ui.button("Continue"))
    await settled()
    expect(writes()).toEqual([
      "POST /vendor/inventory-items/location-levels/batch",
      "PATCH /vendor/onboarding",
    ])
    expect(readWizardProduct("onb_1")).toMatchObject({ pendingStock: null })

    const publish = await show(<LaunchWizard />)
    expect(publish).not.toContain("live!")
    ui.press(ui.button("Publish Wildflower Honey"))
    await settled()
    expect(writes()).toEqual([
      `POST /vendor/products/${made.product.id}/status`,
      "POST /vendor/onboarding/publish",
    ])

    const done = await show(<LaunchWizard />)
    expect(done).toContain("You&#x27;re live!")
    expect(store.buyerCanCheckOut()).toBe(true)
    expect((await readSellingSetup()).ready).toBe(true)
  })

  it("a state the old wizard recorded as published, with nothing a buyer could buy, is not called live", async () => {
    // Measured: POST /vendor/onboarding/publish { listing_id: "prod_does_not_exist" }
    // answered 200 and the wizard said "You're live!".
    store.db.onboarding.wizard_step = "published"
    store.db.onboarding.first_published_listing_id = "prod_does_not_exist"

    const html = await show(<LaunchWizard />)

    expect(html).not.toContain("live!")
    expect(html).toContain("Buyers cannot buy it yet.")
  })
})
