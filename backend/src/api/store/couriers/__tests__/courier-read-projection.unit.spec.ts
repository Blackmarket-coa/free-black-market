import { GET as listCouriers } from "../route"
import { GET as getCourier } from "../[id]/route"
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
 */
const ROW = {
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

const makeReq = (opts: { actorId?: string | null; query?: Record<string, unknown> }) => {
  const service = {
    listCouriers: jest.fn(async () => [ROW]),
    retrieveCourier: jest.fn(async () => ROW),
    listFoodDeliveries: jest.fn(async () => []),
  }
  return {
    service,
    req: {
      params: { id: "cour_1" },
      query: opts.query ?? {},
      ...(opts.actorId ? { auth_context: { actor_id: opts.actorId } } : {}),
      scope: {
        resolve: (key: string) => {
          if (key === FOOD_DISTRIBUTION_MODULE) return service
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

  it("still reports active deliveries on both branches", async () => {
    for (const actorId of [null, "cus_owner"]) {
      const { req } = makeReq({ actorId })
      const res = createRes()
      await getCourier(req as never, res as never)
      expect(res.body.courier as Record<string, unknown>).toHaveProperty(
        "active_deliveries"
      )
    }
  })
})

describe("GET /store/delivery-batches/:id", () => {
  it("no longer publishes the courier's full name and phone", async () => {
    // This route hand-built `{ id, name: "First Last", phone, vehicle_type }`
    // — more than /food-deliveries/:id/track gives even the customer whose
    // delivery is in flight. Who may read a batch at all is still open under
    // D10-5; narrowing the courier neither answers that nor waits on it.
    const service = {
      retrieveDeliveryBatch: jest.fn(async () => ({ id: "bat_1", courier_id: "cour_1" })),
      listFoodDeliveries: jest.fn(async () => []),
      retrieveCourier: jest.fn(async () => ROW),
    }
    const req = {
      params: { id: "bat_1" },
      query: {},
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
      retrieveDeliveryBatch: jest.fn(async () => ({ id: "bat_1", courier_id: null })),
      listFoodDeliveries: jest.fn(async () => []),
      retrieveCourier: jest.fn(async () => null),
    }
    const req = {
      params: { id: "bat_1" },
      query: {},
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
