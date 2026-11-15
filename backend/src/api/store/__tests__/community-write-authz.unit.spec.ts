import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST as createGarden } from "../gardens/route"
import { PUT as updateGarden } from "../gardens/[id]/route"
import { POST as createPlot } from "../gardens/[id]/plots/route"
import { POST as createKitchen } from "../kitchens/route"
import { PUT as updateProposal } from "../proposals/[id]/route"
import { POST as allocateHarvest } from "../harvests/[id]/allocations/route"
import { POST as createSeason } from "../seasons/route"
import { POST as submitProof } from "../food-deliveries/[id]/proof/route"
import {
  POST as submitProofTwin,
  PUT as updateDelivery,
} from "../food-deliveries/[id]/route"
import { POST as createRestaurantDelivery } from "../deliveries/route"
import { POST as respondToTrade } from "../food-trades/[id]/route"
import { POST as trackDelivery } from "../food-deliveries/[id]/track/route"
import { POST as createFoodDelivery } from "../food-deliveries/route"
import { POST as placeProducerOrder } from "../food-producers/[id]/orders/route"
import { POST as joinGarden } from "../gardens/[id]/members/route"
import { POST as claimHarvest } from "../harvests/[id]/claims/route"
import { POST as signUpForWorkParty } from "../work-parties/[id]/signups/route"
import { POST as logVolunteerHours } from "../volunteer-logs/route"
import { POST as recordHarvest } from "../harvests/route"
import { POST as createProposal } from "../proposals/route"
import { POST as recordPlanting } from "../seasons/[id]/plantings/route"
import { POST as createWorkParty } from "../work-parties/route"
import { POST as castVote } from "../proposals/[id]/votes/route"
import { POST as createZone } from "../delivery-zones/route"
import { PUT as updateZone, DELETE as deleteZone } from "../delivery-zones/[id]/route"
import { GARDEN_MODULE } from "../../../modules/garden"
import { KITCHEN_MODULE } from "../../../modules/kitchen"
import { GOVERNANCE_MODULE } from "../../../modules/governance"
import { HARVEST_MODULE } from "../../../modules/harvest"
import { SEASON_MODULE } from "../../../modules/season"
import { FOOD_DISTRIBUTION_MODULE } from "../../../modules/food-distribution"

const mockCreateDeliveryRun = jest.fn()
const mockHandleDeliveryRun = jest.fn()
jest.mock("../../../workflows/delivery/workflows/create-delivery", () => ({
  createDeliveryWorkflow: () => ({ run: mockCreateDeliveryRun }),
}))
jest.mock("../../../workflows/delivery/workflows/handle-delivery", () => ({
  handleDeliveryWorkflow: () => ({ run: mockHandleDeliveryRun }),
}))

/**
 * The community `/store` write handlers refuse an account that does not own
 * what it is writing, and still serve the one that does.
 *
 * Every case calls the real route handler. The fake container resolves only
 * the keys the routes are meant to use — the imported `*_MODULE` constants,
 * Query, and the two framework keys `requireSellerId` touches — and Query
 * answers only for the entities a case seeds (an empty list counts as seeded).
 * Anything else throws, *and* is recorded in `strayLookups`, which every case
 * must leave empty. The record matters because the access helpers swallow
 * lookup errors and deny: a throw alone would let a refusal case pass for the
 * wrong reason, and a route that asked for an entity that does not exist
 * (`allocation_rule`, say) would read as "no rows" and pass on its default.
 * A Query fake cannot tell a real entity from a broken one, though, so the
 * routes whose rows are what matters are also run against Postgres in
 * `integration-tests/http/store-community-write-authz.spec.ts`.
 * Query honours `filters`, so a membership that exists but is pending, or of
 * the wrong type, does not count.
 */

const strayLookups: string[] = []

afterEach(() => {
  const seen = strayLookups.splice(0)
  expect(seen).toEqual([])
})

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

type Row = Record<string, unknown>
type Rows = Record<string, Row[]>
type Actor = { id: string; type: "customer" | "seller" | "driver" }

const matches = (row: Row, filters: Record<string, unknown> = {}) =>
  Object.entries(filters).every(([key, want]) =>
    Array.isArray(want) ? want.includes(row[key]) : row[key] === want
  )

const makeReq = (opts: {
  actor?: Actor
  params?: Record<string, string>
  body?: unknown
  url?: string
  rows?: Rows
  modules?: Record<string, unknown>
}) => {
  const query = {
    graph: async ({
      entity,
      filters,
    }: {
      entity: string
      filters?: Record<string, unknown>
    }) => {
      if (!opts.rows || !Object.prototype.hasOwnProperty.call(opts.rows, entity)) {
        strayLookups.push(`query entity: ${entity}`)
        throw new Error(`unexpected query entity: ${entity}`)
      }
      return { data: opts.rows[entity].filter((row) => matches(row, filters)) }
    },
  }
  return {
    params: opts.params ?? {},
    body: opts.body ?? {},
    query: {},
    url: opts.url ?? "/",
    ...(opts.actor
      ? { auth_context: { actor_id: opts.actor.id, actor_type: opts.actor.type } }
      : {}),
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return query
        if (opts.modules && key in opts.modules) return opts.modules[key]
        // requireSellerId resolves these up front; a sel_ actor never uses them.
        if (key === ContainerRegistrationKeys.PG_CONNECTION || key === Modules.AUTH) {
          return undefined
        }
        strayLookups.push(`container key: ${key}`)
        throw new Error(`unexpected container key: ${key}`)
      },
    },
  }
}

const call = async (
  handler: (req: never, res: never) => unknown,
  req: ReturnType<typeof makeReq>
) => {
  const res = createRes()
  await handler(req as never, res as never)
  return res
}

const CUSTOMER = (id: string) => ({ id, type: "customer" as const })
const SELLER = (id: string) => ({ id, type: "seller" as const })

const organizer = (customerId: string, gardenId = "gdn_1", status = "active") => ({
  id: `gm_${customerId}`,
  garden_id: gardenId,
  customer_id: customerId,
  membership_type: "organizer",
  status,
})

// ---------------------------------------------------------------------------
// Gardens
// ---------------------------------------------------------------------------

