import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { GET as listCouriers } from "../route"
import { GET as getCourier, PUT as updateCourier, POST as claimDelivery } from "../[id]/route"
import { GET as listShifts } from "../[id]/shifts/route"
import { GET as getDeliveryBatch } from "../../delivery-batches/[id]/route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"

/**
 * The two unauthenticated courier reads (D10-5).
 *
 * Both served the `food_courier` row verbatim to any caller. The projection
 * lives in `modules/food-distribution/public-view.ts` and is unit-tested
 * there; these pin that the routes actually apply it, and that the owner
 * branch on the detail route is keyed on ownership rather than on merely
 * being signed in.
 *
 * The detail route also returned every delivery the courier was carrying,
 * whole, on both branches (SD-106): this file pinned that ("still reports
 * active deliveries on both branches") against an empty list, so it never
 * saw what the rows held. The cases below seed a delivery.
 */
const ROW: Record<string, unknown> & { owner_id: string | null } = {
  id: "cour_1",
  first_name: "Ada",
  display_name: "Ada O.",
  email: "ada@example.com",
  phone: "+15551234567",
  emergency_contact_phone: "+15559876543",
  current_latitude: 41.8781,
  total_earnings: 421050,
  vehicle_type: "EBIKE",
  status: "AVAILABLE",
  owner_id: "cus_owner",
}

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res: TestRes = {
    statusCode: 200,
    body: {},
    status: (code: number) => {
      res.statusCode = code
      return res
    },
    json: (payload: unknown) => {
      res.body = (payload ?? {}) as Record<string, unknown>
      return res
    },
  }
  return res
}

/** One delivery the courier is carrying, as the table holds it. */
const DELIVERY = {
  id: "del_active_1",
  order_id: "fo_1",
  producer_id: "prd_1",
  courier_id: "cour_1",
  status: "ASSIGNED",
  delivery_address: "12 Elm Street, Apt 4",
  recipient_name: "Rita Recipient",
  recipient_phone: "+15550199",
  delivery_instructions: "gate code 99",
  delivery_latitude: 41.87,
  proof_pin_code: "4821",
}
/** Everything in DELIVERY a stranger must not be handed, the id included. */
const DELIVERY_VALUES = [
  "del_active_1",
  "fo_1",
  "12 Elm Street",
  "Rita Recipient",
  "+15550199",
  "gate code 99",
  "4821",
]

const makeReq = (opts: {
  actorId?: string | null
  query?: Record<string, unknown>
  body?: Record<string, unknown>
  /** food_producer / food_order rows Query serves to the ownership lookups. */
  rows?: Record<string, Array<Record<string, unknown>>>
}) => {
  const service = {
    // `listCouriers` also backs `actorOwnsCourier`, which filters by id.
    listCouriers: jest.fn(async (filters?: { id?: string }) =>
      filters?.id && filters.id !== ROW.id ? [] : [ROW]
    ),
    retrieveCourier: jest.fn(async (): Promise<Record<string, unknown>> => ROW),
    // The real list honours `select`: a caller that asks for ids gets ids.
    listFoodDeliveries: jest.fn(
      async (_filters?: unknown, config?: { select?: string[] }): Promise<Array<Record<string, unknown>>> =>
        config?.select
          ? [Object.fromEntries(config.select.map((field) => [field, (DELIVERY as Record<string, unknown>)[field]]))]
          : [DELIVERY]
    ),
    listCourierShifts: jest.fn(async () => [
      { id: "shift_1", scheduled_start: "2026-12-01T09:00:00.000Z", assigned_zone: "EAST", notes: "home by 5" },
    ]),
    updateCouriers: jest.fn(async (data: Record<string, unknown>) => ({ ...ROW, ...data })),
    retrieveFoodDelivery: jest.fn(async (_id: string): Promise<Record<string, unknown>> => DELIVERY),
    assignCourierToDelivery: jest.fn(async () => ({ ...DELIVERY, status: "ASSIGNED" })),
  }
  return {
    service,
    req: {
      params: { id: "cour_1" },
      query: opts.query ?? {},
      body: opts.body ?? {},
      ...(opts.actorId ? { auth_context: { actor_id: opts.actorId } } : {}),
      scope: {
        resolve: (key: string) => {
          if (key === FOOD_DISTRIBUTION_MODULE) return service
          // Keyed on the framework's constant: the ownership helpers resolve
          // Query with it, and a hand-typed key would never be asked for.
          if (key === ContainerRegistrationKeys.QUERY) {
            return {
              graph: async ({ entity }: { entity: string }) => ({ data: opts.rows?.[entity] ?? [] }),
            }
          }
          throw new Error(`unresolvable: ${String(key)}`)
        },
      },
    },
  }
}

