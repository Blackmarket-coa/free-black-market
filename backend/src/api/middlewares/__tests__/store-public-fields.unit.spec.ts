import express from "express"
import type { AddressInfo } from "net"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { validateAndTransformQuery } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { BUYER_SELLER_FIELDS, PUBLIC_SELLER_FIELDS } from "../../../shared/store-field-policy"
import { guardStoreFields, storePublicFieldsMiddlewares } from "../store-public-fields"

/**
 * The middleware around the policy: that whatever a route's validator
 * assigns to the request is sanitised, in the order Medusa runs things, and
 * what happens to a response on the way out. The same through the real
 * routes on Postgres: `integration-tests/http/store-public-fields.spec.ts`.
 */

type GraphCall = { entity: string; filters?: Record<string, unknown> }

/** A request as the framework hands it over, with a `query.graph` that answers from fixed rows. */
function request(url: string, options: { channels?: string[]; channelCount?: number; published?: string[]; inChannel?: string[] } = {}) {
  const calls: GraphCall[] = []
  const graph = jest.fn(async (call: GraphCall) => {
    calls.push(call)
    if (call.entity === "sales_channels") return { data: [{ id: "sc_1" }], metadata: { count: options.channelCount ?? 2 } }
    if (call.entity === "product_sales_channel") {
      const asked = call.filters?.product_id as string[]
      return { data: asked.filter((id) => (options.inChannel ?? []).includes(id)).map((product_id) => ({ product_id })) }
    }
    const asked = call.filters?.id as string[]
    return { data: asked.filter((id) => (options.published ?? []).includes(id)).map((id) => ({ id })) }
  })
  const req = {
    originalUrl: url,
    url,
    publishable_key_context: { key: "pk", sales_channel_ids: options.channels ?? ["sc_1"] },
    scope: { resolve: (key: string) => (key === ContainerRegistrationKeys.QUERY ? { graph } : undefined) },
  } as unknown as MedusaRequest
  return { req, calls }
}