describe("POST /store/gardens — the creator becomes the first organizer", () => {
  const gardenService = () => ({
    createGardens: jest.fn(async (data: Row) => ({ id: "gdn_new", ...data })),
    createGardenMemberships: jest.fn(async () => ({ id: "gm_new" })),
    deleteGardens: jest.fn(async () => undefined),
  })

  it("refuses a seller or driver, whose id cannot sit in a member roster", async () => {
    for (const actor of [SELLER("sel_1"), { id: "drv_1", type: "driver" as const }]) {
      const svc = gardenService()
      const res = await call(
        createGarden,
        makeReq({ actor, body: { name: "Plot" }, modules: { [GARDEN_MODULE]: svc } })
      )
      expect(res.statusCode).toBe(403)
      expect(svc.createGardens).not.toHaveBeenCalled()
    }
  })

  it("records the creating customer as an active organizer", async () => {
    const svc = gardenService()
    const res = await call(
      createGarden,
      makeReq({
        actor: CUSTOMER("cus_me"),
        body: { name: "Eastside Garden", address: "1 Main", city: "c", state: "s", zip: "z" },
        modules: { [GARDEN_MODULE]: svc },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(svc.createGardenMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        garden_id: "gdn_new",
        customer_id: "cus_me",
        membership_type: "organizer",
        status: "active",
      })
    )
  })

  it("does not leave a manager-less garden behind when the membership fails", async () => {
    const svc = gardenService()
    svc.createGardenMemberships.mockRejectedValueOnce(new Error("db down"))
    await expect(
      call(
        createGarden,
        makeReq({
          actor: CUSTOMER("cus_me"),
          body: { name: "G" },
          modules: { [GARDEN_MODULE]: svc },
        })
      )
    ).rejects.toThrow("db down")
    expect(svc.deleteGardens).toHaveBeenCalledWith("gdn_new")
  })
})

describe("PUT /store/gardens/:id — active organizers, allow-listed fields", () => {
  const svc = () => ({ updateGardens: jest.fn(async (d: Row) => d) })

  const refused: Array<[string, ReturnType<typeof makeReq>]> = [
    ["an unauthenticated caller", makeReq({ params: { id: "gdn_1" } })],
    [
      "a signed-in stranger",
      makeReq({
        actor: CUSTOMER("cus_stranger"),
        params: { id: "gdn_1" },
        rows: { garden_membership: [] },
      }),
    ],
    [
      "a self-appointed (pending) organizer",
      makeReq({
        actor: CUSTOMER("cus_climber"),
        params: { id: "gdn_1" },
        rows: { garden_membership: [organizer("cus_climber", "gdn_1", "pending")] },
      }),
    ],
    [
      "an active member who is not an organizer",
      makeReq({
        actor: CUSTOMER("cus_member"),
        params: { id: "gdn_1" },
        rows: {
          garden_membership: [
            { ...organizer("cus_member"), membership_type: "volunteer" },
          ],
        },
      }),
    ],
    [
      "the organizer of a different garden",
      makeReq({
        actor: CUSTOMER("cus_other"),
        params: { id: "gdn_1" },
        rows: { garden_membership: [organizer("cus_other", "gdn_2")] },
      }),
    ],
  ]

  it.each(refused)("refuses %s", async (_label, req) => {
    const service = svc()
    req.scope.resolve = ((orig) => (key: string) =>
      key === GARDEN_MODULE ? service : orig(key))(req.scope.resolve)
    req.body = { name: "Hijacked" }
    const res = await call(updateGarden, req)
    expect(res.statusCode).toBe(403)
    expect(service.updateGardens).not.toHaveBeenCalled()
  })

  it("lets the organizer edit, and drops everything off the allow-list", async () => {
    const service = svc()
    const res = await call(
      updateGarden,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "gdn_1" },
        rows: { garden_membership: [organizer("cus_org")] },
        modules: { [GARDEN_MODULE]: service },
        body: {
          id: "gdn_someone_else",
          name: "Renamed",
          status: "active",
          operating_account_id: "acct_attacker",
          harvest_pool_account_id: "acct_attacker",
          managing_org_id: "sel_attacker",
          slug: "taken",
          total_plots: 999,
          settings: { volunteer_hour_value: 1e9 },
        },
      })
    )
    expect(res.statusCode).toBe(200)
    expect(service.updateGardens).toHaveBeenCalledTimes(1)
    expect(service.updateGardens.mock.calls[0][0]).toEqual({
      id: "gdn_1",
      name: "Renamed",
      status: "active",
    })
  })
})

