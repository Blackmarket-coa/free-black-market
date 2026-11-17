import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireOrderSetBuyer, storeOrderSetOwnerMiddlewares } from "../store-order-set-owner"
import { storePublicFieldsMiddlewares } from "../store-public-fields"

/**
 * Only the buyer reads an order set (SD-118). The rule on its own here; the
 * same through the real routes, Medusa's `authenticate` and Mercur's handler
 * on Postgres in `integration-tests/http/store-public-fields.spec.ts`.
 */

const SET = { id: "ordset_1", customer_id: "cus_buyer" }

function call(options: { actor?: string; id?: string; rows?: unknown[] }) {
  const graph = jest.fn(async () => ({ data: options.rows ?? [SET] }))
  const req = {
    params: { id: options.id ?? SET.id },
    ...(options.actor ? { auth_context: { actor_id: options.actor, actor_type: "customer" } } : {}),
    scope: { resolve: (key: string) => (key === ContainerRegistrationKeys.QUERY ? { graph } : undefined) },
  } as unknown as MedusaRequest
  const sent: { status?: number; body?: unknown } = {}
  const res = {
    status: (code: number) => {
      sent.status = code
      return { json: (body: unknown) => (sent.body = body) }
    },
  } as unknown as MedusaResponse
  const next = jest.fn() as unknown as MedusaNextFunction & jest.Mock
  return { req, res, next, sent, graph }
}

const refusal = { message: "You do not have access to this record.", type: "not_allowed" }

describe("requireOrderSetBuyer", () => {
  it("lets the buyer through, having looked the set up by the id in the path", async () => {
    const { req, res, next, sent, graph } = call({ actor: "cus_buyer" })
    await requireOrderSetBuyer(req, res, next)
    expect(next).toHaveBeenCalledWith()
    expect(sent.status).toBeUndefined()
    expect(graph).toHaveBeenCalledWith({ entity: "order_set", fields: ["id", "customer_id"], filters: { id: "ordset_1" } })
  })

  it("refuses another customer with 403, and the same for a set that does not exist", async () => {
    const other = call({ actor: "cus_someone_else" })
    await requireOrderSetBuyer(other.req, other.res, other.next)
    const missing = call({ actor: "cus_buyer", id: "ordset_missing", rows: [] })
    await requireOrderSetBuyer(missing.req, missing.res, missing.next)

    for (const { next, sent } of [other, missing]) {
      expect(next).not.toHaveBeenCalled()
      expect([sent.status, sent.body]).toEqual([403, refusal])
    }
  })

  it("refuses a set with no buyer on record rather than give it to anyone", async () => {
    const { req, res, next, sent } = call({ actor: "cus_buyer", rows: [{ id: "ordset_1", customer_id: null }] })
    await requireOrderSetBuyer(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(sent.status).toBe(403)
  })

  it("refuses a call with no customer at all, even if one got past authentication", async () => {
    const { req, res, next, sent, graph } = call({})
    await requireOrderSetBuyer(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(sent.status).toBe(403)
    expect(graph).not.toHaveBeenCalled()
  })
})

describe("where it is mounted", () => {
  it("asks for a customer on Mercur's two order-set reads, and for the buyer on the one by id", () => {
    expect(storeOrderSetOwnerMiddlewares.map((route) => [route.method, route.matcher, route.middlewares?.length])).toEqual([
      [["GET"], "/store/order-set", 1],
      [["GET"], "/store/order-set/:id", 2],
    ])
    const [, byId] = storeOrderSetOwnerMiddlewares
    expect(byId.middlewares?.[1]).toBe(requireOrderSetBuyer)
    // Spread with the field guard, through the one list middlewares.ts imports.
    for (const route of storeOrderSetOwnerMiddlewares) expect(storePublicFieldsMiddlewares).toContain(route)
  })
})
