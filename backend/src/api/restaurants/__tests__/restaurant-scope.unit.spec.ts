/**
 * `/restaurants/**` handlers act on the restaurant in the path, and the list
 * takes an allow-list of filters (SD-116).
 *
 * Seen on Postgres before this change, with no credentials at all:
 * `DELETE /restaurants/:id/products` naming a product that was not the
 * restaurant's answered 200 and the product was gone from the product module;
 * `GET /restaurants?admins[email]=…` answered 200 with the restaurant whose
 * admin has that address. The prefix is admin-only now (see
 * `middlewares/bare-prefix-auth.ts`, and `bare-prefix-route-guards.unit.spec.ts`
 * for the guard itself); these are the handlers' own checks, which are what
 * keeps the routes scoped on the day a narrower caller is let in.
 *
 * `integration-tests/http/bare-prefix-authz.spec.ts` has the same doors on the
 * assembled app and real tables.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { RESTAURANT_MODULE } from "../../../modules/restaurant"

const deleteProductsRun = jest.fn(async (_args: { input: { ids: string[] } }) => ({ result: undefined }))
const deleteProductsWorkflow = jest.fn((_scope: unknown) => ({ run: deleteProductsRun }))
jest.mock("@medusajs/medusa/core-flows", () => ({
  deleteProductsWorkflow: (scope: unknown) => deleteProductsWorkflow(scope),
}))

const deleteAdminRun = jest.fn(async (_args: { input: { id: string } }) => ({ result: undefined }))
jest.mock("../../../workflows/restaurant/workflows/delete-restaurant-admin", () => ({
  deleteRestaurantAdminWorkflow: () => ({ run: deleteAdminRun }),
}))
jest.mock("../../../workflows/restaurant/workflows/create-restaurant-products", () => ({
  createRestaurantProductsWorkflow: () => ({ run: jest.fn() }),
}))
jest.mock("../../../workflows/restaurant/workflows/create-restaurant", () => ({
  createRestaurantWorkflow: () => ({ run: jest.fn() }),
}))
// The products route builds its create schema from Medusa's admin validator at
// import; only the DELETE handler is under test here.
jest.mock("@medusajs/medusa/api/admin/products/validators", () => {
  const { z } = jest.requireActual("zod")
  return { AdminCreateProduct: () => z.object({}) }
})

import { DELETE as deleteProducts } from "../[id]/products/route"
import { DELETE as deleteAdmin } from "../[id]/admins/[admin_id]/route"
import { GET as listRestaurants } from "../route"

type Res = { statusCode: number; body: unknown; status: (c: number) => Res; json: (p: unknown) => Res }
const createRes = (): Res => {
  const res = { statusCode: 200, body: undefined } as Res
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

const REFUSAL = { message: "You do not have access to this record.", type: "not_allowed" }

// rst_a's menu is prod_a1 and prod_a2; prod_b1 is rst_b's; prod_loose is
// nobody's (a seller's product, say). adm_a administers rst_a.
const MENU: Record<string, string[]> = { rst_a: ["prod_a1", "prod_a2"], rst_b: ["prod_b1"] }
const ADMIN_OF: Record<string, string> = { adm_a: "rst_a", adm_b: "rst_b" }

const setup = (opts: { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown> }) => {
  const graph = jest.fn(async (args: { entity: string; fields: string[]; filters?: Record<string, unknown> }) => {
    const id = args.filters?.id as string | undefined
    if (args.fields.includes("products.id")) {
      return { data: id && MENU[id] ? [{ id, products: MENU[id].map((p) => ({ id: p })) }] : [] }
    }
    return { data: Object.keys(MENU).map((rid) => ({ id: rid })) }
  })
  const listRestaurantAdmins = jest.fn(async (filters: { id: string; restaurant_id: string }) =>
    ADMIN_OF[filters.id] === filters.restaurant_id ? [{ id: filters.id }] : []
  )
  const resolved: string[] = []
  const req = {
    params: opts.params ?? {},
    body: opts.body ?? {},
    query: opts.query ?? {},
    headers: {},
    scope: {
      // Only the real registration keys answer. A guessed key throws, so a
      // handler that resolved the wrong one could not pass on a fallback.
      resolve: (key: string) => {
        resolved.push(key)
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        if (key === RESTAURANT_MODULE) return { listRestaurantAdmins }
        throw new Error(`unexpected container key in spec: ${key}`)
      },
    },
  }
  return { req, graph, listRestaurantAdmins, resolved }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (handler: (req: any, res: any) => Promise<unknown>, req: unknown) => {
  const res = createRes()
  await handler(req, res)
  return res
}

beforeEach(() => {
  deleteProductsRun.mockClear()
  deleteProductsWorkflow.mockClear()
  deleteAdminRun.mockClear()
})

describe("DELETE /restaurants/:id/products deletes only the path restaurant's products", () => {
  it("deletes products linked to the restaurant in the path", async () => {
    const { req, graph } = setup({ params: { id: "rst_a" }, body: { product_ids: ["prod_a1", "prod_a2"] } })
    const res = await run(deleteProducts, req)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteProductsRun).toHaveBeenCalledTimes(1)
    expect(deleteProductsRun.mock.calls[0][0]).toEqual({ input: { ids: ["prod_a1", "prod_a2"] } })
    // The ownership read is of the restaurant in the path, by id.
    expect(graph.mock.calls[0][0]).toMatchObject({ fields: ["id", "products.id"], filters: { id: "rst_a" } })
  })

  it.each([
    ["another restaurant's product", ["prod_b1"]],
    ["a product that is no restaurant's", ["prod_loose"]],
    ["a product that does not exist", ["prod_missing"]],
  ])("refuses %s, and deletes nothing", async (_label, ids) => {
    const { req } = setup({ params: { id: "rst_a" }, body: { product_ids: ids } })
    const res = await run(deleteProducts, req)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(REFUSAL)
    expect(deleteProductsWorkflow).not.toHaveBeenCalled()
    expect(deleteProductsRun).not.toHaveBeenCalled()
  })

  it("one foreign id refuses the whole request: its own products are not deleted either", async () => {
    const { req } = setup({ params: { id: "rst_a" }, body: { product_ids: ["prod_a1", "prod_b1"] } })
    const res = await run(deleteProducts, req)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(REFUSAL)
    expect(deleteProductsRun).not.toHaveBeenCalled()
  })

  it("a restaurant that does not exist is the same refusal, with products named or not", async () => {
    for (const product_ids of [["prod_a1"], []]) {
      const { req } = setup({ params: { id: "rst_missing" }, body: { product_ids } })
      const res = await run(deleteProducts, req)
      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual(REFUSAL)
    }
    expect(deleteProductsRun).not.toHaveBeenCalled()
  })

  it("a repeated id is deleted once", async () => {
    const { req } = setup({ params: { id: "rst_a" }, body: { product_ids: ["prod_a1", "prod_a1"] } })
    await run(deleteProducts, req)
    expect(deleteProductsRun.mock.calls[0][0]).toEqual({ input: { ids: ["prod_a1"] } })
  })
})

describe("DELETE /restaurants/:id/admins/:admin_id removes only the path restaurant's admin", () => {
  it("removes an admin of the restaurant in the path", async () => {
    const { req, listRestaurantAdmins } = setup({ params: { id: "rst_a", admin_id: "adm_a" } })
    const res = await run(deleteAdmin, req)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ message: "success" })
    expect(deleteAdminRun).toHaveBeenCalledWith({ input: { id: "adm_a" } })
    expect(listRestaurantAdmins.mock.calls[0][0]).toEqual({ id: "adm_a", restaurant_id: "rst_a" })
  })

  it.each([
    ["another restaurant's admin", "rst_a", "adm_b"],
    ["an admin that does not exist", "rst_a", "adm_missing"],
    ["a restaurant that does not exist", "rst_missing", "adm_a"],
  ])("refuses %s, and removes nobody", async (_label, id, admin_id) => {
    const { req } = setup({ params: { id, admin_id } })
    const res = await run(deleteAdmin, req)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(REFUSAL)
    expect(deleteAdminRun).not.toHaveBeenCalled()
  })
})

describe("GET /restaurants filters by an allow-list", () => {
  const filtersOf = (graph: jest.Mock) => (graph.mock.calls[0][0] as { filters: unknown }).filters

  it("passes id, handle and is_open, and nothing else, to the query", async () => {
    const { req, graph } = setup({ query: { handle: "anon-diner", id: ["rst_a", "rst_b"], is_open: "true", currency_code: "usd" } })
    const res = await run(listRestaurants, req)

    expect(res.statusCode).toBe(200)
    expect(filtersOf(graph)).toEqual({ handle: "anon-diner", id: ["rst_a", "rst_b"], is_open: true })
  })

  it("is_open=false is the boolean false, not a truthy string", async () => {
    const { req, graph } = setup({ query: { is_open: "false" } })
    await run(listRestaurants, req)
    expect(filtersOf(graph)).toEqual({ is_open: false })
  })

  it("no query lists with no filter", async () => {
    const { req, graph } = setup({})
    const res = await run(listRestaurants, req)
    expect(res.statusCode).toBe(200)
    expect(filtersOf(graph)).toEqual({})
  })

  it.each([
    ["a column outside the list", { email: "owner@example.com" }],
    ["a relation filter (admins[email]=…)", { admins: { email: "ada@example.com" } }],
    ["an operator on an allowed column (handle[$like]=…)", { handle: { $like: "%" } }],
    ["a relation through the deliveries link", { deliveries: { cart: { email: "diner@example.com" } } }],
    ["an operator on is_open", { is_open: { $ne: "true" } }],
    ["a currency that is not a code", { currency_code: { $ne: "eur" } }],
  ])("refuses %s with 400, and runs no query", async (_label, query) => {
    const { req, graph } = setup({ query })
    const res = await run(listRestaurants, req)

    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ type: "invalid_data" })
    expect(graph).not.toHaveBeenCalled()
  })
})
