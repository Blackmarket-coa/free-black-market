/**
 * Who may batch a delivery, list batches and write a batch (SD-107).
 *
 * `/store/delivery-batches` is behind FF_PICK_PACK_V1 (off by default). With
 * it on, seen on Postgres before this change: any signed-in account could
 * batch someone else's delivery and was handed the row with its address and
 * proof PIN (201), add another to its batch (200), write a sequence onto a
 * delivery in no batch of its own through `optimized_route` (200), and every
 * batch was listed to a caller with no account; a missing id answered 404
 * beside a real one's 403 or 200 on each of those verbs.
 *
 * The interim rule pinned here needs no ruling: a caller batches only a
 * delivery they may already read. Who SHOULD be able to batch is still the
 * operator's. `integration-tests/http/store-food-network-write-authz.spec.ts`
 * has the same cases through the real middleware and tables.
 */
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { GET as listBatches, POST as createBatch } from "../route"
import { PUT as updateBatch, POST as addDeliveries, DELETE as cancelBatch } from "../[id]/route"
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

// cus_producer owns the producer of both deliveries below; cus_driver owns
// cour_1; cus_stranger owns nothing here.
const PRODUCERS = [{ id: "prd_1", owner_id: "cus_producer" }]
const COURIERS = [{ id: "cour_1", owner_id: "cus_driver", active: true }]
const DELIVERIES: Record<string, Record<string, unknown>> = {
  del_1: {
    id: "del_1",
    producer_id: "prd_1",
    courier_id: null,
    order_id: "fo_1",
    batch_id: null,
    delivery_address: "12 Elm Street",
    recipient_phone: "+15550199",
    proof_pin_code: "4821",
  },
  del_2: {
    id: "del_2",
    producer_id: "prd_1",
    courier_id: null,
    order_id: "fo_2",
    batch_id: null,
    delivery_address: "40 Oak Avenue",
    proof_pin_code: "7305",
  },
  del_taken: {
    id: "del_taken",
    producer_id: "prd_1",
    courier_id: null,
    order_id: "fo_3",
    batch_id: "bat_other",
    delivery_address: "7 Pine Road",
  },
}
const BATCH = { id: "bat_1", owner_id: "cus_planner", courier_id: null, status: "PLANNING" }

const notFound = (what: string, id: string) =>
  new MedusaError(MedusaError.Types.NOT_FOUND, `${what} with id: ${id} was not found`)

const setup = (opts: {
  actorId?: string
  params?: Record<string, string>
  query?: Record<string, unknown>
  body?: Record<string, unknown>
  batch?: Record<string, unknown> | null
  inBatch?: string[]
  lookupFails?: Error
}) => {
  const service = {
    // Missing rows are thrown not-founds, as the module answers them.
    retrieveFoodDelivery: jest.fn(async (id: string) => {
      if (opts.lookupFails) throw opts.lookupFails
      if (!DELIVERIES[id]) throw notFound("FoodDelivery", id)
      return DELIVERIES[id]
    }),
    retrieveDeliveryBatch: jest.fn(async (id: string) => {
      if (opts.lookupFails) throw opts.lookupFails
      if (opts.batch === null) throw notFound("FoodDeliveryBatch", id)
      return opts.batch ?? BATCH
    }),
    listCouriers: jest.fn(async (filters: { id?: string }) =>
      COURIERS.filter((courier) => courier.id === filters.id)
    ),
    retrieveCourier: jest.fn(async (id: string) => COURIERS.find((courier) => courier.id === id)),
    createDeliveryBatch: jest.fn(async () => ({ id: "bat_new", status: "PLANNING" })),
    listFoodDeliveries: jest.fn(async (filters: { batch_id?: string }, config?: { select?: string[] }) => {
      const rows = filters.batch_id === "bat_new" ? [DELIVERIES.del_1] : (opts.inBatch ?? []).map((id) => DELIVERIES[id])
      return config?.select ? rows.map((row) => ({ id: row.id })) : rows
    }),
    listDeliveryBatches: jest.fn(async () => [BATCH]),
    updateFoodDeliveries: jest.fn(async (data: unknown) => data),
    // Answers with the row as stored, the way the module does.
    updateDeliveryBatches: jest.fn(async (data: Record<string, unknown>) => ({ ...(opts.batch ?? BATCH), ...data })),
  }
  const req = {
    params: opts.params ?? { id: "bat_1" },
    query: opts.query ?? {},
    body: opts.body ?? {},
    ...(opts.actorId ? { auth_context: { actor_id: opts.actorId, actor_type: "customer" } } : {}),
    scope: {
      resolve: (key: string) => {
        if (key === FOOD_DISTRIBUTION_MODULE) return service
        if (key === ContainerRegistrationKeys.QUERY) {
          return {
            graph: async ({ entity, filters }: { entity: string; filters: { id?: string } }) => ({
              data:
                entity === "food_producer"
                  ? PRODUCERS.filter((row) => row.id === filters.id)
                  : // No order here has a customer on it: nobody is a recipient.
                    [],
            }),
          }
        }
        throw new Error(`unresolvable: ${String(key)}`)
      },
    },
  }
  return { req: req as never, service, res: createRes() }
}

