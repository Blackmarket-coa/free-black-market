import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { readFileSync } from "fs"
import { join } from "path"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
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
 * SD-151 (4): the product form sent `manage_inventory: true` for every
 * variant and asked for no stock, so each product it made had an inventory
 * item with no level anywhere: listed by the storefront, impossible to add to
 * a cart. The form now asks how many there are and says where they are held,
 * or lets the vendor untick "Track stock".
 *
 * SD-151 (2): the form names no listing type. The backend gives the product
 * its seller's playbook's default, and when it refuses the vendor reads the
 * backend's own words.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../../__tests__/browser-storage")).installBrowserStorage()
)
vi.mock("../../../lib/logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  Link: ({ children, to }: { children?: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
}))

import { createBackend, json } from "../../../__tests__/backend"
import { createFakeStore } from "../../../__tests__/fake-store"
import {
  sellingSetupMutationKeys,
  useCreateProductWithStock,
  useIsBusy,
} from "../../../hooks/api/selling-setup"
import { backendMessage } from "../../../lib/backend-message"
import { setAuthToken } from "../../../lib/client"
import { readSellingSetup, setUpDelivery } from "../../../lib/selling-setup"
import { StockNote } from "./components/product-create-variants-form/product-create-variants-form"
import { PRODUCT_CREATE_FORM_DEFAULTS } from "./constants"
import type { ProductCreateSchemaType } from "./types"
import {
  initialStockFrom,
  toCreateProductPayload,
  variantsMissingStock,
} from "./utils"

const backend = createBackend()
let store: ReturnType<typeof createFakeStore>
let client: QueryClient

/** The form as a vendor fills it for one product: a title and a USD price. */
const formValues = (
  variant: Partial<ProductCreateSchemaType["variants"][number]> = {}
): ProductCreateSchemaType =>
  ({
    ...PRODUCT_CREATE_FORM_DEFAULTS,
    title: "Wildflower Honey",
    sales_channels: [{ id: "sc_1", name: "Default Sales Channel" }],
    variants: [
      {
        ...PRODUCT_CREATE_FORM_DEFAULTS.variants![0],
        prices: { usd: "12" },
        ...variant,
      },
    ],
  }) as ProductCreateSchemaType
const payloadOf = (values: ProductCreateSchemaType) =>
  toCreateProductPayload(values, {
    status: "published",
    uploadedMedia: [],
    regionsCurrencyMap: {},
  })

const barn = {
  name: "Bravo Barn",
  address_1: "1 Farm Rd",
  city: "Atlanta",
  postal_code: "30301",
  country_code: "us",
}
const hook = () => {
  const hooks: {
    create?: ReturnType<typeof useCreateProductWithStock>
    busy?: ReturnType<typeof useIsBusy>
  } = {}
  const Probe = () => {
    hooks.create = useCreateProductWithStock()
    hooks.busy = useIsBusy(sellingSetupMutationKeys.listing)
    return null
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  )
  return hooks as Required<typeof hooks>
}

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  backend.reset()
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