describe("GET /store/couriers", () => {
  it("publishes the projection, not the row", async () => {
    const { req } = makeReq({})
    const res = createRes()

    await listCouriers(req as never, res as never)

    const [courier] = res.body.couriers as Array<Record<string, unknown>>
    expect(courier.display_name).toBe("Ada O.")
    for (const field of [
      "email",
      "phone",
      "emergency_contact_phone",
      "current_latitude",
      "total_earnings",
    ]) {
      expect(courier).not.toHaveProperty(field)
    }
  })

  it("stays projected for a signed-in caller — this list has no owner branch", async () => {
    const { req } = makeReq({ actorId: "cus_owner" })
    const res = createRes()

    await listCouriers(req as never, res as never)

    const [courier] = res.body.couriers as Array<Record<string, unknown>>
    expect(courier).not.toHaveProperty("email")
  })
})

describe("GET /store/couriers/:id", () => {
  it("gives a stranger the projection", async () => {
    const { req } = makeReq({})
    const res = createRes()

    await getCourier(req as never, res as never)

    const courier = res.body.courier as Record<string, unknown>
    expect(courier).not.toHaveProperty("email")
    expect(courier).not.toHaveProperty("emergency_contact_phone")
    expect(courier.display_name).toBe("Ada O.")
  })

  it("gives the owner the whole row", async () => {
    const { req } = makeReq({ actorId: "cus_owner" })
    const res = createRes()

    await getCourier(req as never, res as never)

    const courier = res.body.courier as Record<string, unknown>
    expect(courier.email).toBe("ada@example.com")
    expect(courier.total_earnings).toBe(421050)
  })

  it("gives a different signed-in account the projection, not the row", async () => {
    const { req } = makeReq({ actorId: "cus_someone_else" })
    const res = createRes()

    await getCourier(req as never, res as never)

    expect(res.body.courier as Record<string, unknown>).not.toHaveProperty("email")
  })

  it("does not treat an unowned courier as everyone's", async () => {
    // `actorOwnsResource`, unlike `actorMayManage`, refuses a null owner_id.
    // A courier created before ownership was stamped must not be readable in
    // full by any signed-in account; the safe default on a read is the
    // public view.
    const { req, service } = makeReq({ actorId: "cus_anyone" })
    service.retrieveCourier.mockResolvedValueOnce({ ...ROW, owner_id: null })
    const res = createRes()

    await getCourier(req as never, res as never)

    expect(res.body.courier as Record<string, unknown>).not.toHaveProperty("email")
  })

  it.each([
    ["a caller with no account", null, ROW.owner_id],
    ["a different signed-in account", "cus_someone_else", ROW.owner_id],
    ["anyone, when the courier has no recorded owner", "cus_anyone", null],
  ])("tells %s how many deliveries the courier holds, and nothing about them", async (_who, actorId, ownerId) => {
    const { req, service } = makeReq({ actorId })
    service.retrieveCourier.mockResolvedValueOnce({ ...ROW, owner_id: ownerId })
    const res = createRes()

    await getCourier(req as never, res as never)

    const courier = res.body.courier as Record<string, unknown>
    // Still answers "is this courier free".
    expect(courier.active_delivery_count).toBe(1)
    expect(courier).not.toHaveProperty("active_deliveries")
    // Not the address, the recipient, the PIN, or the delivery's id: the id
    // is what the delivery reads and the claim are keyed on.
    const body = JSON.stringify(res.body)
    for (const value of DELIVERY_VALUES) {
      expect(body).not.toContain(value)
    }
    // And the rows were never read for them: ids only.
    expect(service.listFoodDeliveries).toHaveBeenCalledTimes(1)
    expect(service.listFoodDeliveries.mock.calls[0][1]).toEqual({ select: ["id"] })
  })

  it("gives the owner the deliveries they are carrying, without the PIN", async () => {
    const { req } = makeReq({ actorId: "cus_owner" })
    const res = createRes()

    await getCourier(req as never, res as never)

    const courier = res.body.courier as Record<string, unknown>
    expect(courier.active_delivery_count).toBe(1)
    const [delivery] = courier.active_deliveries as Array<Record<string, unknown>>
    expect(delivery).toMatchObject({
      id: "del_active_1",
      delivery_address: "12 Elm Street, Apt 4",
      recipient_phone: "+15550199",
    })
    expect(delivery).not.toHaveProperty("proof_pin_code")
  })
})

