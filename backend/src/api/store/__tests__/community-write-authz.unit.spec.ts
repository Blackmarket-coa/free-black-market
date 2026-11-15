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
 * Query, and the two framework keys `requireSellerId` touches — and throws on
 * anything else, so a route that resolved a guessed key would fail here
 * rather than pass on a fallback. Query honours `filters`, so a membership
 * that exists but is pending, or of the wrong type, does not count.
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
    }) => ({
      data: (opts.rows?.[entity] ?? []).filter((row) => matches(row, filters)),
    }),
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
      makeReq({ actor: CUSTOMER("cus_stranger"), params: { id: "gdn_1" } }),
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
  const svc = () => ({
    createHarvestAllocations: jest.fn(async (d: Row) => d),
    updateGardenHarvests: jest.fn(async (d: Row) => d),
  })
  const harvest = { id: "hv_1", garden_id: "gdn_1", total_quantity: 100, total_estimated_value: 1000 }

  it("refuses a missing harvest the same way as someone else's", async () => {
    const service = svc()
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "hv_missing" },
        rows: { garden_membership: [organizer("cus_org")] },
        modules: { [HARVEST_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
  })

  it("refuses a non-organizer", async () => {
    const service = svc()
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_stranger"),
        params: { id: "hv_1" },
        rows: { garden_harvest: [harvest] },
        modules: { [HARVEST_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createHarvestAllocations).not.toHaveBeenCalled()
    expect(service.updateGardenHarvests).not.toHaveBeenCalled()
  })

  it("lets the garden's organizer allocate", async () => {
    const service = svc()
    const res = await call(
      allocateHarvest,
      makeReq({
        actor: CUSTOMER("cus_org"),
        params: { id: "hv_1" },
        rows: { garden_harvest: [harvest], garden_membership: [organizer("cus_org")] },
        modules: { [HARVEST_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createHarvestAllocations).toHaveBeenCalled()
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

const deliveryRows = {
  food_courier: [{ id: "cour_1", owner_id: "drv_courier" }],
  food_producer: [{ id: "prod_1", owner_id: "sel_producer" }],
  food_order: [{ id: "ord_1", customer_id: "cus_recipient" }],
}

const pinDelivery = {
  id: "fd_1",
  courier_id: "cour_1",
  producer_id: "prod_1",
  order_id: "ord_1",
  status: "ARRIVED_AT_DESTINATION",
  proof_type: "PIN_CODE",
  proof_pin_code: "4821",
}

const foodDistribution = (delivery: Row | null) => ({
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

describe("POST /store/food-deliveries/:id/proof — the courier, with the required proof", () => {
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
      photo_url: "https://example.com/porch.jpg",
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

  it("accepts any proof type for a delivery created without a requirement", async () => {
    const { service, req } = proof(
      COURIER,
      { proof_type: "PHOTO", photo_url: "https://example.com/p.jpg" },
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

    const skip = proof(COURIER, { proof_type: "PHOTO", photo_url: "https://example.com/p.jpg" })
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

describe("/store/delivery-zones writes — the seller who created the zone", () => {
  const zone = (owner: string | null) => ({
    id: "zone_1",
    code: "EAST",
    name: "East",
    created_by_seller_id: owner,
  })
  const svc = (existing: Row | null = zone("sel_owner")) => ({
    listDeliveryZones: jest.fn(async () => []),
    createDeliveryZones: jest.fn(async (d: Row) => ({ id: "zone_new", ...d })),
    retrieveDeliveryZone: jest.fn(async () => existing),
    updateDeliveryZones: jest.fn(async (d: Row) => d),
  })
  const newZone = {
    name: "East",
    code: "EAST",
    boundary: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    center_latitude: 0.5,
    center_longitude: 0.5,
  }

  it("POST refuses a customer", async () => {
    const service = svc()
    const res = await call(
      createZone,
      makeReq({ actor: CUSTOMER("cus_1"), body: newZone, modules: { [FOOD_DISTRIBUTION_MODULE]: service } })
    )
    expect(res.statusCode).toBe(403)
    expect(service.createDeliveryZones).not.toHaveBeenCalled()
  })

  it("POST stamps the calling seller as the zone's owner", async () => {
    const service = svc()
    const res = await call(
      createZone,
      makeReq({
        actor: SELLER("sel_owner"),
        body: { ...newZone, created_by_seller_id: "sel_other" },
        modules: { [FOOD_DISTRIBUTION_MODULE]: service },
      })
    )
    expect(res.statusCode).toBe(201)
    expect(service.createDeliveryZones).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EAST", created_by_seller_id: "sel_owner" })
    )
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

  it("PUT and DELETE serve the owner", async () => {
    const forPut = svc()
    const put = await call(
      updateZone,
      makeReq({
        actor: SELLER("sel_owner"),
        params: { id: "zone_1" },
        body: { base_delivery_fee: 250 },
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
