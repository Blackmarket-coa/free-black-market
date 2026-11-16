/**
 * `/vendor/deliveries`: one refusal, and no proof PIN (SD-107).
 *
 * Seen on Postgres before this change, as a seller with a producer profile:
 * GET and POST `/vendor/deliveries/:id` answered 404 "FoodDelivery with id: …
 * was not found" for an id that does not exist and 403 "This delivery does
 * not belong to your store" for another store's, which told any seller which
 * delivery ids are real. The list, the detail and the POST echo also returned
 * `proof_pin_code`, the one field every /store delivery response strips.
 *
 * `integration-tests/http/store-food-network-write-authz.spec.ts` has the
 * refusal pair and the PIN through real seller tokens and tables.
 */
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { GET as listDeliveries } from "../route"
import { GET as getDelivery, POST as updateDelivery } from "../[id]/route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"

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

// sel_a's producer is prd_a; the delivery below is prd_a's.
const PRODUCER_OF: Record<string, string> = { sel_a: "prd_a", sel_b: "prd_b" }
const DELIVERY = {
  id: "del_1",
  producer_id: "prd_a",
  status: "PENDING",
  status_history: null,
  delivery_address: "9 Vendor Home St",
  recipient_phone: "+15550177",
  proof_pin_code: "9911",
}

const setup = (opts: {
  sellerId: string
  deliveryId?: string
  body?: Record<string, unknown>
  lookupFails?: Error
}) => {
  const service = {
    listFoodProducers: jest.fn(async (filters: { seller_id: string }) =>
      PRODUCER_OF[filters.seller_id] ? [{ id: PRODUCER_OF[filters.seller_id] }] : []
    ),
    // A missing delivery is a thrown not-found, as the module answers it.
    retrieveFoodDelivery: jest.fn(async (id: string) => {
      if (opts.lookupFails) throw opts.lookupFails
      if (id !== DELIVERY.id) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, `FoodDelivery with id: ${id} was not found`)
      }
      return DELIVERY
    }),
    listFoodDeliveries: jest.fn(async () => [DELIVERY]),
    // The selector form answers with a list.
    updateFoodDeliveries: jest.fn(async (update: { data: Record<string, unknown> }) => [
      { ...DELIVERY, ...update.data },
    ]),
  }
  const req = {
    params: { id: opts.deliveryId ?? DELIVERY.id },
    query: {},
    body: opts.body ?? {},
    headers: {},
    // `requireSellerId` takes a sel_ actor id as the seller.
    auth_context: { actor_id: opts.sellerId, actor_type: "seller" },
    scope: {
      resolve: (key: string) => {
        if (key === FOOD_DISTRIBUTION_MODULE) return service
        // Resolved by `requireSellerId` before it reads the actor id; unused
        // for a sel_ actor. Keyed on the framework's constants.
        if (key === ContainerRegistrationKeys.PG_CONNECTION || key === Modules.AUTH) return undefined
        throw new Error(`unresolvable: ${String(key)}`)
      },
    },
  }
  return { req: req as never, service, res: createRes() }
}

describe.each([
  ["GET", getDelivery, {}],
  ["POST", updateDelivery, { status: "WAITING_FOR_ORDER" }],
] as const)("%s /vendor/deliveries/:id", (_verb, handler, body) => {
  it("refuses another store's delivery and one that does not exist alike", async () => {
    const anothers = setup({ sellerId: "sel_b", body })
    await handler(anothers.req, anothers.res as never)
    const missing = setup({ sellerId: "sel_b", deliveryId: "del_nope", body })
    await handler(missing.req, missing.res as never)

    expect([anothers.res.statusCode, anothers.res.body]).toEqual([403, REFUSAL])
    expect([missing.res.statusCode, missing.res.body]).toEqual([403, REFUSAL])
    expect(anothers.service.updateFoodDeliveries).not.toHaveBeenCalled()
    expect(JSON.stringify(anothers.res.body)).not.toContain("Vendor Home")
  })

  it("refuses the store's own seller a delivery that does not exist the same way", async () => {
    const { req, res } = setup({ sellerId: "sel_a", deliveryId: "del_nope", body })

    await handler(req, res as never)

    expect([res.statusCode, res.body]).toEqual([403, REFUSAL])
  })

  it("serves the store's own delivery, without the proof PIN", async () => {
    const { req, res } = setup({ sellerId: "sel_a", body })

    await handler(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.body)).toContain("9 Vendor Home St")
    expect(JSON.stringify(res.body)).not.toContain("proof_pin_code")
    expect(JSON.stringify(res.body)).not.toContain("9911")
  })

  it("does not turn a failed lookup into a refusal", async () => {
    const { req, res } = setup({ sellerId: "sel_a", body, lookupFails: new Error("connection terminated") })

    await expect(handler(req, res as never)).rejects.toThrow("connection terminated")
  })
})

describe("POST /vendor/deliveries/:id", () => {
  it("writes the status for the store's own delivery and keeps the response a list", async () => {
    const { req, res, service } = setup({ sellerId: "sel_a", body: { status: "WAITING_FOR_ORDER", note: "bagged" } })

    await updateDelivery(req, res as never)

    expect(service.updateFoodDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ selector: { id: "del_1" } })
    )
    const { delivery } = res.body as { delivery: Array<Record<string, unknown>> }
    expect(delivery).toHaveLength(1)
    expect(delivery[0]).toMatchObject({ id: "del_1", status: "WAITING_FOR_ORDER" })
  })
})

describe("GET /vendor/deliveries", () => {
  it("lists the store's deliveries without the proof PIN", async () => {
    const { req, res } = setup({ sellerId: "sel_a" })

    await listDeliveries(req, res as never)

    expect(res.statusCode).toBe(200)
    const { deliveries } = res.body as { deliveries: Array<Record<string, unknown>> }
    expect(deliveries[0]).toMatchObject({ id: "del_1", delivery_address: "9 Vendor Home St" })
    expect(deliveries[0]).not.toHaveProperty("proof_pin_code")
  })
})