describe("GET /store/delivery-batches — the caller's own batches", () => {
  it("refuses a caller with no account, without reading a batch", async () => {
    const { req, res, service } = setup({})

    await listBatches(req, res as never)

    expect([res.statusCode, res.body]).toEqual([403, REFUSAL])
    expect(service.listDeliveryBatches).not.toHaveBeenCalled()
  })

  it("lists only the batches the caller planned", async () => {
    const { req, res, service } = setup({ actorId: "cus_planner", query: { status: "PLANNING" } })

    await listBatches(req, res as never)

    expect(res.statusCode).toBe(200)
    // Both the page and the count are scoped.
    expect(service.listDeliveryBatches).toHaveBeenCalledTimes(2)
    for (const [filters] of service.listDeliveryBatches.mock.calls as unknown as Array<[unknown]>) {
      expect(filters).toEqual({ status: "PLANNING", owner_id: "cus_planner" })
    }
  })

  it("lists a courier's runs to that courier's owner, whoever planned them", async () => {
    const { req, res, service } = setup({ actorId: "cus_driver", query: { courier_id: "cour_1" } })

    await listBatches(req, res as never)

    expect(res.statusCode).toBe(200)
    expect((service.listDeliveryBatches.mock.calls as unknown as Array<[unknown]>)[0][0]).toEqual({
      courier_id: "cour_1",
    })
  })

  it("does not widen to a courier the caller does not own", async () => {
    const { req, res, service } = setup({ actorId: "cus_stranger", query: { courier_id: "cour_1" } })

    await listBatches(req, res as never)

    expect(res.statusCode).toBe(200)
    for (const [filters] of service.listDeliveryBatches.mock.calls as unknown as Array<[unknown]>) {
      expect(filters).toEqual({ courier_id: "cour_1", owner_id: "cus_stranger" })
    }
  })
})

