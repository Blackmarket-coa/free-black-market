import { GET as gardenMembers } from "../gardens/[id]/members/route"
import { GET as workPartySignups } from "../work-parties/[id]/signups/route"
import { GET as harvestClaims } from "../harvests/[id]/claims/route"
import { GET as volunteerLogs } from "../volunteer-logs/route"
import { GET as deliveryDetail } from "../food-deliveries/[id]/route"
import { GET as deliveryTrack } from "../food-deliveries/[id]/track/route"
import { GET as batchDetail } from "../delivery-batches/[id]/route"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"

/**
 * Every read D10-5 listed now refuses a stranger.
 *
 * These are the end-to-end half: `shared/__tests__/community-read-access`
 * pins the ruling, this pins that the routes apply it. The case that matters
 * most in each is the unauthenticated one, because that is the state every
 * one of these endpoints shipped in.
 */
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

type Rows = Record<string, Array<Record<string, unknown>>>

const makeReq = (opts: {
  actorId?: string
  params?: Record<string, string>
  query?: Record<string, unknown>
  rows?: Rows
  modules?: Record<string, unknown>
}) => ({
  params: opts.params ?? { id: "x_1" },
  query: opts.query ?? {},
  ...(opts.actorId
    ? { auth_context: { actor_id: opts.actorId, actor_type: "customer" } }
    : {}),
  scope: {
    resolve: (key: string) => {
      if (opts.modules && key in opts.modules) return opts.modules[key]
      return {
        graph: async ({ entity }: { entity: string }) => ({
          data: opts.rows?.[entity] ?? [],
        }),
      }
    },
  },
})

const MEMBER = { garden_membership: [{ id: "gm_1" }] }
const NOT_MEMBER = { garden_membership: [] }

