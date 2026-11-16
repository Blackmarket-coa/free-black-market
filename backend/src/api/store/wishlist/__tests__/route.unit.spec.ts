import type { MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { GET, POST } from "../route"
import { WISHLIST_MODULE } from "../../../../modules/wishlist"

/**
 * FBM's `/store/wishlist` holds to what `GET /store/products` serves for the
 * request (SD-118 follow-up): published, in the publishable key's sales
 * channel. The Postgres case is in
 * `integration-tests/http/store-public-fields.spec.ts`; this pins the
 * handler against a stub Query that answers the three reads
 * `visibleProductIds` makes and refuses any other key.
 */

type Product = { id: string; title: string; status: "published" | "draft"; channels: string[] }

const CATALOGUE: Product[] = [
  { id: "prod_tomatoes", title: "Heirloom Tomatoes", status: "published", channels: ["sc_store"] },
  { id: "prod_sauce", title: "Unreleased Hot Sauce", status: "draft", channels: ["sc_store"] },
  { id: "prod_pallet", title: "Wholesale Pallet", status: "published", channels: ["sc_wholesale"] },
]

const asArray = (value: unknown): string[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]) as string[]

function makeScope(saved: string[]) {
  const wishlists = {
    listShopperWishlists: jest.fn(async () => [{ id: "wl_1", items: saved.map((product_id) => ({ product_id })) }]),
    addProductToWishlist: jest.fn(async () => ({ id: "wl_1" })),
  }
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters?: Record<string, unknown> }) => {
    if (entity === "sales_channels") return { data: [{ id: "sc_store" }], metadata: { count: 2 } }
    if (entity === "product_sales_channel") {
      const ids = asArray(filters?.product_id)
      const channels = asArray(filters?.sales_channel_id)
      const data = CATALOGUE.filter((p) => ids.includes(p.id)).flatMap((p) =>
        p.channels.filter((channel) => channels.includes(channel)).map(() => ({ product_id: p.id }))
      )
      return { data }
    }
    if (entity === "product") {
      const ids = asArray(filters?.id)
      const data = CATALOGUE.filter((p) => ids.includes(p.id) && (filters?.status === undefined || filters.status === p.status))
      return { data: data.map(({ channels: _channels, ...row }) => row) }
    }
    throw new Error(`Unexpected entity: ${entity}`)
  })
  const scope = {
    resolve: (key: string) => {
      if (key === WISHLIST_MODULE) return wishlists
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  return { scope, wishlists, graph }
}

/** A response that records what the handler sent; typed as Medusa's for the handlers. */
const makeRes = () => {
  const res: { statusCode: number; body: any; status: (code: number) => any; json: (payload: unknown) => any } = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res as unknown as MedusaResponse & { statusCode: number; body: any }
}

const makeReq = (scope: unknown, body?: unknown) =>
  ({
    scope,
    body,
    auth_context: { actor_id: "cus_1", actor_type: "customer" },
    publishable_key_context: { key: "pk_test", sales_channel_ids: ["sc_store"] },
  }) as any

describe("GET /store/wishlist", () => {
  it("serves only the saved products the listing serves", async () => {
    const { scope } = makeScope(["prod_tomatoes", "prod_sauce", "prod_pallet"])
    const res = makeRes()
    await GET(makeReq(scope), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.wishlists).toEqual([{ id: "wl_1", products: [expect.objectContaining({ id: "prod_tomatoes", title: "Heirloom Tomatoes" })] }])
    expect(JSON.stringify(res.body)).not.toMatch(/Unreleased Hot Sauce|Wholesale Pallet/)
  })

  it("reads no product at all when none of the saved ones is served", async () => {
    const { scope, graph } = makeScope(["prod_sauce"])
    const res = makeRes()
    await GET(makeReq(scope), res)
    expect(res.body.wishlists).toEqual([{ id: "wl_1", products: [] }])
    expect(graph.mock.calls.filter(([args]) => args.entity === "product" && args.filters?.status === undefined)).toEqual([])
  })
})

describe("POST /store/wishlist", () => {
  it("saves a product the listing serves", async () => {
    const { scope, wishlists } = makeScope([])
    const res = makeRes()
    await POST(makeReq(scope, { reference: "product", reference_id: "prod_tomatoes" }), res)
    expect(res.statusCode).toBe(201)
    expect(wishlists.addProductToWishlist).toHaveBeenCalledWith("cus_1", "prod_tomatoes")
  })

  it("refuses a draft, another channel's product and an id that names nothing with the product page's 404, saving nothing", async () => {
    for (const id of ["prod_sauce", "prod_pallet", "prod_nothing"]) {
      const { scope, wishlists } = makeScope([])
      const refusal = POST(makeReq(scope, { reference: "product", reference_id: id }), makeRes())
      await expect(refusal).rejects.toThrow(MedusaError)
      await expect(refusal).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND, message: `Product with id: ${id} was not found` })
      expect(wishlists.addProductToWishlist).not.toHaveBeenCalled()
    }
  })
})