describe("POST /store/delivery-batches — only deliveries the caller may already read", () => {
  it("refuses someone else's delivery and one that does not exist alike, and creates nothing", async () => {
    const foreign = setup({ actorId: "cus_stranger", body: { delivery_ids: ["del_1"] } })
    await createBatch(foreign.req, foreign.res as never)
    const missing = setup({ actorId: "cus_stranger", body: { delivery_ids: ["del_nope"] } })
    await createBatch(missing.req, missing.res as never)

    expect([foreign.res.statusCode, foreign.res.body]).toEqual([403, REFUSAL])
    expect([missing.res.statusCode, missing.res.body]).toEqual([403, REFUSAL])
    expect(foreign.service.createDeliveryBatch).not.toHaveBeenCalled()
    expect(missing.service.createDeliveryBatch).not.toHaveBeenCalled()
    expect(JSON.stringify(foreign.res.body)).not.toContain("Elm Street")
  })

  it("refuses the whole request when one delivery among the caller's own is missing", async () => {
    const { req, res, service } = setup({
      actorId: "cus_producer",
      body: { delivery_ids: ["del_1", "del_nope"] },
    })

    await createBatch(req, res as never)

    expect([res.statusCode, res.body]).toEqual([403, REFUSAL])
    expect(service.createDeliveryBatch).not.toHaveBeenCalled()
  })

  it("tells only someone entitled to a delivery that it is already in a batch", async () => {
    const entitled = setup({ actorId: "cus_producer", body: { delivery_ids: ["del_taken"] } })
    await createBatch(entitled.req, entitled.res as never)
    const stranger = setup({ actorId: "cus_stranger", body: { delivery_ids: ["del_taken"] } })
    await createBatch(stranger.req, stranger.res as never)

    expect([entitled.res.statusCode, entitled.res.body]).toEqual([
      400,
      { message: "Delivery del_taken is already part of a batch" },
    ])
    expect([stranger.res.statusCode, stranger.res.body]).toEqual([403, REFUSAL])
  })

  it("batches the caller's own deliveries, and answers without the PIN", async () => {
    const { req, res, service } = setup({ actorId: "cus_producer", body: { delivery_ids: ["del_1"] } })

    await createBatch(req, res as never)

    expect(res.statusCode).toBe(201)
    expect(service.createDeliveryBatch).toHaveBeenCalledWith(["del_1"], undefined, undefined, undefined, {
      id: "cus_producer",
      type: "customer",
    })
    const [delivery] = (res.body as { batch: { deliveries: Array<Record<string, unknown>> } }).batch.deliveries
    expect(delivery.delivery_address).toBe("12 Elm Street")
    expect(delivery).not.toHaveProperty("proof_pin_code")
    expect(JSON.stringify(res.body)).not.toContain("4821")
  })

  it("does not turn a failed lookup into a refusal", async () => {
    const { req, res } = setup({
      actorId: "cus_producer",
      body: { delivery_ids: ["del_1"] },
      lookupFails: new Error("connection terminated"),
    })

    await expect(createBatch(req, res as never)).rejects.toThrow("connection terminated")
  })

  it("counts a delivery named twice once", async () => {
    // The ids were passed on as sent, so the batch was created with
    // `total_deliveries` 2 for one delivery, which was written twice.
    const { req, res, service } = setup({ actorId: "cus_producer", body: { delivery_ids: ["del_1", "del_1"] } })

    await createBatch(req, res as never)

    expect(res.statusCode).toBe(201)
    expect(service.createDeliveryBatch).toHaveBeenCalledWith(["del_1"], undefined, undefined, undefined, {
      id: "cus_producer",
      type: "customer",
    })
    expect(service.retrieveFoodDelivery).toHaveBeenCalledTimes(1)
  })
})

describe("the write verbs on /store/delivery-batches/:id", () => {
  const VERBS = [
    ["PUT", updateBatch, { notes: "x" }],
    ["POST", addDeliveries, { delivery_ids: ["del_1"] }],
    ["DELETE", cancelBatch, {}],
  ] as const

  it.each(VERBS)("%s refuses someone else's batch and one that does not exist alike", async (_verb, handler, body) => {
    const foreign = setup({ actorId: "cus_stranger", body })
    await handler(foreign.req, foreign.res as never)
    const missing = setup({ actorId: "cus_stranger", body, batch: null })
    await handler(missing.req, missing.res as never)

    expect([foreign.res.statusCode, foreign.res.body]).toEqual([403, REFUSAL])
    expect([missing.res.statusCode, missing.res.body]).toEqual([403, REFUSAL])
    for (const { service } of [foreign, missing]) {
      expect(service.updateDeliveryBatches).not.toHaveBeenCalled()
      expect(service.updateFoodDeliveries).not.toHaveBeenCalled()
    }
  })

  it.each(VERBS)("%s does not turn a failed lookup into a refusal", async (_verb, handler, body) => {
    const { req, res } = setup({ actorId: "cus_planner", body, lookupFails: new Error("connection terminated") })

    await expect(handler(req, res as never)).rejects.toThrow("connection terminated")
  })

  it("PUT and DELETE still serve the batch's planner", async () => {
    const put = setup({ actorId: "cus_planner", body: { notes: "back door" } })
    await updateBatch(put.req, put.res as never)
    expect(put.res.statusCode).toBe(200)
    expect(put.service.updateDeliveryBatches).toHaveBeenCalledWith({ id: "bat_1", notes: "back door" })

    const del = setup({ actorId: "cus_planner" })
    await cancelBatch(del.req, del.res as never)
    expect([del.res.statusCode, del.res.body]).toEqual([200, { success: true, id: "bat_1" }])
  })
})