describe("PUT /store/couriers/:id", () => {
  it("echoes the whole row to the courier's owner", async () => {
    const { req } = makeReq({ actorId: "cus_owner", body: { vehicle_color: "red" } })
    const res = createRes()

    await updateCourier(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect((res.body.courier as Record<string, unknown>).email).toBe("ada@example.com")
  })

  it("acknowledges a write on a courier with no recorded owner with the projection, not the row", async () => {
    // `actorMayManage` lets any signed-in account write such a courier. The
    // echo was that account's read of the email, phone and emergency contact
    // (seen on Postgres: a signed-in stranger's empty PUT returned both).
    const { req, service } = makeReq({ actorId: "cus_anyone", body: {} })
    service.retrieveCourier.mockResolvedValueOnce({ ...ROW, owner_id: null })
    service.updateCouriers.mockResolvedValueOnce({ ...ROW, owner_id: null })
    const res = createRes()

    await updateCourier(req as never, res as never)

    expect(res.statusCode).toBe(200)
    const courier = res.body.courier as Record<string, unknown>
    expect(courier.display_name).toBe("Ada O.")
    for (const field of ["email", "phone", "emergency_contact_phone", "total_earnings"]) {
      expect(courier).not.toHaveProperty(field)
    }
  })
})

describe("POST /store/couriers/:id — claiming a delivery", () => {
  const REFUSAL = { message: "You do not have access to this record.", type: "not_allowed" }
  // The caller owns the courier in the path and is a stranger to the
  // delivery named: not its producer, its courier or its recipient.
  const claim = async (opts: {
    delivery?: Record<string, unknown> | null
    lookupFails?: Error
    rows?: Record<string, Array<Record<string, unknown>>>
  }) => {
    const { req, service } = makeReq({
      actorId: "cus_owner",
      body: { delivery_id: "del_x" },
      rows: opts.rows,
    })
    service.retrieveCourier.mockResolvedValue({ ...ROW, status: "AVAILABLE", active: true })
    service.retrieveFoodDelivery.mockImplementation(async (id: string) => {
      if (opts.lookupFails) throw opts.lookupFails
      // A missing delivery is a thrown not-found, as the module answers it.
      if (opts.delivery === null) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, `FoodDelivery with id: ${id} was not found`)
      }
      return opts.delivery ?? DELIVERY
    })
    const res = createRes()
    await claimDelivery(req as never, res as never)
    return { res, service }
  }
  const SOMEONE_ELSES = { ...DELIVERY, courier_id: "cour_other", status: "ASSIGNED" }

  it("refuses a delivery that is not pending and one that does not exist alike", async () => {
    const taken = await claim({ delivery: SOMEONE_ELSES })
    const missing = await claim({ delivery: null })

    expect([taken.res.statusCode, taken.res.body]).toEqual([403, REFUSAL])
    expect([missing.res.statusCode, missing.res.body]).toEqual([403, REFUSAL])
    expect(taken.service.assignCourierToDelivery).not.toHaveBeenCalled()
    expect(missing.service.assignCourierToDelivery).not.toHaveBeenCalled()
  })

  it("tells only someone who may already read the delivery that it is not available", async () => {
    // The courier who already holds it, claiming twice.
    const { res, service } = await claim({ delivery: { ...DELIVERY, courier_id: "cour_1", status: "ASSIGNED" } })

    expect([res.statusCode, res.body]).toEqual([400, { message: "Delivery is not available for claiming" }])
    expect(service.assignCourierToDelivery).not.toHaveBeenCalled()
  })

  it("claims a pending delivery, and does not hand the courier its PIN", async () => {
    const { res, service } = await claim({ delivery: { ...DELIVERY, courier_id: null, status: "PENDING" } })

    expect(res.statusCode).toBe(200)
    expect(service.assignCourierToDelivery).toHaveBeenCalledWith("del_x", "cour_1")
    const delivery = res.body.delivery as Record<string, unknown>
    expect(delivery.delivery_address).toBe("12 Elm Street, Apt 4")
    expect(delivery).not.toHaveProperty("proof_pin_code")
    expect(JSON.stringify(res.body)).not.toContain("4821")
  })

  it("does not turn a failed lookup into a refusal", async () => {
    await expect(claim({ lookupFails: new Error("connection terminated") })).rejects.toThrow(
      "connection terminated"
    )
  })
})