describe("garden roster — /store/gardens/:id/members", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = createRes()
    await gardenMembers(makeReq({ rows: NOT_MEMBER }) as never, res as never)
    expect(res.statusCode).toBe(403)
  })

  it("refuses a signed-in non-member", async () => {
    const res = createRes()
    await gardenMembers(
      makeReq({ actorId: "cus_stranger", rows: NOT_MEMBER }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("shows a member the roster but not each other's investment_balance", async () => {
    const res = createRes()
    await gardenMembers(
      makeReq({
        actorId: "cus_me",
        rows: {
          garden_membership: [
            { id: "gm_1", customer_id: "cus_me", investment_balance: 500, voting_power: 2 },
            { id: "gm_2", customer_id: "cus_other", investment_balance: 9000, voting_power: 3 },
          ],
        },
      }) as never,
      res as never
    )

    const roster = res.body.members as Array<Record<string, unknown>>
    expect(roster).toHaveLength(2)
    expect(roster[0].investment_balance).toBe(500)
    expect(roster[1].investment_balance).toBeUndefined()
    // voting_power stays: a member cannot check a tally without it.
    expect(roster[1].voting_power).toBe(3)
  })
})

describe("work-party roster — /store/work-parties/:id/signups", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = createRes()
    await workPartySignups(
      makeReq({ rows: { garden_work_party: [{ id: "wp_1", garden_id: "gdn_1" }] } }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("refuses a member of a different garden", async () => {
    const res = createRes()
    await workPartySignups(
      makeReq({
        actorId: "cus_other_garden",
        rows: { garden_work_party: [{ id: "wp_1", garden_id: "gdn_1" }], ...NOT_MEMBER },
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("refuses identically for a work party that does not exist", async () => {
    // Same code for missing and forbidden — otherwise the status is an oracle.
    const res = createRes()
    await workPartySignups(
      makeReq({ actorId: "cus_1", rows: { garden_work_party: [] } }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })
})

describe("harvest claims — /store/harvests/:id/claims", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = createRes()
    await harvestClaims(
      makeReq({ rows: { garden_harvest: [{ id: "h_1", garden_id: "gdn_1" }] } }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("refuses a non-member — who took free food is not public", async () => {
    const res = createRes()
    await harvestClaims(
      makeReq({
        actorId: "cus_stranger",
        rows: { garden_harvest: [{ id: "h_1", garden_id: "gdn_1" }], ...NOT_MEMBER },
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })
})

describe("volunteer logs — /store/volunteer-logs", () => {
  it("400s an unscoped request rather than dumping every garden", async () => {
    const res = createRes()
    await volunteerLogs(makeReq({ query: {} }) as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("refuses one person's history to an unauthenticated caller", async () => {
    // The shipped behaviour: ?customer_id= returned a named person's entire
    // attendance record — when they turn up, how often, how long they stay.
    const res = createRes()
    await volunteerLogs(
      makeReq({ query: { customer_id: "cus_victim" }, rows: NOT_MEMBER }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("refuses one person's history to a different signed-in account", async () => {
    const res = createRes()
    await volunteerLogs(
      makeReq({
        actorId: "cus_nosy",
        query: { customer_id: "cus_victim" },
        rows: NOT_MEMBER,
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("lets the subject read their own history", async () => {
    const res = createRes()
    await volunteerLogs(
      makeReq({
        actorId: "cus_me",
        query: { customer_id: "cus_me" },
        rows: { volunteer_log: [{ id: "vl_1" }] },
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.logs).toHaveLength(1)
  })

  it("lets a garden member read the garden's log", async () => {
    const res = createRes()
    await volunteerLogs(
      makeReq({
        actorId: "cus_member",
        query: { garden_id: "gdn_1" },
        rows: { ...MEMBER, volunteer_log: [{ id: "vl_1" }] },
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(200)
  })
})

describe("deliveries — the enumerable-id pair", () => {
  const DELIVERY = {
    id: "del_1",
    producer_id: "prd_1",
    courier_id: "cour_1",
    order_id: "fo_1",
    delivery_address_line_1: "12 Elm Street",
    last_known_latitude: 41.87,
  }
  // Keyed on the module's own registration constant rather than a literal:
  // the routes resolve with FOOD_DISTRIBUTION_MODULE, so a hand-typed key
  // silently misses and the mock never gets used.
  const modules = (delivery: Record<string, unknown> | null) => ({
    [FOOD_DISTRIBUTION_MODULE]: {
      retrieveFoodDelivery: jest.fn(async () => delivery),
      listDeliveryEvents: jest.fn(async () => []),
      retrieveCourier: jest.fn(async () => null),
    },
  })

  it("refuses the detail read to an unauthenticated caller", async () => {
    const res = createRes()
    await deliveryDetail(
      makeReq({ modules: modules(DELIVERY), rows: {} }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain("Elm Street")
  })

  it("refuses tracking to an unauthenticated caller", async () => {
    // The sharpest item in D10-5: a home address, its coordinates, and the
    // live position of a courier heading to it.
    const res = createRes()
    await deliveryTrack(
      makeReq({ modules: modules(DELIVERY), rows: {} }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain("Elm Street")
  })

  it("refuses tracking to an unrelated signed-in account", async () => {
    const res = createRes()
    await deliveryTrack(
      makeReq({
        actorId: "cus_stranger",
        modules: modules(DELIVERY),
        rows: {
          food_producer: [{ id: "prd_1", owner_id: "sel_1" }],
          food_courier: [{ id: "cour_1", owner_id: "cus_courier" }],
          food_order: [{ id: "fo_1", customer_id: "cus_recipient" }],
        },
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("lets the recipient track their own delivery", async () => {
    const res = createRes()
    await deliveryTrack(
      makeReq({
        actorId: "cus_recipient",
        params: { id: "del_1" },
        modules: modules(DELIVERY),
        rows: {
          food_producer: [{ id: "prd_1", owner_id: "sel_1" }],
          food_courier: [{ id: "cour_1", owner_id: "cus_courier" }],
          food_order: [{ id: "fo_1", customer_id: "cus_recipient" }],
        },
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.delivery_id).toBe("del_1")
  })

  it("refuses identically for a delivery that does not exist", async () => {
    const res = createRes()
    await deliveryTrack(
      makeReq({ actorId: "cus_1", modules: modules(null), rows: {} }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })
})

describe("delivery batches — a courier's run", () => {
  const BATCH = { id: "bat_1", owner_id: "cus_planner", courier_id: "cour_1" }
  const modules = (batch: Record<string, unknown> | null) => ({
    [FOOD_DISTRIBUTION_MODULE]: {
      retrieveDeliveryBatch: jest.fn(async () => batch),
      listFoodDeliveries: jest.fn(async () => [
        { id: "del_1", delivery_address: "12 Elm Street" },
      ]),
      retrieveCourier: jest.fn(async () => ({ display_name: "Ada O." })),
    },
  })
  const COURIER_ROWS = { food_courier: [{ id: "cour_1", owner_id: "cus_driver" }] }

  it("refuses the batch to an unauthenticated caller", async () => {
    const res = createRes()
    await batchDetail(
      makeReq({ modules: modules(BATCH), rows: COURIER_ROWS }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain("Elm Street")
  })

  it("refuses the batch to an unrelated signed-in account", async () => {
    const res = createRes()
    await batchDetail(
      makeReq({
        actorId: "cus_stranger",
        modules: modules(BATCH),
        rows: COURIER_ROWS,
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("lets the planner and the assigned courier read it", async () => {
    for (const actorId of ["cus_planner", "cus_driver"]) {
      const res = createRes()
      await batchDetail(
        makeReq({ actorId, modules: modules(BATCH), rows: COURIER_ROWS }) as never,
        res as never
      )
      expect(res.statusCode).toBe(200)
    }
  })

  it("refuses a legacy batch with no owner rather than grandfathering it", async () => {
    // `actorMayManage` lets a null owner_id through for the write verbs.
    // A read of somebody's delivery address does not get that latitude.
    const res = createRes()
    await batchDetail(
      makeReq({
        actorId: "cus_anyone",
        modules: modules({ ...BATCH, owner_id: null, courier_id: null }),
        rows: {},
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })

  it("refuses identically for a batch that does not exist", async () => {
    const res = createRes()
    await batchDetail(
      makeReq({ actorId: "cus_planner", modules: modules(null), rows: {} }) as never,
      res as never
    )
    expect(res.statusCode).toBe(403)
  })
})