describe("the product form's stock", () => {
  it("starts with stock tracked and no quantity entered", () => {
    expect(PRODUCT_CREATE_FORM_DEFAULTS.variants![0]).toMatchObject({
      manage_inventory: true,
      stock_quantity: "",
    })
  })

  it("sends the variant as tracked or not as the vendor chose, never the quantity, and the price in major units", () => {
    const sent = (values: ProductCreateSchemaType) =>
      JSON.parse(JSON.stringify(payloadOf(values)))

    const tracked = sent(formValues({ stock_quantity: "10" }))
    expect(tracked).toMatchObject({
      title: "Wildflower Honey",
      status: "published",
      sales_channels: [{ id: "sc_1", name: "Default Sales Channel" }],
      options: [{ title: "Default option", values: ["Default option value"] }],
    })
    expect(tracked.variants).toEqual([
      {
        title: "Default variant",
        manage_inventory: true,
        allow_backorder: false,
        variant_rank: 0,
        options: { "Default option": "Default option value" },
        // $12.00 typed as "12" is sent as 12.
        prices: [{ currency_code: "usd", amount: 12 }],
      },
    ])
    // No listing type is named: the backend applies the playbook's default.
    expect(tracked).not.toHaveProperty("additional_data")

    expect(
      sent(formValues({ manage_inventory: false })).variants[0].manage_inventory
    ).toBe(false)
  })

  it("the form builds its request with toCreateProductPayload and forces no variant to track stock", () => {
    const file = join(
      __dirname,
      "components/product-create-form/product-create-form.tsx"
    )
    const ast = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    const forced: string[] = []
    const called = new Set<string>()
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(ast) === "manage_inventory"
      ) {
        forced.push(node.getText(ast))
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        called.add(node.expression.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)

    expect(forced).toEqual([])
    expect([...called]).toEqual(
      expect.arrayContaining([
        "toCreateProductPayload",
        "initialStockFrom",
        "variantsMissingStock",
        "useCreateProductWithStock",
        "useDeliverySetup",
      ])
    )
  })

  it("asks for a quantity for each tracked variant, while there is somewhere to hold it", () => {
    const variants = [
      ...formValues({ stock_quantity: "" }).variants,
      { ...formValues({ stock_quantity: "0" }).variants[0], variant_rank: 1 },
      { ...formValues({ manage_inventory: false }).variants[0], variant_rank: 2 },
      { ...formValues().variants[0], variant_rank: 3, should_create: false },
    ]

    // Zero is an answer; an untracked or unlisted variant is not asked.
    expect(variantsMissingStock(variants, true)).toEqual([0])
    // With no stock location nothing could be recorded, so nothing is asked.
    expect(variantsMissingStock(variants, false)).toEqual([])
    expect(initialStockFrom(variants)).toEqual([{ variant_rank: 1, quantity: 0 }])
    expect(
      initialStockFrom(formValues({ stock_quantity: "10" }).variants)
    ).toEqual([{ variant_rank: 0, quantity: 10 }])
  })

  it("says where the stock is held, or that there is nowhere to hold it", () => {
    const held = renderToStaticMarkup(
      <StockNote stockLocation={{ id: "sloc_1", name: "Bravo Barn" }} stockLocationLinked />
    )
    expect(held).toContain("Stock is held at Bravo Barn.")
    expect(held).not.toContain("not linked")

    const unlinked = renderToStaticMarkup(
      <StockNote stockLocation={{ id: "sloc_1", name: "Home" }} stockLocationLinked={false} />
    )
    expect(unlinked).toContain("Home is not linked to your sales channel yet")
    expect(unlinked).toContain('href="/delivery-setup"')

    const none = renderToStaticMarkup(<StockNote stockLocation={null} />)
    expect(none).toContain(
      "You have no stock location yet, so no stock can be recorded."
    )
    expect(none).toContain('href="/delivery-setup"')
    expect(none).toMatch(/or untick Track\s+stock/)

    expect(
      renderToStaticMarkup(<StockNote stockLocation={null} stockLocationUnread />)
    ).toContain("Your stock locations could not be read")
  })
})

