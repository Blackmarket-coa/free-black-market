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
 *
 * And the status update itself (SD-119 (1)). The POST appended to
 * `status_history` on its own, as a bare list, where the service stores
 * `{ entries }`: 500 "existingHistory is not iterable" on every delivery the
 * service had created, and a list written onto a delivery with no history.
 * It now changes the status through the service's `updateDeliveryStatus`.
 * The service's real method runs in the cases below, on the fake rows, so
 * they fail on the old handler the way the route did;
 * `integration-tests/http/store-food-network-owner-reads.spec.ts` has it on
 * Postgres, on a delivery made by `POST /store/food-deliveries`.
 */
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { GET as listDeliveries } from "../route"
import { GET as getDelivery, POST as updateDelivery } from "../[id]/route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import FoodDistributionService from "../../../../modules/food-distribution/service"

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

const STARTED = { status: "PENDING", timestamp: "2026-11-16T09:00:00.000Z" }

const setup = (opts: {
  sellerId: string
  deliveryId?: string
  body?: Record<string, unknown>
  lookupFails?: Error
  /** What the row's `status_history` holds; none by default. */
  history?: unknown
}) => {
  const stored = { ...DELIVERY, status_history: opts.history ?? null }
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
      return stored
    }),
    listFoodDeliveries: jest.fn(async () => [stored]),
    // Answers with the row as updated: one row for the single-row form the
    // service uses, a list for the selector form the old handler used.
    updateFoodDeliveries: jest.fn(async (update: Record<string, unknown>) =>
      "selector" in update
        ? [{ ...stored, ...(update.data as Record<string, unknown>) }]
        : { ...stored, ...update }
    ),
    logDeliveryEvent: jest.fn(async () => ({})),
    // The service's real status method, over the fakes above.
    updateDeliveryStatus: jest.fn((...args: Parameters<FoodDistributionService["updateDeliveryStatus"]>) =>
      FoodDistributionService.prototype.updateDeliveryStatus.apply(
        service as unknown as FoodDistributionService,
        args
      )
    ),
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
    expect(anothers.service.updateDeliveryStatus).not.toHaveBeenCalled()
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
  const BODY = { status: "WAITING_FOR_ORDER", note: "bagged" }
  const written = (service: ReturnType<typeof setup>["service"]) =>
    (service.updateFoodDeliveries.mock.calls[0] as unknown as [Record<string, unknown>])[0]

  it("changes the status through the service's own method, as the vendor", async () => {
    const { req, res, service } = setup({ sellerId: "sel_a", body: BODY })

    await updateDelivery(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(service.updateDeliveryStatus).toHaveBeenCalledTimes(1)
    expect(service.updateDeliveryStatus).toHaveBeenCalledWith("del_1", "WAITING_FOR_ORDER", undefined, "bagged", {
      actor: "vendor",
      actor_type: "PRODUCER",
      actor_id: "sel_a",
    })
  })

  it.each([
    // Every delivery POST /store/food-deliveries creates: this was the 500
    // "existingHistory is not iterable".
    ["one the service started", { entries: [STARTED] }, [STARTED]],
    // What this handler wrote onto a delivery that had no history.
    ["a bare list left by this route", [STARTED], [STARTED]],
    ["none", null, []],
  ])("appends to a history that is %s, and stores it as { entries }", async (_what, history, before) => {
    const { req, res, service } = setup({ sellerId: "sel_a", body: BODY, history })

    await updateDelivery(req, res as never)

    expect(res.statusCode).toBe(200)
    // One write, of the service's shape, with the vendor's entry last.
    expect(service.updateFoodDeliveries).toHaveBeenCalledTimes(1)
    const row = written(service)
    expect(row).toMatchObject({ id: "del_1", status: "WAITING_FOR_ORDER" })
    const stored = row.status_history as { entries: Array<Record<string, unknown>> }
    expect(Array.isArray(stored)).toBe(false)
    expect(stored.entries.slice(0, -1)).toEqual(before)
    expect(stored.entries[stored.entries.length - 1]).toMatchObject({
      status: "WAITING_FOR_ORDER",
      note: "bagged",
      actor: "vendor",
    })
    // The event the service saves for every status change.
    expect(service.logDeliveryEvent).toHaveBeenCalledWith(
      "del_1",
      expect.objectContaining({ previous_status: "PENDING", new_status: "WAITING_FOR_ORDER", actor_type: "PRODUCER" })
    )
  })

  it("answers with the delivery, its history the list the panel reads, and no PIN", async () => {
    const { req, res } = setup({ sellerId: "sel_a", body: BODY, history: { entries: [STARTED] } })

    await updateDelivery(req, res as never)

    const { delivery } = res.body as { delivery: Record<string, unknown> }
    expect(Array.isArray(delivery)).toBe(false)
    expect(delivery).toMatchObject({ id: "del_1", status: "WAITING_FOR_ORDER" })
    expect(delivery.status_history).toEqual([
      STARTED,
      expect.objectContaining({ status: "WAITING_FOR_ORDER", note: "bagged", actor: "vendor" }),
    ])
    expect(delivery).not.toHaveProperty("proof_pin_code")
  })

  it("stamps the time a picked-up order stands for, as the service does on every path", async () => {
    const { req, res, service } = setup({ sellerId: "sel_a", body: { status: "ORDER_PICKED_UP" } })

    await updateDelivery(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(written(service).picked_up_at).toBeInstanceOf(Date)
  })
})

describe("the status history on the vendor reads", () => {
  it.each([
    ["the stored shape", { entries: [STARTED] }, [STARTED]],
    ["a bare list", [STARTED], [STARTED]],
    ["none", null, null],
  ])("is served as a list from %s, by the detail and by the list", async (_what, history, served) => {
    const detail = setup({ sellerId: "sel_a", history })
    await getDelivery(detail.req, detail.res as never)
    const list = setup({ sellerId: "sel_a", history })
    await listDeliveries(list.req, list.res as never)

    expect((detail.res.body as { delivery: Record<string, unknown> }).delivery.status_history).toEqual(served)
    expect((list.res.body as { deliveries: Array<Record<string, unknown>> }).deliveries[0].status_history).toEqual(
      served
    )
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