describe("POST /store/delivery-batches/:id — adding deliveries", () => {
  // The batch's planner is the producer's owner here, so only the delivery
  // named decides the answer.
  const OWN_BATCH = { ...BATCH, owner_id: "cus_producer" }
  const STRANGERS_BATCH = { ...BATCH, owner_id: "cus_stranger" }

  it("refuses someone else's delivery and one that does not exist alike", async () => {
    const foreign = setup({ actorId: "cus_stranger", batch: STRANGERS_BATCH, body: { delivery_ids: ["del_1"] } })
    await addDeliveries(foreign.req, foreign.res as never)
    const missing = setup({ actorId: "cus_stranger", batch: STRANGERS_BATCH, body: { delivery_ids: ["del_nope"] } })
    await addDeliveries(missing.req, missing.res as never)

    expect([foreign.res.statusCode, foreign.res.body]).toEqual([403, REFUSAL])
    expect([missing.res.statusCode, missing.res.body]).toEqual([403, REFUSAL])
    expect(foreign.service.updateFoodDeliveries).not.toHaveBeenCalled()
  })

  it("writes nothing when a later delivery in the request is refused", async () => {
    // The loop used to move each delivery into the batch before it looked at
    // the next, so a refused request had already taken the ones before it.
    const { req, res, service } = setup({
      actorId: "cus_producer",
      batch: OWN_BATCH,
      body: { delivery_ids: ["del_1", "del_nope"] },
    })

    await addDeliveries(req, res as never)

    expect([res.statusCode, res.body]).toEqual([403, REFUSAL])
    expect(service.updateFoodDeliveries).not.toHaveBeenCalled()
    expect(service.updateDeliveryBatches).not.toHaveBeenCalled()
  })

  it("adds the caller's own deliveries, in sequence after the ones already there", async () => {
    const { req, res, service } = setup({
      actorId: "cus_producer",
      batch: OWN_BATCH,
      inBatch: ["del_2"],
      body: { delivery_ids: ["del_1"] },
    })

    await addDeliveries(req, res as never)

    expect([res.statusCode, res.body]).toEqual([200, { success: true, total_deliveries: 2 }])
    expect(service.updateFoodDeliveries).toHaveBeenCalledWith({ id: "del_1", batch_id: "bat_1", batch_sequence: 2 })
  })

  it("adds a delivery named twice once, with one place in the sequence", async () => {
    // It was written twice and the batch total counted it twice: 3 here.
    const { req, res, service } = setup({
      actorId: "cus_producer",
      batch: OWN_BATCH,
      inBatch: ["del_2"],
      body: { delivery_ids: ["del_1", "del_1"] },
    })

    await addDeliveries(req, res as never)

    expect([res.statusCode, res.body]).toEqual([200, { success: true, total_deliveries: 2 }])
    expect(service.updateFoodDeliveries).toHaveBeenCalledTimes(1)
    expect(service.updateFoodDeliveries).toHaveBeenCalledWith({ id: "del_1", batch_id: "bat_1", batch_sequence: 2 })
    expect(service.updateDeliveryBatches).toHaveBeenCalledWith({ id: "bat_1", total_deliveries: 2 })
  })

  it("tells the entitled caller that a delivery is already in a batch", async () => {
    const { req, res, service } = setup({
      actorId: "cus_producer",
      batch: OWN_BATCH,
      body: { delivery_ids: ["del_taken"] },
    })

    await addDeliveries(req, res as never)

    expect([res.statusCode, res.body]).toEqual([400, { message: "Delivery del_taken is already in a batch" }])
    expect(service.updateFoodDeliveries).not.toHaveBeenCalled()
  })

  it("refuses to add to a batch with no recorded owner, even a delivery the caller may read", async () => {
    // `actorMayManage` let any signed-in account add to such a batch. Seen on
    // Postgres, flag on: a recipient added their own delivery to a batch of
    // three they are refused on GET and was answered `total_deliveries: 4`,
    // with `batch_sequence` 4 written onto the delivery they read back.
    // cus_producer may read del_1, so only the batch decides the answer here.
    for (const status of ["PLANNING", "IN_PROGRESS"]) {
      const { req, res, service } = setup({
        actorId: "cus_producer",
        batch: { ...BATCH, owner_id: null, status },
        inBatch: ["del_2"],
        body: { delivery_ids: ["del_1"] },
      })

      await addDeliveries(req, res as never)

      // One refusal: not the size of the run, and not its status either.
      expect([status, res.statusCode, res.body]).toEqual([status, 403, REFUSAL])
      expect(service.updateFoodDeliveries).not.toHaveBeenCalled()
      expect(service.updateDeliveryBatches).not.toHaveBeenCalled()
      // Refused on the batch alone, before a delivery or the run is read.
      expect(service.retrieveFoodDelivery).not.toHaveBeenCalled()
      expect(service.listFoodDeliveries).not.toHaveBeenCalled()
    }
  })

  it("does not let the courier's owner of such a batch add to it either", async () => {
    const { req, res, service } = setup({
      actorId: "cus_driver",
      batch: { ...BATCH, owner_id: null, courier_id: "cour_1" },
      body: { delivery_ids: ["del_1"] },
    })

    await addDeliveries(req, res as never)

    expect([res.statusCode, res.body]).toEqual([403, REFUSAL])
    expect(service.updateFoodDeliveries).not.toHaveBeenCalled()
  })
})