describe("GET /store/couriers/:id/shifts", () => {
  const REFUSAL = { message: "You do not have access to this record.", type: "not_allowed" }

  it.each([
    ["a caller with no account", null, ROW.owner_id],
    ["a different signed-in account", "cus_someone_else", ROW.owner_id],
    ["anyone, when the courier has no recorded owner", "cus_anyone", null],
  ])("refuses %s the courier's schedule", async (_who, actorId, ownerId) => {
    const { req, service } = makeReq({ actorId })
    service.retrieveCourier.mockResolvedValueOnce({ ...ROW, owner_id: ownerId })
    const res = createRes()

    await listShifts(req as never, res as never)

    expect([res.statusCode, res.body]).toEqual([403, REFUSAL])
    expect(service.listCourierShifts).not.toHaveBeenCalled()
  })

  it("serves the owner their shifts", async () => {
    const { req } = makeReq({ actorId: "cus_owner" })
    const res = createRes()

    await listShifts(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.shifts).toEqual([expect.objectContaining({ id: "shift_1", assigned_zone: "EAST" })])
  })
})

describe("GET /store/delivery-batches/:id", () => {
  it("no longer publishes the courier's full name and phone", async () => {
    // This route hand-built `{ id, name: "First Last", phone, vehicle_type }`
    // — more than /food-deliveries/:id/track gives even the customer whose
    // delivery is in flight. The caller here is the batch's own planner:
    // D10-5 has since scoped the route to them and to the assigned courier
    // (`__tests__/d10-5-read-scoping` covers that refusal), and the
    // projection still applies to both — the courier's phone number is not
    // the planner's to read either.
    const service = {
      retrieveDeliveryBatch: jest.fn(async () => ({
        id: "bat_1",
        owner_id: "cus_planner",
        courier_id: "cour_1",
      })),
      listFoodDeliveries: jest.fn(async () => []),
      retrieveCourier: jest.fn(async () => ROW),
    }
    const req = {
      params: { id: "bat_1" },
      query: {},
      auth_context: { actor_id: "cus_planner", actor_type: "customer" },
      scope: {
        resolve: (key: string) => {
          if (key === FOOD_DISTRIBUTION_MODULE) return service
          throw new Error(`unresolvable: ${String(key)}`)
        },
      },
    }
    const res = createRes()

    await getDeliveryBatch(req as never, res as never)

    const batch = res.body.batch as Record<string, unknown>
    const courier = batch.courier as Record<string, unknown>
    expect(courier).not.toHaveProperty("phone")
    expect(courier).not.toHaveProperty("name")
    expect(courier.display_name).toBe("Ada O.")
    expect(courier.vehicle_type).toBe("EBIKE")
  })

  it("still reports a batch with no courier assigned", async () => {
    const service = {
      retrieveDeliveryBatch: jest.fn(async () => ({
        id: "bat_1",
        owner_id: "cus_planner",
        courier_id: null,
      })),
      listFoodDeliveries: jest.fn(async () => []),
      retrieveCourier: jest.fn(async () => null),
    }
    const req = {
      params: { id: "bat_1" },
      query: {},
      auth_context: { actor_id: "cus_planner", actor_type: "customer" },
      scope: {
        resolve: (key: string) => {
          if (key === FOOD_DISTRIBUTION_MODULE) return service
          throw new Error(`unresolvable: ${String(key)}`)
        },
      },
    }
    const res = createRes()

    await getDeliveryBatch(req as never, res as never)

    expect((res.body.batch as Record<string, unknown>).courier).toBeNull()
  })
})