describe("useCreateProductWithStock", () => {
  it("creates the product, then records the quantity at the store's stock location: a buyer can then check out", async () => {
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })
    const location = store.db.locations[0].id
    backend.sent.length = 0
    const values = formValues({ stock_quantity: "10" })

    const result = await hook().create.mutateAsync({
      payload: payloadOf(values),
      stock: { locationId: location, entries: initialStockFrom(values.variants) },
    })

    const product = store.db.products[0]
    expect(result.product.id).toBe(product.id)
    expect(result.stockError).toBeUndefined()
    expect(backend.calls()).toEqual([
      "POST /vendor/seller-products",
      `GET /vendor/products/${product.id}`,
      `GET /vendor/inventory-items/${product.variants[0].item}/location-levels`,
      "POST /vendor/inventory-items/location-levels/batch",
    ])
    expect(backend.sent[0].body).toMatchObject({
      title: "Wildflower Honey",
      status: "published",
      variants: [
        {
          manage_inventory: true,
          prices: [{ currency_code: "usd", amount: 12 }],
        },
      ],
    })
    expect(
      (backend.sent[0].body as { variants: object[] }).variants[0]
    ).not.toHaveProperty("stock_quantity")
    expect(backend.sent[3].body).toEqual({
      create: [
        {
          inventory_item_id: product.variants[0].item,
          location_id: location,
          stocked_quantity: 10,
        },
      ],
      update: [],
      delete: [],
    })
    expect(
      backend.sent.every(
        (s) => s.headers.get("authorization") === "Bearer tok-seller"
      )
    ).toBe(true)
    expect(store.buyerCanCheckOut()).toBe(true)
    expect((await readSellingSetup()).ready).toBe(true)
  })

  it("what the form used to send (tracked, no quantity) cannot be bought; untracked can", async () => {
    await setUpDelivery({ location: barn, pickup: { name: "Pickup" }, shipping: null })

    await hook().create.mutateAsync({ payload: payloadOf(formValues()) })
    expect(store.buyerCanCheckOut()).toMatch(/required inventory/)

    store.db.products.length = 0
    backend.sent.length = 0
    await hook().create.mutateAsync({
      payload: payloadOf(formValues({ manage_inventory: false })),
    })
    // Nothing to record: one request.
    expect(backend.calls()).toEqual(["POST /vendor/seller-products"])
    expect(store.buyerCanCheckOut()).toBe(true)
  })

  it("keeps the product when its stock cannot be recorded, and says so instead of failing", async () => {
    await setUpDelivery({ location: barn, pickup: null, shipping: null })
    backend.on("POST", "/vendor/inventory-items/location-levels/batch", () =>
      json(500, { message: "An unknown error occurred." })
    )
    const values = formValues({ stock_quantity: "10" })

    const result = await hook().create.mutateAsync({
      payload: payloadOf(values),
      stock: {
        locationId: store.db.locations[0].id,
        entries: initialStockFrom(values.variants),
      },
    })

    expect(result.product.id).toBe(store.db.products[0].id)
    expect(backendMessage(result.stockError, "")).toBe(
      "An unknown error occurred."
    )
    expect(store.db.products).toHaveLength(1)
  })

  it("is busy from the press until the stock is recorded, so a second press is not a second product", async () => {
    await setUpDelivery({ location: barn, pickup: null, shipping: null })
    const release = backend.hold(
      "POST",
      "/vendor/inventory-items/location-levels/batch"
    )
    const values = formValues({ stock_quantity: "10" })
    const { create, busy } = hook()
    expect(busy.isBusyNow()).toBe(false)

    const pending = create.mutateAsync({
      payload: payloadOf(values),
      stock: {
        locationId: store.db.locations[0].id,
        entries: initialStockFrom(values.variants),
      },
    })
    // Busy at once, and still busy after the product itself is created.
    expect(busy.isBusyNow()).toBe(true)
    await vi.waitFor(() => expect(store.db.products).toHaveLength(1))
    expect(busy.isBusyNow()).toBe(true)
    expect(hook().busy.pending).toBe(true)

    release()
    await pending
    expect(busy.isBusyNow()).toBe(false)
  })
})

describe("a product the backend refuses", () => {
  const refusal =
    'Listing type "physical_product" is not allowed on the Service playbook. Allowed types: event, digital, recurring, bookable. Switch playbooks (vendor settings → playbook) if your offering shape no longer fits.'

  it("is shown in the backend's words, without the request the panel appends for its logs", async () => {
    // The route middleware's answer (SD-151, measured: 400 invalid_data).
    backend.on("POST", "/vendor/seller-products", () =>
      json(400, { type: "invalid_data", message: refusal })
    )

    const error = await hook()
      .create.mutateAsync({ payload: payloadOf(formValues()) })
      .catch((e: unknown) => e)

    expect((error as Error).message).toContain("(POST /vendor/seller-products")
    expect(backendMessage(error, "The product could not be created.")).toBe(
      refusal
    )
    expect(store.db.products).toEqual([])
  })

  it("shows the reason the product route gives beside its own message", async () => {
    backend.on("POST", "/vendor/seller-products", () =>
      json(400, {
        message: "Failed to create product",
        error: refusal,
        type: "invalid_data",
      })
    )

    const error = await hook()
      .create.mutateAsync({ payload: payloadOf(formValues()) })
      .catch((e: unknown) => e)

    expect(backendMessage(error, "")).toBe(`Failed to create product: ${refusal}`)
  })

  it("falls back to the error's own message, then to the caller's", () => {
    expect(backendMessage(new TypeError("Failed to fetch"), "x")).toBe(
      "Failed to fetch"
    )
    expect(backendMessage(undefined, "The product could not be created.")).toBe(
      "The product could not be created."
    )
  })
})