describe("PUT /store/delivery-batches/:id — what a batch write reaches", () => {
  it("refuses a route entry for a delivery that is not in this batch, real or not, and writes nothing", async () => {
    // It wrote `batch_sequence` and an arrival time onto whatever delivery id
    // the entry named: 200 for a real one, 404 for a missing one.
    for (const deliveryId of ["del_2", "del_nope"]) {
      const { req, res, service } = setup({
        actorId: "cus_planner",
        inBatch: ["del_1"],
        body: { optimized_route: [{ delivery_id: "del_1", sequence: 1 }, { delivery_id: deliveryId, sequence: 2 }] },
      })

      await updateBatch(req, res as never)

      expect([deliveryId, res.statusCode, res.body]).toEqual([deliveryId, 403, REFUSAL])
      expect(service.updateFoodDeliveries).not.toHaveBeenCalled()
      expect(service.updateDeliveryBatches).not.toHaveBeenCalled()
    }
  })

  it("sequences the deliveries that are in the batch", async () => {
    const { req, res, service } = setup({
      actorId: "cus_planner",
      inBatch: ["del_1", "del_2"],
      body: { optimized_route: [{ delivery_id: "del_2", sequence: 1 }, { delivery_id: "del_1", sequence: 2 }] },
    })

    await updateBatch(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(service.updateFoodDeliveries).toHaveBeenCalledTimes(2)
    expect(service.updateFoodDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ id: "del_2", batch_sequence: 1 })
    )
  })

  it("lets only the batch's recorded owner assign its courier", async () => {
    // The courier's owner is served every address in the batch by GET. On a
    // batch with no owner on record any signed-in account passes
    // `actorMayManage`, so it could name its own courier and read the run.
    const legacy = setup({
      actorId: "cus_driver",
      batch: { ...BATCH, owner_id: null },
      body: { courier_id: "cour_1" },
    })
    await updateBatch(legacy.req, legacy.res as never)
    expect([legacy.res.statusCode, legacy.res.body]).toEqual([403, REFUSAL])
    expect(legacy.service.updateDeliveryBatches).not.toHaveBeenCalled()

    const planner = setup({ actorId: "cus_planner", body: { courier_id: "cour_1" } })
    await updateBatch(planner.req, planner.res as never)
    expect(planner.res.statusCode).toBe(200)
    expect(planner.service.updateDeliveryBatches).toHaveBeenCalledWith({
      id: "bat_1",
      courier_id: "cour_1",
      status: "ASSIGNED",
    })
  })

  it("leaves the other writes on a batch with no recorded owner as they were", async () => {
    const { req, res, service } = setup({
      actorId: "cus_anyone",
      batch: { ...BATCH, owner_id: null },
      body: { notes: "legacy" },
    })

    await updateBatch(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(service.updateDeliveryBatches).toHaveBeenCalledWith({ id: "bat_1", notes: "legacy" })
  })
})