function response() {
  const sent: unknown[] = []
  const res = { json: jest.fn((body: unknown) => (sent.push(body), res)) } as unknown as MedusaResponse
  return { res, sent }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe("guardStoreFields", () => {
  it("sanitises a field list assigned after it ran, under each of the four names a route may read", () => {
    const { req } = request("/store/products?fields=*seller")
    const { res } = response()
    const next = jest.fn()
    guardStoreFields(req, res, next as MedusaNextFunction)
    expect(next).toHaveBeenCalledWith()

    // As `validateAndTransformQuery` assigns them.
    const remote = { fields: ["id", "seller.*", "seller.orders.*", "seller.email"], pagination: { skip: 0, take: 50 } }
    req.queryConfig = remote as unknown as MedusaRequest["queryConfig"]
    req.remoteQueryConfig = req.queryConfig
    req.listConfig = { select: ["id", "seller.email"], relations: ["seller", "variants"], skip: 0, take: 50 }
    req.retrieveConfig = { select: ["id", "seller.name"], relations: ["seller", "seller.orders"] }

    const expected = ["id", ...PUBLIC_SELLER_FIELDS.map((field) => `seller.${field}`)]
    expect(req.queryConfig.fields).toEqual(expected)
    expect(req.remoteQueryConfig.fields).toEqual(expected)
    // One object, as the framework leaves it: a route that edits one edits both.
    expect(req.remoteQueryConfig).toBe(req.queryConfig)
    expect(req.queryConfig.pagination).toEqual({ skip: 0, take: 50 })
    expect(req.listConfig).toEqual({ select: ["id"], relations: ["variants"], skip: 0, take: 50 })
    expect(req.retrieveConfig).toEqual({ select: ["id", "seller.name"], relations: ["seller"] })
  })

  it("reads the profile from the request path: the buyer's order sees the seller's return address, a product read does not", () => {
    const fields = () => ({ fields: ["id", "seller.*"] }) as unknown as MedusaRequest["queryConfig"]

    const order = request("/store/orders/order_1?fields=*seller").req
    guardStoreFields(order, response().res, jest.fn())
    order.queryConfig = fields()
    expect(order.queryConfig.fields).toEqual(["id", ...BUYER_SELLER_FIELDS.map((field) => `seller.${field}`)])

    const product = request("/store/products/prod_1?fields=*seller").req
    guardStoreFields(product, response().res, jest.fn())
    product.queryConfig = fields()
    expect(product.queryConfig.fields).toEqual(["id", ...PUBLIC_SELLER_FIELDS.map((field) => `seller.${field}`)])
  })

  it("leaves a response alone when no product list was reached through a relation", async () => {
    const { req, calls } = request("/store/products")
    const { res, sent } = response()
    guardStoreFields(req, res, jest.fn())
    req.queryConfig = { fields: ["id", "title", "seller.name"] } as unknown as MedusaRequest["queryConfig"]

    const body = { products: [{ id: "prod_1", seller: { name: "Farm", products: [{ id: "prod_draft" }] } }] }
    res.json(body)
    expect(sent).toEqual([body])
    expect(calls).toEqual([])
  })

  it("serves a nested product list only as the listing would: in the key's channel and published", async () => {
    const { req, calls } = request("/store/products", { inChannel: ["prod_a", "prod_draft"], published: ["prod_a", "prod_other"] })
    const { res, sent } = response()
    guardStoreFields(req, res, jest.fn())
    req.queryConfig = { fields: ["id", "seller.products.handle"] } as unknown as MedusaRequest["queryConfig"]
    expect(req.queryConfig.fields).toEqual(["id", "seller.products.handle", "seller.products.id"])

    res.json({
      products: [{ id: "prod_listed", seller: { id: "sel_1", products: [{ id: "prod_a" }, { id: "prod_draft" }, { id: "prod_other" }] } }],
    })
    expect(sent).toEqual([])
    await settle()
    expect(sent).toEqual([{ products: [{ id: "prod_listed", seller: { id: "sel_1", products: [{ id: "prod_a" }] } }] }])
    expect(calls.map((call) => call.entity)).toEqual(["sales_channels", "product_sales_channel", "product"])
    expect(calls[1].filters).toEqual({ product_id: ["prod_a", "prod_draft", "prod_other"], sales_channel_id: ["sc_1"] })
    expect(calls[2].filters).toEqual({ id: ["prod_a", "prod_draft"], status: "published" })
  })

  it("as Medusa's listing, does not check the channel in a store that has only one", async () => {
    const { req, calls } = request("/store/collections", { channelCount: 1, published: ["prod_a"] })
    const { res, sent } = response()
    guardStoreFields(req, res, jest.fn())
    req.queryConfig = { fields: ["id", "products.*"] } as unknown as MedusaRequest["queryConfig"]

    res.json({ collections: [{ id: "pcol_1", products: [{ id: "prod_a" }, { id: "prod_draft" }] }] })
    await settle()
    expect(sent).toEqual([{ collections: [{ id: "pcol_1", products: [{ id: "prod_a" }] }] }])
    expect(calls.map((call) => call.entity)).toEqual(["sales_channels", "product"])
  })

  it("serves no nested product at all to a request with no sales channel", async () => {
    const { req, calls } = request("/store/collections", { channels: [], published: ["prod_a"] })
    const { res, sent } = response()
    guardStoreFields(req, res, jest.fn())
    req.queryConfig = { fields: ["id", "products.*"] } as unknown as MedusaRequest["queryConfig"]

    res.json({ collections: [{ id: "pcol_1", products: [{ id: "prod_a" }] }] })
    await settle()
    expect(sent).toEqual([{ collections: [{ id: "pcol_1", products: [] }] }])
    expect(calls).toEqual([])
  })

  it("hands a failed visibility check to the error handler and sends nothing", async () => {
    const { req } = request("/store/collections")
    ;(req.scope as unknown as { resolve: () => unknown }).resolve = () => ({
      graph: async () => {
        throw new Error("database unavailable")
      },
    })
    const { res, sent } = response()
    const next = jest.fn()
    guardStoreFields(req, res, next as MedusaNextFunction)
    req.queryConfig = { fields: ["id", "products.*"] } as unknown as MedusaRequest["queryConfig"]

    res.json({ collections: [{ id: "pcol_1", products: [{ id: "prod_draft" }] }] })
    await settle()
    expect(sent).toEqual([])
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ message: "database unavailable" }))
  })

  it("cuts the seller objects of Mercur's order sets, whose field list is fixed in the handler", () => {
    const { req } = request("/store/order-set/ordset_1")
    const { res, sent } = response()
    guardStoreFields(req, res, jest.fn())

    res.json({
      order_set: {
        id: "ordset_1",
        orders: [{ id: "order_1", seller: { id: "sel_1", name: "Farm", email: "grower@example.com", tax_id: "12-3456789", members: [] } }],
      },
    })
    expect(sent).toEqual([
      { order_set: { id: "ordset_1", orders: [{ id: "order_1", seller: { id: "sel_1", name: "Farm", email: "grower@example.com" } }] } },
    ])
  })
})