describe("POST /store/gardens/:id/plots", () => {
  const svc = () => ({
    createGardenPlots: jest.fn(async () => ({ id: "plot_1" })),
    updateGardens: jest.fn(async (d: Row) => d),
  })

  it("refuses a non-organizer", async () => {
    const service = svc()
    const res = await call(
      createPlot,
      makeReq({
        actor: CUSTOMER("cus_stranger"),
        params: { id: "gdn_1" },
        body: { plot_number: "A1" },
        rows: { garden_membership: [] },
        modules: { [GARDEN_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createGardenPlots).not.toHaveBeenCalled()
  })

  it("lets the organizer add a plot", async () => {
    const service = svc()
    const res = await call(
      createPlot,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "gdn_1" },
        body: { plot_number: "A1" },
        rows: {
          garden_membership: [organizer("cus_org")],
          garden: [{ id: "gdn_1", total_plots: 2 }],
        },
        modules: { [GARDEN_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createGardenPlots).toHaveBeenCalledWith(
      expect.objectContaining({ garden_id: "gdn_1", plot_number: "A1" })
    )
  })
})

describe("POST /store/seasons", () => {
  const svc = () => ({ createGardenSeasons: jest.fn(async () => ({ id: "sea_1" })) })

  it("requires a garden_id", async () => {
    const service = svc()
    const res = await call(
      createSeason,
      makeReq({ actor: CUSTOMER("cus_org"), body: {}, modules: { [SEASON_MODULE]: service } })
    )
    expect(res.statusCode).toBe(400)
    expect(service.createGardenSeasons).not.toHaveBeenCalled()
  })

  it("refuses a non-organizer of that garden", async () => {
    const service = svc()
    const res = await call(
      createSeason,
      makeReq({
        actor: CUSTOMER("cus_org"),
        body: { garden_id: "gdn_1", name: "Spring" },
        rows: { garden_membership: [organizer("cus_org", "gdn_2")] },
        modules: { [SEASON_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createGardenSeasons).not.toHaveBeenCalled()
  })

  it("lets the organizer open a season", async () => {
    const service = svc()
    const res = await call(
      createSeason,
      makeReq({
        actor: CUSTOMER("cus_org"),
        body: { garden_id: "gdn_1", name: "Spring" },
        rows: { garden_membership: [organizer("cus_org")] },
        modules: { [SEASON_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createGardenSeasons).toHaveBeenCalledWith(
      expect.objectContaining({ garden_id: "gdn_1", name: "Spring" })
    )
  })
})

describe("POST /store/harvests/:id/allocations", () => {
  const svc = (rules: Row[] = []) => ({
    listAllocationRules: jest.fn(async (filters: Row) => rules.filter((r) => matches(r, filters))),
    createHarvestAllocations: jest.fn(async (rows: Row[]) =>
      rows.map((row, i) => ({ id: `alloc_${i}`, ...row }))
    ),
    updateGardenHarvests: jest.fn(async (d: Row) => d),
  })
  // The pg connection the route claims the harvest through. `claims` is what
  // Postgres answers the conditional UPDATE with: false is the request that
  // lost a race (the row was no longer pending when its UPDATE ran).
  const CLAIM = /UPDATE garden_harvest\s+SET allocation_status = 'allocated'/
  const RELEASE = /UPDATE garden_harvest SET allocation_status = 'pending'/
  const pg = (claims = true) => ({
    raw: jest.fn(async (sql: string, _bindings: unknown[]) => ({
      rows: CLAIM.test(sql) && claims ? [{ id: "hv_1" }] : [],
    })),
  })
  const harvest = {
    id: "hv_1",
    garden_id: "gdn_1",
    total_quantity: 100,
    unit: "lbs",
    total_estimated_value: 1000,
    allocation_status: "pending",
  }

  it("refuses a missing harvest the same way as someone else's", async () => {
    const service = svc()
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "hv_missing" },
        rows: { garden_harvest: [harvest], garden_membership: [organizer("cus_org")] },
        modules: { [HARVEST_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createHarvestAllocations).not.toHaveBeenCalled()
  })

  it("refuses a non-organizer", async () => {
    const service = svc()
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_stranger"),
        params: { id: "hv_1" },
        rows: { garden_harvest: [harvest], garden_membership: [] },
        modules: { [HARVEST_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createHarvestAllocations).not.toHaveBeenCalled()
    expect(service.updateGardenHarvests).not.toHaveBeenCalled()
  })

  it("lets the garden's organizer allocate, in rows the allocation model accepts", async () => {
    const service = svc()
    const conn = pg()
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "hv_1" },
        rows: {
          garden_harvest: [harvest],
          garden_membership: [organizer("cus_org")],
        },
        modules: { [HARVEST_MODULE]: service, [ContainerRegistrationKeys.PG_CONNECTION]: conn },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createHarvestAllocations).toHaveBeenCalledTimes(1)
    const rows = service.createHarvestAllocations.mock.calls[0][0] as Row[]
    // The six default pools, which sum to the whole harvest.
    expect(rows.map((r) => r.pool_type)).toEqual([
      "investor",
      "volunteer",
      "plot_holder",
      "communal",
      "open_market",
      "donation",
    ])
    expect(rows.reduce((sum, r) => sum + (r.quantity as number), 0)).toBe(100)
    expect(rows[2]).toEqual(
      expect.objectContaining({
        harvest_id: "hv_1",
        garden_id: "gdn_1",
        pool_type: "plot_holder",
        percentage: 30,
        quantity: 30,
        unit: "lbs",
        estimated_value: 300,
        status: "allocated",
      })
    )
    // garden_harvest_allocation has none of these columns.
    for (const row of rows) {
      for (const absent of ["allocated_quantity", "allocated_value", "claimed_quantity", "remaining_quantity"]) {
        expect(row).not.toHaveProperty(absent)
      }
    }
    // The harvest is claimed (pending -> allocated) in one statement, before
    // any pool is written.
    expect(conn.raw).toHaveBeenCalledTimes(1)
    expect(conn.raw.mock.calls[0][0]).toMatch(CLAIM)
    expect(conn.raw.mock.calls[0][1]).toEqual(["hv_1"])
    expect(conn.raw.mock.invocationCallOrder[0]).toBeLessThan(
      service.createHarvestAllocations.mock.invocationCallOrder[0]
    )
  })

  it("uses the garden's own active rules when it has them", async () => {
    const service = svc([
      { garden_id: "gdn_1", is_active: true, pool_type: "communal", percentage: 60, priority: 1 },
      { garden_id: "gdn_1", is_active: true, pool_type: "donation", percentage: 40, priority: 2 },
      { garden_id: "gdn_1", is_active: false, pool_type: "investor", percentage: 100, priority: 1 },
      { garden_id: "gdn_2", is_active: true, pool_type: "investor", percentage: 100, priority: 1 },
    ])
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "hv_1" },
        rows: {
          garden_harvest: [harvest],
          garden_membership: [organizer("cus_org")],
        },
        modules: { [HARVEST_MODULE]: service, [ContainerRegistrationKeys.PG_CONNECTION]: pg() },
      })
    )
    expect(res.statusCode).toBe(201)
    const rows = service.createHarvestAllocations.mock.calls[0][0] as Row[]
    expect(rows.map((r) => [r.pool_type, r.quantity, r.priority])).toEqual([
      ["communal", 60, 1],
      ["donation", 40, 2],
    ])
  })

  it("refuses to allocate the same harvest twice", async () => {
    const service = svc()
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "hv_1" },
        rows: {
          garden_harvest: [{ ...harvest, allocation_status: "allocated" }],
          garden_membership: [organizer("cus_org")],
        },
        modules: { [HARVEST_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(409)
    expect(service.createHarvestAllocations).not.toHaveBeenCalled()
    expect(service.updateGardenHarvests).not.toHaveBeenCalled()
  })

  it("refuses the request that loses a race: the claim decides, not the earlier read", async () => {
    // Both of two simultaneous requests read the harvest as pending; only one
    // UPDATE ... WHERE allocation_status = 'pending' gets the row.
    const service = svc()
    const conn = pg(false)
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "hv_1" },
        rows: { garden_harvest: [harvest], garden_membership: [organizer("cus_org")] },
        modules: { [HARVEST_MODULE]: service, [ContainerRegistrationKeys.PG_CONNECTION]: conn },
      })
    )
    expect(res.statusCode).toBe(409)
    expect(conn.raw).toHaveBeenCalledTimes(1)
    expect(service.createHarvestAllocations).not.toHaveBeenCalled()
  })

  it("hands the harvest back to pending when writing the pools fails", async () => {
    const service = svc()
    service.createHarvestAllocations.mockRejectedValueOnce(new Error("db down"))
    const conn = pg()
    await expect(
      call(
        allocateHarvest,
        makeReq({
          actor: CUSTOMER("cus_org"),
          params: { id: "hv_1" },
          rows: { garden_harvest: [harvest], garden_membership: [organizer("cus_org")] },
          modules: { [HARVEST_MODULE]: service, [ContainerRegistrationKeys.PG_CONNECTION]: conn },
        })
      )
    ).rejects.toThrow("db down")
    expect(conn.raw).toHaveBeenCalledTimes(2)
    expect(conn.raw.mock.calls[1][0]).toMatch(RELEASE)
    expect(conn.raw.mock.calls[1][1]).toEqual(["hv_1", "hv_1"])
  })
})

// ---------------------------------------------------------------------------
// Kitchens
// ---------------------------------------------------------------------------

describe("POST /store/kitchens — sellers, stamped with the operator", () => {
  const svc = () => ({ createKitchens: jest.fn(async (d: Row) => ({ id: "kit_1", ...d })) })

  it("refuses a customer", async () => {
    const service = svc()
    const res = await call(
      createKitchen,
      makeReq({ actor: CUSTOMER("cus_1"), body: { name: "K" }, modules: { [KITCHEN_MODULE]: service } })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createKitchens).not.toHaveBeenCalled()
  })

  it("creates the kitchen under the calling seller, whatever the body says", async () => {
    const service = svc()
    const res = await call(
      createKitchen,
      makeReq({
        actor: SELLER("sel_1"),
        body: { name: "Commissary", managing_org_id: "sel_other" },
        modules: { [KITCHEN_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createKitchens).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Commissary", managing_org_id: "sel_1" })
    )
  })
})

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

describe("PUT /store/proposals/:id — the author, before voting opens", () => {
  const svc = () => ({ updateGardenProposals: jest.fn(async (d: Row) => d) })
  const draft = { id: "prop_1", proposed_by_id: "cus_author", status: "draft" }

  it("refuses someone who did not write it", async () => {
    const service = svc()
    const res = await call(
      updateProposal,
      makeReq({
        actor: CUSTOMER("cus_stranger"),
        params: { id: "prop_1" },
        body: { votes_for: 1e6, status: "active" },
        rows: { garden_proposal: [draft] },
        modules: { [GOVERNANCE_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
    expect(service.updateGardenProposals).not.toHaveBeenCalled()
  })

  it("refuses a missing proposal the same way", async () => {
    const service = svc()
    const res = await call(
      updateProposal,
      makeReq({
        actor: CUSTOMER("cus_author"),
        params: { id: "prop_missing" },
        rows: { garden_proposal: [draft] },
        modules: { [GOVERNANCE_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
  })

  it("refuses the author once voting is open", async () => {
    const service = svc()
    const res = await call(
      updateProposal,
      makeReq({
        actor: CUSTOMER("cus_author"),
        params: { id: "prop_1" },
        body: { title: "Changed under the voters" },
        rows: { garden_proposal: [{ ...draft, status: "active" }] },
        modules: { [GOVERNANCE_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(409)
    expect(service.updateGardenProposals).not.toHaveBeenCalled()
  })

  it("refuses a result status the finalize workflow owns", async () => {
    const service = svc()
    const res = await call(
      updateProposal,
      makeReq({
        actor: CUSTOMER("cus_author"),
        params: { id: "prop_1" },
        body: { status: "passed" },
        rows: { garden_proposal: [draft] },
        modules: { [GOVERNANCE_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(400)
    expect(service.updateGardenProposals).not.toHaveBeenCalled()
  })

  it("lets the author revise a draft, and strips the tally and identity fields", async () => {
    const service = svc()
    const res = await call(
      updateProposal,
      makeReq({
        actor: CUSTOMER("cus_author"),
        params: { id: "prop_1" },
        body: {
          title: "Better title",
          votes_for: 1e6,
          total_voting_power: 1e6,
          quorum_met: true,
          proposed_by_id: "cus_someone",
          garden_id: "gdn_other",
          ledger_entry_id: "le_1",
        },
        rows: { garden_proposal: [draft] },
        modules: { [GOVERNANCE_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(200)
    expect(service.updateGardenProposals.mock.calls[0][0]).toEqual({
      id: "prop_1",
      title: "Better title",
    })
  })
})

// ---------------------------------------------------------------------------
// Food deliveries: proof of delivery and status
// ---------------------------------------------------------------------------

const notFound = () => Object.assign(new Error("not found"), { type: "not_found" })

// Query serves producers and orders. Couriers are deliberately *not* here:
// they are read through the module (below), and a courier lookup that went
// back to Query would land on an unseeded entity and fail the case.
const deliveryRows = {
  food_producer: [{ id: "prod_1", owner_id: "sel_producer" }],
  food_order: [{ id: "ord_1", customer_id: "cus_recipient" }],
}
const COURIERS: Row[] = [{ id: "cour_1", owner_id: "drv_courier" }]

const pinDelivery = {
  id: "fd_1",
  courier_id: "cour_1",
  producer_id: "prod_1",
  order_id: "ord_1",
  status: "ARRIVED_AT_DESTINATION",
  proof_type: "PIN_CODE",
  proof_pin_code: "4821",
}

// Couriers are read through the module: Query's `food_courier` entry point
// resolves to a list method the service does not have.
const listCouriers = async (filters: { id?: string }) =>
  COURIERS.filter((row) => row.id === filters.id)

const foodDistribution = (delivery: Row | null) => ({
  listCouriers: jest.fn(listCouriers),
  retrieveFoodDelivery: jest.fn(async () => {
    if (!delivery) throw notFound()
    return delivery
  }),
  recordProofOfDelivery: jest.fn(async () => ({ ...delivery, status: "DELIVERED" })),
  trackCourierLocation: jest.fn(async () => undefined),
  updateDeliveryStatus: jest.fn(async (_id: string, status: string) => ({ ...delivery, status })),
  updateFoodDeliveries: jest.fn(async (d: Row) => ({ ...delivery, ...d })),
})

const COURIER: Actor = { id: "drv_courier", type: "driver" }
const PRODUCER = SELLER("sel_producer")
const RECIPIENT = CUSTOMER("cus_recipient")

// Evidence URLs must name a file in the platform's own storage
// (`isPlatformFileUrl`). The proof cases configure MinIO as production does,
// with a public URL, so uploads live under UPLOADS.
const UPLOADS = "https://media.fbm.test/medusa-media"
const STORAGE_ENV: Record<string, string> = {
  MINIO_ENDPOINT: "minio",
  MINIO_ACCESS_KEY: "spec-access",
  MINIO_SECRET_KEY: "spec-secret",
  MINIO_BUCKET: "medusa-media",
  MINIO_PUBLIC_URL: "https://media.fbm.test",
}

describe("POST /store/food-deliveries/:id/proof — the courier, with the required proof", () => {
  const savedEnv: Record<string, string | undefined> = {}
  beforeAll(() => {
    for (const [key, value] of Object.entries(STORAGE_ENV)) {
      savedEnv[key] = process.env[key]
      process.env[key] = value
    }
  })
  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const proof = (actor: Actor | undefined, body: Row, delivery: Row | null = pinDelivery) => {
    const service = foodDistribution(delivery)
    const req = makeReq({
      actor,
      params: { id: "fd_1" },
      body,
      rows: deliveryRows,
      modules: { [FOOD_DISTRIBUTION_MODULE]: service },
    })
    return { service, req }
  }

  it("refuses a signed-in stranger, even with the right PIN", async () => {
    const { service, req } = proof(CUSTOMER("cus_stranger"), { proof_type: "PIN_CODE", pin_code: "4821" })
    const res = await call(submitProof, req)
    expect(res.statusCode).toBe(403)
    expect(service.recordProofOfDelivery).not.toHaveBeenCalled()
  })

  it("refuses the producer and the recipient: proof is the courier's statement", async () => {
    for (const actor of [PRODUCER, RECIPIENT]) {
      const { service, req } = proof(actor, { proof_type: "PIN_CODE", pin_code: "4821" })
      const res = await call(submitProof, req)
      expect(res.statusCode).toBe(403)
      expect(service.recordProofOfDelivery).not.toHaveBeenCalled()
    }
  })

  it("refuses a missing delivery the same way as someone else's", async () => {
    const { req } = proof(COURIER, { proof_type: "PHOTO" }, null)
    const res = await call(submitProof, req)
    expect(res.statusCode).toBe(403)
  })

  it("does not let the courier skip a PIN by submitting another proof type", async () => {
    const { service, req } = proof(COURIER, {
      proof_type: "PHOTO",
      photo_url: `${UPLOADS}/proof/porch.jpg`,
    })
    const res = await call(submitProof, req)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toBe("This delivery requires PIN_CODE proof")
    expect(service.recordProofOfDelivery).not.toHaveBeenCalled()
  })

  it("refuses a wrong PIN, and a PIN requirement with no PIN on record", async () => {
    const wrong = proof(COURIER, { proof_type: "PIN_CODE", pin_code: "0000" })
    expect((await call(submitProof, wrong.req)).statusCode).toBe(400)
    expect(wrong.service.recordProofOfDelivery).not.toHaveBeenCalled()

    const unset = proof(COURIER, { proof_type: "PIN_CODE" }, { ...pinDelivery, proof_pin_code: null })
    expect((await call(submitProof, unset.req)).statusCode).toBe(400)
    expect(unset.service.recordProofOfDelivery).not.toHaveBeenCalled()
  })

  it("accepts the courier with the right PIN, and does not echo the PIN back", async () => {
    const { service, req } = proof(COURIER, { proof_type: "PIN_CODE", pin_code: "4821" })
    const res = await call(submitProof, req)
    expect(res.statusCode).toBe(200)
    expect(service.recordProofOfDelivery).toHaveBeenCalledWith("fd_1", "PIN_CODE", expect.anything())
    expect(res.body.delivery).not.toHaveProperty("proof_pin_code")
  })

  it.each([
    ["PHOTO", { photo_url: `${UPLOADS}/proof/porch.jpg` }, "PHOTO proof requires photo_url"],
    ["SIGNATURE", { signature_url: `${UPLOADS}/proof/sig.png` }, "SIGNATURE proof requires signature_url"],
    ["RECIPIENT_CONFIRMATION", { recipient_name: "Ada" }, "RECIPIENT_CONFIRMATION proof requires recipient_name"],
  ])(
    "a %s requirement is met only with its evidence, not by naming the type",
    async (type, evidence, reason) => {
      const required = { ...pinDelivery, proof_type: type, proof_pin_code: null }

      const bare = proof(COURIER, { proof_type: type }, required)
      const refused = await call(submitProof, bare.req)
      expect(refused.statusCode).toBe(400)
      expect(refused.body.message).toBe(reason)
      expect(bare.service.recordProofOfDelivery).not.toHaveBeenCalled()

      if (type === "RECIPIENT_CONFIRMATION") {
        const blank = proof(COURIER, { proof_type: type, recipient_name: "   " }, required)
        expect((await call(submitProof, blank.req)).statusCode).toBe(400)
        expect(blank.service.recordProofOfDelivery).not.toHaveBeenCalled()
      }

      const met = proof(COURIER, { proof_type: type, ...evidence }, required)
      expect((await call(submitProof, met.req)).statusCode).toBe(200)
      expect(met.service.recordProofOfDelivery).toHaveBeenCalledWith("fd_1", type, expect.anything())
    }
  )

  // PHOTO, SIGNATURE and RECIPIENT_CONFIRMATION are courier-attested: the
  // courier chooses the file and types the name. What can be enforced is
  // that a URL names a file in this platform's storage, so it is not a
  // `javascript:` link or someone else's host stored on the delivery and
  // served back to its producer and recipient. zod's `.url()` passes all of
  // these.
  it.each([
    ["any scheme", "x:y"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["file:", "file:///etc/passwd"],
    ["plain http on the storage host", "http://media.fbm.test/medusa-media/proof/p.jpg"],
    ["a foreign host", "https://example.com/porch.jpg"],
    ["a look-alike host", "https://media.fbm.test.evil.example/medusa-media/proof/p.jpg"],
    ["credentials before a foreign host", "https://media.fbm.test@evil.example/medusa-media/proof/p.jpg"],
    ["another bucket on the storage host", "https://media.fbm.test/other-bucket/p.jpg"],
    ["a dot-segment out of the bucket", "https://media.fbm.test/medusa-media/%2e%2e/other-bucket/p.jpg"],
    ["the bucket itself, no file", "https://media.fbm.test/medusa-media/"],
  ])("refuses evidence that is %s, on every requirement", async (_label, url) => {
    const cases: Array<[Row, Row]> = [
      [{ ...pinDelivery, proof_type: "PHOTO", proof_pin_code: null }, { proof_type: "PHOTO", photo_url: url }],
      [{ ...pinDelivery, proof_type: "SIGNATURE", proof_pin_code: null }, { proof_type: "SIGNATURE", signature_url: url }],
      // No requirement: the URL would still be stored and served.
      [{ ...pinDelivery, proof_type: "NONE", proof_pin_code: null }, { proof_type: "PHOTO", photo_url: url }],
      // The right PIN does not carry a bad URL in with it.
      [pinDelivery, { proof_type: "PIN_CODE", pin_code: "4821", signature_url: url }],
    ]
    for (const [delivery, body] of cases) {
      const { service, req } = proof(COURIER, body, delivery)
      const res = await call(submitProof, req)
      expect([delivery.proof_type, res.statusCode]).toEqual([delivery.proof_type, 400])
      expect(service.recordProofOfDelivery).not.toHaveBeenCalled()
    }
  })

  it("accepts any proof type for a delivery created without a requirement", async () => {
    const { service, req } = proof(
      COURIER,
      { proof_type: "PHOTO", photo_url: `${UPLOADS}/proof/p.jpg` },
      { ...pinDelivery, proof_type: "NONE", proof_pin_code: null }
    )
    const res = await call(submitProof, req)
    expect(res.statusCode).toBe(200)
    expect(service.recordProofOfDelivery).toHaveBeenCalled()
  })

  it("the /:id?x=/proof twin applies the same rules", async () => {
    const stranger = proof(CUSTOMER("cus_stranger"), { proof_type: "PIN_CODE", pin_code: "4821" })
    stranger.req.url = "/store/food-deliveries/fd_1?x=/proof"
    expect((await call(submitProofTwin, stranger.req)).statusCode).toBe(403)

    const skip = proof(COURIER, { proof_type: "PHOTO", photo_url: `${UPLOADS}/proof/p.jpg` })
    skip.req.url = "/store/food-deliveries/fd_1?x=/proof"
    expect((await call(submitProofTwin, skip.req)).statusCode).toBe(400)
    expect(skip.service.recordProofOfDelivery).not.toHaveBeenCalled()
  })
})

describe("PUT /store/food-deliveries/:id — each principal for their own part", () => {
  const put = (actor: Actor | undefined, body: Row, delivery: Row = pinDelivery) => {
    const service = foodDistribution(delivery)
    const req = makeReq({
      actor,
      params: { id: "fd_1" },
      body,
      rows: deliveryRows,
      modules: { [FOOD_DISTRIBUTION_MODULE]: service },
    })
    return { service, req }
  }

  it("refuses a stranger", async () => {
    const { service, req } = put(CUSTOMER("cus_stranger"), { status: "CANCELLED" })
    expect((await call(updateDelivery, req)).statusCode).toBe(403)
    expect(service.updateDeliveryStatus).not.toHaveBeenCalled()
  })

  it("refuses a status change from the recipient", async () => {
    const { service, req } = put(RECIPIENT, { status: "CANCELLED" })
    expect((await call(updateDelivery, req)).statusCode).toBe(403)
    expect(service.updateDeliveryStatus).not.toHaveBeenCalled()
  })

  it("refuses DELIVERED on a delivery that requires proof, even from its courier", async () => {
    const { service, req } = put(COURIER, { status: "DELIVERED" })
    const res = await call(updateDelivery, req)
    expect(res.statusCode).toBe(409)
    expect(service.updateDeliveryStatus).not.toHaveBeenCalled()
  })

  it("lets the courier move the delivery along, without returning the PIN", async () => {
    const { service, req } = put(COURIER, { status: "EN_ROUTE_DELIVERY" })
    const res = await call(updateDelivery, req)
    expect(res.statusCode).toBe(200)
    expect(service.updateDeliveryStatus).toHaveBeenCalledWith(
      "fd_1",
      "EN_ROUTE_DELIVERY",
      undefined,
      undefined
    )
    expect(res.body.delivery).not.toHaveProperty("proof_pin_code")
  })

  it("lets only the recipient rate it", async () => {
    const asCourier = put(COURIER, { customer_rating: 5 })
    expect((await call(updateDelivery, asCourier.req)).statusCode).toBe(403)
    expect(asCourier.service.updateFoodDeliveries).not.toHaveBeenCalled()

    const asRecipient = put(RECIPIENT, { customer_rating: 5, customer_feedback: "ok" })
    expect((await call(updateDelivery, asRecipient.req)).statusCode).toBe(200)
    expect(asRecipient.service.updateFoodDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fd_1", customer_rating: 5 })
    )
  })

  it("limits the producer to the hand-over statuses /vendor allows it", async () => {
    const noProof = { ...pinDelivery, status: "ASSIGNED", proof_type: "NONE", proof_pin_code: null }
    for (const status of ["ARRIVED_AT_DESTINATION", "DELIVERED", "DELIVERED_TO_SAFE_PLACE", "EN_ROUTE_DELIVERY"]) {
      const { service, req } = put(PRODUCER, { status }, noProof)
      expect((await call(updateDelivery, req)).statusCode).toBe(403)
      expect(service.updateDeliveryStatus).not.toHaveBeenCalled()
    }

    const handOver = put(PRODUCER, { status: "ORDER_PICKED_UP" }, noProof)
    expect((await call(updateDelivery, handOver.req)).statusCode).toBe(200)
    expect(handOver.service.updateDeliveryStatus).toHaveBeenCalledWith(
      "fd_1",
      "ORDER_PICKED_UP",
      undefined,
      undefined
    )
  })

  it("does not let the producer write the courier's position", async () => {
    const { service, req } = put(PRODUCER, { status: "WAITING_FOR_ORDER", latitude: 1, longitude: 2 })
    expect((await call(updateDelivery, req)).statusCode).toBe(403)
    expect(service.updateDeliveryStatus).not.toHaveBeenCalled()

    const courier = put(COURIER, { status: "EN_ROUTE_DELIVERY", latitude: 1, longitude: 2 })
    expect((await call(updateDelivery, courier.req)).statusCode).toBe(200)
    expect(courier.service.updateDeliveryStatus).toHaveBeenCalledWith(
      "fd_1",
      "EN_ROUTE_DELIVERY",
      { latitude: 1, longitude: 2 },
      undefined
    )
  })
})

describe("POST /store/food-deliveries/:id/track — the courier's position is the courier's to write", () => {
  const track = (actor: Actor | undefined, delivery: Row | null = pinDelivery) => {
    const service = {
      ...foodDistribution(delivery),
      updateCourierLocation: jest.fn(async () => undefined),
    }
    const req = makeReq({
      actor,
      params: { id: "fd_1" },
      body: { latitude: 37.8, longitude: -122.27 },
      rows: deliveryRows,
      modules: { [FOOD_DISTRIBUTION_MODULE]: service },
    })
    return { service, req }
  }

  it.each([
    ["a signed-in stranger", CUSTOMER("cus_stranger")],
    ["the recipient", RECIPIENT],
    ["the producer", PRODUCER],
  ])("refuses %s", async (_label, actor) => {
    const { service, req } = track(actor)
    expect((await call(trackDelivery, req)).statusCode).toBe(403)
    expect(service.trackCourierLocation).not.toHaveBeenCalled()
    expect(service.updateCourierLocation).not.toHaveBeenCalled()
  })

  it("refuses a missing delivery the same way as someone else's", async () => {
    const { req } = track(COURIER, null)
    expect((await call(trackDelivery, req)).statusCode).toBe(403)
  })

  it("records the courier's own position", async () => {
    const { service, req } = track(COURIER)
    const res = await call(trackDelivery, req)
    expect(res.statusCode).toBe(200)
    expect(service.trackCourierLocation).toHaveBeenCalledWith("fd_1", 37.8, -122.27, undefined, undefined)
    expect(service.updateCourierLocation).toHaveBeenCalledWith("cour_1", 37.8, -122.27)
  })
})

describe("POST /store/food-deliveries — the order's producer, once per order", () => {
  const body = {
    order_id: "ord_1",
    pickup_address: "1 Kitchen Way",
    delivery_address: "2 Home St",
    recipient_name: "R",
    proof_type: "PIN_CODE",
    proof_pin_code: "1234",
  }
  const svc = (order: Row | null, existingDeliveries: Row[] = []) => ({
    listCouriers: jest.fn(listCouriers),
    retrieveFoodOrder: jest.fn(async () => {
      if (!order) throw notFound()
      return order
    }),
    listFoodDeliveries: jest.fn(async () => existingDeliveries),
    createDeliveryForOrder: jest.fn(async (orderId: string, data: Row) => ({
      id: "fd_new",
      order_id: orderId,
      ...data,
    })),
  })
  const order = { id: "ord_1", producer_id: "prod_1", customer_id: "cus_recipient" }
  const create = (actor: Actor | undefined, service: ReturnType<typeof svc>) =>
    call(
      createFoodDelivery,
      makeReq({ actor, body, rows: deliveryRows, modules: { [FOOD_DISTRIBUTION_MODULE]: service } })
    )

  it.each([
    ["a signed-in stranger", CUSTOMER("cus_stranger")],
    ["the order's recipient", RECIPIENT],
    ["a courier", COURIER],
  ])("refuses %s", async (_label, actor) => {
    const service = svc(order)
    expect((await create(actor, service)).statusCode).toBe(403)
    expect(service.createDeliveryForOrder).not.toHaveBeenCalled()
  })

  it("refuses a missing order the same way as someone else's", async () => {
    const service = svc(null)
    expect((await create(PRODUCER, service)).statusCode).toBe(403)
    expect(service.createDeliveryForOrder).not.toHaveBeenCalled()
  })

  it("refuses a second delivery for the same order", async () => {
    const service = svc(order, [{ id: "fd_existing" }])
    expect((await create(PRODUCER, service)).statusCode).toBe(409)
    expect(service.createDeliveryForOrder).not.toHaveBeenCalled()
  })

  it.each([
    ["no PIN", {}],
    ["an empty PIN", { proof_pin_code: "" }],
    ["a 3-digit PIN", { proof_pin_code: "123" }],
    ["a PIN that is not digits", { proof_pin_code: "abcd" }],
    // Pin both anchors of DELIVERY_PIN_PATTERN: unanchored, these pass.
    ["digits then letters", { proof_pin_code: "1234ab" }],
    ["letters then digits", { proof_pin_code: "ab1234" }],
  ])("refuses a PIN_CODE delivery with %s, which could never be delivered", async (_label, pin) => {
    const service = svc(order)
    const { proof_pin_code: _omit, ...rest } = body
    const res = await call(
      createFoodDelivery,
      makeReq({
        actor: PRODUCER,
        body: { ...rest, ...pin },
        rows: deliveryRows,
        modules: { [FOOD_DISTRIBUTION_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.body.errors)).toContain("proof_pin_code")
    expect(service.createDeliveryForOrder).not.toHaveBeenCalled()
  })

  it("lets the producer create it, and does not echo the PIN", async () => {
    const service = svc(order)
    const res = await create(PRODUCER, service)
    expect(res.statusCode).toBe(201)
    expect(service.createDeliveryForOrder).toHaveBeenCalledWith(
      "ord_1",
      expect.objectContaining({ proof_type: "PIN_CODE", proof_pin_code: "1234" })
    )
    expect(res.body.delivery).not.toHaveProperty("proof_pin_code")
  })
})

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

describe("POST /store/food-trades/:id — the producer the trade was offered to", () => {
  const trade = {
    id: "ord_trade",
    producer_id: "prod_1",
    customer_id: "cus_offerer",
    transaction_type: "TRADE",
    status: "PENDING",
  }
  const svc = (order: Row | null) => ({
    retrieveFoodOrder: jest.fn(async () => {
      if (!order) throw notFound()
      return order
    }),
    updateFoodOrders: jest.fn(async (d: Row) => ({ ...order, ...d })),
  })
  const respond = (actor: Actor | undefined, service: ReturnType<typeof svc>) =>
    call(
      respondToTrade,
      makeReq({
        actor,
        params: { id: "ord_trade" },
        body: { accepted: true },
        rows: deliveryRows,
        modules: { [FOOD_DISTRIBUTION_MODULE]: service },
      })
    )

  it.each([
    ["a signed-in stranger", CUSTOMER("cus_stranger")],
    ["the customer who offered it", CUSTOMER("cus_offerer")],
    ["another seller", SELLER("sel_other")],
  ])("refuses %s", async (_label, actor) => {
    const service = svc(trade)
    expect((await respond(actor, service)).statusCode).toBe(403)
    expect(service.updateFoodOrders).not.toHaveBeenCalled()
  })

  it("refuses a missing trade the same way as someone else's", async () => {
    const service = svc(null)
    expect((await respond(PRODUCER, service)).statusCode).toBe(403)
  })

  it("lets the producer accept it", async () => {
    const service = svc(trade)
    const res = await respond(PRODUCER, service)
    expect(res.statusCode).toBe(200)
    expect(service.updateFoodOrders).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ord_trade", status: "CONFIRMED", trade_accepted: true })
    )
  })
})

// ---------------------------------------------------------------------------
// Customer-identity writes: a seller or driver token cannot act as a customer
// ---------------------------------------------------------------------------

describe("customer-identity community writes refuse seller and driver tokens", () => {
  /**
   * Each of these writes a record under a customer id. They used to take that
   * id from the token for a customer and from the body for anyone else, so a
   * seller or driver token could vote, claim, log hours, join a garden or
   * author a proposal as any customer.
   *
   * The refusal must come before the handler touches anything, so the seller
   * and driver cases use a container that records every lookup and expect it
   * to stay empty. The customer case uses one that throws on the first lookup:
   * reaching it proves the customer got past the gate, without standing up
   * every route's services.
   */
  const handlers: Array<[string, (req: never, res: never) => unknown, Record<string, string>]> = [
    ["POST /store/gardens/:id/members", joinGarden, { id: "gdn_1" }],
    ["POST /store/harvests/:id/claims", claimHarvest, { id: "hv_1" }],
    ["POST /store/work-parties/:id/signups", signUpForWorkParty, { id: "wp_1" }],
    ["POST /store/volunteer-logs", logVolunteerHours, {}],
    ["POST /store/harvests", recordHarvest, {}],
    ["POST /store/proposals", createProposal, {}],
    ["POST /store/seasons/:id/plantings", recordPlanting, { id: "sea_1" }],
    ["POST /store/work-parties", createWorkParty, {}],
    ["POST /store/proposals/:id/votes", castVote, { id: "prop_1" }],
  ]

  const reqFor = (actor: Actor, params: Record<string, string>, onResolve: (key: string) => unknown) => ({
    params,
    body: { customer_id: "cus_victim", membership_id: "gm_victim", garden_id: "gdn_1" },
    query: {},
    url: "/",
    auth_context: { actor_id: actor.id, actor_type: actor.type },
    scope: { resolve: onResolve },
  })

  it.each(handlers)("%s refuses a seller or driver before any lookup", async (_label, handler, params) => {
    for (const actor of [SELLER("sel_1"), { id: "drv_1", type: "driver" as const }]) {
      const resolved: string[] = []
      const res = createRes()
      await handler(
        reqFor(actor, params, (key) => {
          resolved.push(key)
          throw new Error(`resolved ${key}`)
        }) as never,
        res as never
      )
      expect(res.statusCode).toBe(403)
      expect(res.body.type).toBe("not_allowed")
      expect(resolved).toEqual([])
    }
  })

  it.each(handlers)("%s lets a customer through to the handler", async (_label, handler, params) => {
    const res = createRes()
    await expect(
      handler(
        reqFor(CUSTOMER("cus_me"), params, (key) => {
          throw new Error(`reached ${key}`)
        }) as never,
        res as never
      )
    ).rejects.toThrow(/^reached /)
    expect(res.statusCode).not.toBe(403)
  })
})

describe("POST /store/proposals/:id/votes — the voter's own active membership in this garden", () => {
  /**
   * The membership supplies the voting power. Only its owner used to be
   * checked, so a stranger to garden A voted on A's proposal with the balances
   * of their membership in garden B (a probe wrote voting_power 526), and a
   * caller with no membership voted at base power 1.
   */
  const proposal = {
    id: "prop_1",
    garden_id: "gdn_A",
    status: "active",
    voting_end: new Date(Date.now() + 86_400_000).toISOString(),
    votes_for: 0,
    votes_against: 0,
    votes_abstain: 0,
    total_voting_power: 0,
    unique_voters: 0,
  }
  const membership = (over: Row = {}) => ({
    id: "gm_mine",
    customer_id: "cus_voter",
    garden_id: "gdn_A",
    status: "active",
    volunteer_hours_balance: 500,
    investment_balance: 100000,
    roles: [],
    ...over,
  })
  // castBallot writes the ballot and its tally increment in one transaction,
  // and returns null when the unique ballot index refused it (Postgres:
  // integration-tests/http/store-community-write-authz.spec.ts).
  const governance = (castBallot: (b: Row) => Promise<Row | null> = async (b) => ({ id: "vote_1", ...b })) => ({
    castBallot: jest.fn(castBallot),
  })
  const vote = (
    memberships: Row[],
    body: Row = { membership_id: "gm_mine", vote: "for" },
    service = governance()
  ) => {
    const req = makeReq({
      actor: CUSTOMER("cus_voter"),
      params: { id: "prop_1" },
      body,
      rows: {
        garden_proposal: [proposal],
        garden_vote: [],
        garden_membership: memberships,
        garden: [{ id: "gdn_A", governance_model: "hybrid", settings: null }],
      },
      modules: { [GOVERNANCE_MODULE]: service },
    })
    return { service, req }
  }

  it.each([
    ["a membership in another garden", [membership({ garden_id: "gdn_B" })], undefined],
    ["a membership that is not active", [membership({ status: "pending" })], undefined],
    ["someone else's membership", [membership({ customer_id: "cus_other" })], undefined],
    ["a membership id that does not exist", [], undefined],
    ["no membership id at all", [membership()], { vote: "for" }],
    // The fake Query matches `{ id: undefined }` against this row, so only
    // the route's own string check refuses it, not an empty lookup.
    ["no membership id, where a lookup by undefined would match", [membership({ id: undefined })], { vote: "for" }],
  ])("refuses %s", async (_label, memberships, body) => {
    const { service, req } = vote(memberships as Row[], body as Row | undefined)
    const res = await call(castVote, req)
    expect(res.statusCode).toBe(403)
    expect(service.castBallot).not.toHaveBeenCalled()
  })

  it.each([
    ["a vote that is not for, against or abstain", { membership_id: "gm_mine", vote: "yes" }],
    ["no vote at all", { membership_id: "gm_mine" }],
    ["an unknown comment visibility", { membership_id: "gm_mine", vote: "for", comment: "c", comment_visibility: "Private" }],
  ])("refuses %s with 400, before anything is written", async (_label, body) => {
    const { service, req } = vote([membership()], body)
    const res = await call(castVote, req)
    expect(res.statusCode).toBe(400)
    expect(service.castBallot).not.toHaveBeenCalled()
  })

  it("answers a ballot the unique index refused as already voted, not as a server error", async () => {
    // Both requests of a concurrent pair pass the "already voted" read; the
    // second insert hits IDX_garden_vote_proposal_customer_unique.
    const { service, req } = vote([membership()], undefined, governance(async () => null))
    const res = await call(castVote, req)
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toBe("You have already voted on this proposal")
    expect(service.castBallot).toHaveBeenCalledTimes(1)
  })

  it("counts the vote of an active member of the proposal's garden, under their own membership", async () => {
    const { service, req } = vote([membership()])
    const res = await call(castVote, req)
    expect(res.statusCode).toBe(201)
    expect(service.castBallot).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal_id: "prop_1",
        garden_id: "gdn_A",
        customer_id: "cus_voter",
        membership_id: "gm_mine",
        vote: "for",
        comment_visibility: "public",
      })
    )
  })
})

describe("POST /store/food-producers/:id/orders — the order's customer comes from the token", () => {
  const svc = () => ({
    retrieveFoodProducer: jest.fn(async () => ({
      id: "prod_1",
      operating_status: "ACCEPTING_ORDERS",
      accepts_donations: true,
      accepts_trades: true,
      offers_delivery: true,
      offers_pickup: true,
      delivery_fee: 0,
    })),
    createFoodOrderWithItems: jest.fn(async (order: Row, items: Row[]) => ({ order: { id: "ord_new", ...order }, items })),
  })
  const body = {
    transaction_type: "SALE",
    fulfillment_type: "PICKUP",
    customer_id: "cus_victim",
    items: [{ name: "Tomatoes", quantity: 1, unit_price: 2 }],
  }

  it.each([
    ["a seller (unattributed)", SELLER("sel_1"), undefined],
    ["a driver (unattributed)", { id: "drv_1", type: "driver" as const }, undefined],
    ["a customer (their own id)", CUSTOMER("cus_me"), "cus_me"],
  ])("%s: the order's customer_id comes from the token, never the body", async (_label, actor, expected) => {
    const service = svc()
    const res = await call(
      placeProducerOrder,
      makeReq({ actor, params: { id: "prod_1" }, body, modules: { [FOOD_DISTRIBUTION_MODULE]: service } })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createFoodOrderWithItems.mock.calls[0][0].customer_id).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Restaurant deliveries
// ---------------------------------------------------------------------------

describe("POST /store/deliveries — the caller's own cart", () => {
  beforeEach(() => {
    mockCreateDeliveryRun.mockReset().mockResolvedValue({ result: { id: "del_1" } })
    mockHandleDeliveryRun.mockReset().mockResolvedValue({ transaction: { id: "tx_1" } })
  })

  const carts = {
    cart: [
      { id: "cart_mine", customer_id: "cus_me" },
      { id: "cart_guest", customer_id: null },
    ],
  }

  it.each([
    ["someone else's cart", "cus_stranger", "cart_mine"],
    ["a cart with no customer", "cus_me", "cart_guest"],
    ["a cart that does not exist", "cus_me", "cart_missing"],
  ])("refuses %s", async (_label, actorId, cartId) => {
    const res = await call(
      createRestaurantDelivery,
      makeReq({
        actor: CUSTOMER(actorId),
        body: { cart_id: cartId, restaurant_id: "rest_1" },
        rows: carts,
      })
    )
    expect(res.statusCode).toBe(403)
    expect(mockCreateDeliveryRun).not.toHaveBeenCalled()
    expect(mockHandleDeliveryRun).not.toHaveBeenCalled()
  })

  it("starts a delivery for the owner's cart", async () => {
    const res = await call(
      createRestaurantDelivery,
      makeReq({
        actor: CUSTOMER("cus_me"),
        body: { cart_id: "cart_mine", restaurant_id: "rest_1" },
        rows: carts,
      })
    )
    expect(res.statusCode).toBe(200)
    expect(mockCreateDeliveryRun).toHaveBeenCalledWith({
      input: { cart_id: "cart_mine", restaurant_id: "rest_1" },
    })
  })
})

// ---------------------------------------------------------------------------
// Delivery zones
// ---------------------------------------------------------------------------

describe("/store/delivery-zones writes — the seller who created the zone, through /vendor's checks", () => {
  const square = (lng: number, lat: number) => ({
    type: "Polygon" as const,
    coordinates: [[[lng, lat], [lng, lat + 1], [lng + 1, lat + 1], [lng + 1, lat], [lng, lat]]],
  })
  const zone = (owner: string | null) => ({
    id: "zone_1",
    code: "EAST",
    name: "East",
    boundary: square(0, 0),
    center_latitude: 0.5,
    center_longitude: 0.5,
    base_delivery_fee: 500,
    per_mile_fee: 0,
    minimum_order: null,
    service_hours: null,
    active: true,
    priority: 0,
    created_by_seller_id: owner,
  })
  const svc = (existing: Row | null = zone("sel_owner"), activeZones: Row[] = []) => ({
    listDeliveryZones: jest.fn(async (filters: Row) => ("active" in filters ? activeZones : [])),
    createDeliveryZones: jest.fn(async (d: Row) => ({ id: "zone_new", ...d })),
    retrieveDeliveryZone: jest.fn(async () => existing),
    updateDeliveryZones: jest.fn(async (d: Row) => d),
  })
  const newZone = {
    name: "East",
    code: "EAST",
    boundary: square(0, 0),
    center_latitude: 0.5,
    center_longitude: 0.5,
  }
  // Far from (0, 0): no radius or bounding-box overlap with `newZone`.
  const elsewhere = { ...zone("sel_other"), id: "zone_far", code: "FAR", boundary: square(40, 40), center_latitude: 40.5, center_longitude: 40.5 }

  it("POST refuses a customer", async () => {
    const service = svc()
    const res = await call(
      createZone,
      makeReq({ actor: CUSTOMER("cus_1"), body: newZone, modules: { [FOOD_DISTRIBUTION_MODULE]: service } })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createDeliveryZones).not.toHaveBeenCalled()
  })

  it("POST stamps the calling seller as the zone's owner, and stores dollars as cents", async () => {
    const service = svc(null, [elsewhere])
    const res = await call(
      createZone,
      makeReq({
        actor: SELLER("sel_owner"),
        body: { ...newZone, base_delivery_fee: 5, per_mile_fee: 1.25, created_by_seller_id: "sel_other" },
        modules: { [FOOD_DISTRIBUTION_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createDeliveryZones).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "EAST",
        created_by_seller_id: "sel_owner",
        base_delivery_fee: 500,
        per_mile_fee: 125,
      })
    )
  })

  it("POST refuses a zone that overlaps an active one, as /vendor does", async () => {
    const service = svc(null, [{ ...zone("sel_other"), id: "zone_rival", code: "RIVAL" }])
    const res = await call(
      createZone,
      makeReq({ actor: SELLER("sel_owner"), body: newZone, modules: { [FOOD_DISTRIBUTION_MODULE]: service } })
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe("DELIVERY_ZONE_CONFLICT")
    expect(service.createDeliveryZones).not.toHaveBeenCalled()
  })

  it.each([
    ["a customer", CUSTOMER("cus_1"), zone("sel_owner")],
    ["another seller", SELLER("sel_other"), zone("sel_owner")],
    ["any seller, on a legacy admin-managed zone", SELLER("sel_owner"), zone(null)],
  ])("PUT and DELETE refuse %s", async (_label, actor, existing) => {
    const forPut = svc(existing)
    const put = await call(
      updateZone,
      makeReq({
        actor,
        params: { id: "zone_1" },
        body: { base_delivery_fee: 0, active: false },
        modules: { [FOOD_DISTRIBUTION_MODULE]: forPut },
      })
    )
    expect(put.statusCode).toBe(403)
    expect(forPut.updateDeliveryZones).not.toHaveBeenCalled()

    const forDelete = svc(existing)
    const del = await call(
      deleteZone,
      makeReq({ actor, params: { id: "zone_1" }, modules: { [FOOD_DISTRIBUTION_MODULE]: forDelete } })
    )
    expect(del.statusCode).toBe(403)
    expect(forDelete.updateDeliveryZones).not.toHaveBeenCalled()
  })

  it("PUT refuses moving the owner's zone over another active zone", async () => {
    const service = svc(zone("sel_owner"), [
      zone("sel_owner"),
      { ...elsewhere, id: "zone_rival", code: "RIVAL" },
    ])
    const res = await call(
      updateZone,
      makeReq({
        actor: SELLER("sel_owner"),
        params: { id: "zone_1" },
        body: { boundary: square(40, 40), center_latitude: 40.5, center_longitude: 40.5 },
        modules: { [FOOD_DISTRIBUTION_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(409)
    expect(service.updateDeliveryZones).not.toHaveBeenCalled()
  })

  it("PUT and DELETE serve the owner; PUT takes dollars and stores cents", async () => {
    const forPut = svc(zone("sel_owner"), [zone("sel_owner"), elsewhere])
    const put = await call(
      updateZone,
      makeReq({
        actor: SELLER("sel_owner"),
        params: { id: "zone_1" },
        body: { base_delivery_fee: 2.5 },
        modules: { [FOOD_DISTRIBUTION_MODULE]: forPut },
      })
    )
    expect(put.statusCode).toBe(200)
    expect(forPut.updateDeliveryZones).toHaveBeenCalledWith({ id: "zone_1", base_delivery_fee: 250 })

    const forDelete = svc()
    const del = await call(
      deleteZone,
      makeReq({ actor: SELLER("sel_owner"), params: { id: "zone_1" }, modules: { [FOOD_DISTRIBUTION_MODULE]: forDelete } })
    )
    expect(del.statusCode).toBe(200)
    expect(forDelete.updateDeliveryZones).toHaveBeenCalledWith({ id: "zone_1", active: false })
  })
})