describe("PUT /store/delivery-batches/:id — what a batch write tells its caller", () => {
  // A run as the table holds it: the route names every delivery in it.
  const RUN = {
    ...BATCH,
    courier_id: "cour_1",
    notes: "leave at the side gate",
    optimized_route: [{ delivery_id: "del_1", sequence: 1 }, { delivery_id: "del_2", sequence: 2 }],
  }

  it("acknowledges a write on a batch with no recorded owner with its id and status, not the row", async () => {
    // `actorMayManage` lets any signed-in account write such a batch
    // (grandfathered), and GET refuses them the batch. Seen on Postgres, flag
    // on: a stranger's empty PUT returned the whole row, `optimized_route`
    // and the ids of the deliveries in it included.
    const { req, res, service } = setup({ actorId: "cus_anyone", batch: { ...RUN, owner_id: null }, body: {} })

    await updateBatch(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(service.updateDeliveryBatches).toHaveBeenCalledWith({ id: "bat_1" })
    expect(res.body).toEqual({ batch: { id: "bat_1", status: "PLANNING" } })
    for (const value of ["del_1", "del_2", "cour_1", "side gate"]) {
      expect(JSON.stringify(res.body)).not.toContain(value)
    }
  })

  it("does not echo the row to the courier's owner on such a batch either", async () => {
    // They read the run through GET, which redacts it; the echo here is the
    // recorded owner's and nobody else's.
    const { req, res } = setup({ actorId: "cus_driver", batch: { ...RUN, owner_id: null }, body: { notes: "x" } })

    await updateBatch(req, res as never)

    expect([res.statusCode, res.body]).toEqual([200, { batch: { id: "bat_1", status: "PLANNING" } }])
  })

  it("echoes the row to the batch's recorded owner", async () => {
    const { req, res } = setup({ actorId: "cus_planner", batch: RUN, body: { notes: "front door" } })

    await updateBatch(req, res as never)

    expect(res.statusCode).toBe(200)
    expect((res.body as { batch: Record<string, unknown> }).batch).toMatchObject({
      id: "bat_1",
      owner_id: "cus_planner",
      courier_id: "cour_1",
      notes: "front door",
      optimized_route: RUN.optimized_route,
    })
  })

  it("refuses a route entry on a batch with no recorded owner, whether or not the delivery is in it", async () => {
    // It answered 200 for a delivery in the batch and 403 for one outside it,
    // which told the caller what the batch holds, and it rewrote the sequence
    // and arrival time of deliveries the caller may not read.
    for (const deliveryId of ["del_1", "del_2", "del_nope"]) {
      const { req, res, service } = setup({
        actorId: "cus_anyone",
        batch: { ...RUN, owner_id: null },
        inBatch: ["del_1"],
        body: { optimized_route: [{ delivery_id: deliveryId, sequence: 9 }] },
      })

      await updateBatch(req, res as never)

      expect([deliveryId, res.statusCode, res.body]).toEqual([deliveryId, 403, REFUSAL])
      expect(service.updateFoodDeliveries).not.toHaveBeenCalled()
      expect(service.updateDeliveryBatches).not.toHaveBeenCalled()
      // Refused before the batch's deliveries are read at all.
      expect(service.listFoodDeliveries).not.toHaveBeenCalled()
    }
  })
})