/**
 * Mounted as the framework mounts it: method-less middleware goes on with
 * `app.use(matcher, …)` and runs before a route's own validator, which is
 * Medusa's real `validateAndTransformQuery` here.
 */
describe("mounted on /store", () => {
  const app = express()
  for (const route of storePublicFieldsMiddlewares) {
    expect(route.methods ?? route.method).toBeUndefined()
    for (const middleware of route.middlewares ?? []) app.use(route.matcher as string, middleware as unknown as express.RequestHandler)
  }
  const params = z.object({ fields: z.string().optional() })
  const validate = (defaults: string[]) =>
    validateAndTransformQuery(params, { defaults, isList: true }) as unknown as express.RequestHandler
  const echo: express.RequestHandler = (req, res) => {
    res.json({ fields: (req as unknown as MedusaRequest).queryConfig.fields })
  }
  app.get("/store/products", validate(["id", "title"]), echo)
  app.get("/store/seller", validate(["id", "name", "tax_id", "address_line"]), echo)
  app.get("/vendor/sellers/me", validate(["id", "name"]), echo)
  app.get("/admin/sellers", validate(["id", "name"]), echo)
  app.get("/storefront/products", validate(["id"]), echo)
  app.use(((error, _req, res, _next) => {
    res.status(500).json({ message: String(error?.message ?? error) })
  }) as express.ErrorRequestHandler)

  let base = ""
  let server: ReturnType<typeof app.listen>
  beforeAll(async () => {
    server = app.listen(0)
    await new Promise((resolve) => server.once("listening", resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise((resolve) => server.close(resolve)))

  const fields = async (pathAndQuery: string): Promise<string[]> => {
    const res = await fetch(`${base}${pathAndQuery}`)
    expect(res.status).toBe(200)
    return ((await res.json()) as { fields: string[] }).fields.sort()
  }
  const publicSeller = PUBLIC_SELLER_FIELDS.map((field) => `seller.${field}`)

  it.each(["*seller", "seller.*"])("a store route asked for %s hands its handler the public columns", async (spelling) => {
    expect(await fields(`/store/products?fields=${encodeURIComponent(spelling)}`)).toEqual(["id", "title", ...publicSeller].sort())
  })

  it.each(["+seller.email", "seller.email,id", "+seller.tax_id,+seller.orders.id,*seller.members", "*seller.orders.customer"])(
    "a store route asked for %s hands its handler none of it",
    async (spelling) => {
      const kept = await fields(`/store/products?fields=${encodeURIComponent(spelling)}`)
      expect(kept.filter((field) => field.startsWith("seller"))).toEqual([])
      expect(kept).toContain("id")
    }
  )

  it("a route's own defaults are sanitised too", async () => {
    expect(await fields("/store/seller")).toEqual(["id", "name"])
    expect(await fields("/store/seller?fields=%2Bemail,%2Bphone")).toEqual(["id", "name"])
  })

  it("does not match /vendor, /admin or a path that merely starts with the same letters", async () => {
    const asked = encodeURIComponent("id,email,tax_id,*members,*orders")
    const whole = ["email", "id", "members.*", "orders.*", "tax_id"]
    expect(await fields(`/vendor/sellers/me?fields=${asked}`)).toEqual(whole)
    expect(await fields(`/admin/sellers?fields=${asked}`)).toEqual(whole)
    expect(await fields(`/storefront/products?fields=${asked}`)).toEqual(whole)
  })
})
