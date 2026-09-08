import { GET, POST } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"

/**
 * `/vendor/share-box-templates` — the first caller of the share-box service.
 *
 * `createShareBoxTemplate` and the rest of that surface shipped with the
 * order-cycle module and were called from no route, job, workflow, subscriber
 * or screen, so a coordinator could not define a template and no box was ever
 * generated (`docs/CDFI_COOP_ROADMAP.md` §3.7).
 *
 * The scoping assertions are the point: a template list must never be a
 * marketplace directory of other coordinators' box definitions, and
 * `coordinator_seller_id` must come from the authenticated caller rather than
 * the request body.
 */

// api/vendor/** is inside the TS-3 de-`any`'d ratchet; typed doubles, no `any`.
type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
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

const SLOTS = [{ key: "leafy_green", label: "Leafy Green", quantity: 1 }]

// Parameters are declared even though the bodies ignore them: without them
// `mock.calls[0]` is typed as the empty tuple, and the filter assertions below
// cannot read argument 0. `tsc` catches that; jest, which transpiles without
// type-checking, does not.
const makeService = () => ({
  listAndCountShareBoxTemplates: jest.fn(
    async (
      _filters: Record<string, unknown>,
      _config?: Record<string, unknown>
    ) => [[{ id: "sbt_1" }], 1]
  ),
  createShareBoxTemplate: jest.fn(async (args: Record<string, unknown>) => ({
    id: "sbt_new",
    ...args,
  })),
})

type Service = ReturnType<typeof makeService>

const makeReq = (
  service: Service,
  actorId: string | undefined,
  extra: { query?: Record<string, unknown>; body?: unknown } = {}
) => ({
  params: {},
  query: extra.query ?? {},
  body: extra.body,
  auth_context: actorId ? { actor_id: actorId } : undefined,
  scope: {
    resolve: (key: string) =>
      key === ORDER_CYCLE_MODULE || key === "orderCycleModuleService"
        ? service
        : undefined,
  },
})

type GetArgs = Parameters<typeof GET>
type PostArgs = Parameters<typeof POST>

const callGet = async (
  service: Service,
  actorId: string | undefined,
  query: Record<string, unknown> = {}
) => {
  const res = createRes()
  await GET(
    makeReq(service, actorId, { query }) as unknown as GetArgs[0],
    res as unknown as GetArgs[1]
  )
  return res
}

const callPost = async (
  service: Service,
  actorId: string | undefined,
  body: unknown
) => {
  const res = createRes()
  await POST(
    makeReq(service, actorId, { body }) as unknown as PostArgs[0],
    res as unknown as PostArgs[1]
  )
  return res
}

describe("GET /vendor/share-box-templates", () => {
  it("401s without an authenticated seller", async () => {
    const service = makeService()
    const res = await callGet(service, undefined)
    expect(res.statusCode).toBe(401)
    expect(service.listAndCountShareBoxTemplates).not.toHaveBeenCalled()
  })

  it("always scopes the list to the caller", async () => {
    const service = makeService()
    await callGet(service, "sel_me")
    const [filters] = service.listAndCountShareBoxTemplates.mock.calls[0]
    expect(filters.coordinator_seller_id).toContain("sel_me")
  })

  it("cannot be widened by a query parameter", async () => {
    // A coordinator_seller_id in the query must not reach the filter — that
    // would turn this into a directory of other coordinators' templates.
    const service = makeService()
    await callGet(service, "sel_me", { coordinator_seller_id: "sel_other" })
    const [filters] = service.listAndCountShareBoxTemplates.mock.calls[0]
    expect(JSON.stringify(filters)).not.toContain("sel_other")
  })

  it("passes through the is_active filter, and only when given", async () => {
    const service = makeService()
    await callGet(service, "sel_me", { is_active: "true" })
    expect(service.listAndCountShareBoxTemplates.mock.calls[0][0].is_active).toBe(
      true
    )

    const service2 = makeService()
    await callGet(service2, "sel_me")
    expect(service2.listAndCountShareBoxTemplates.mock.calls[0][0]).not.toHaveProperty(
      "is_active"
    )
  })
})

describe("POST /vendor/share-box-templates", () => {
  it("401s without an authenticated seller", async () => {
    const service = makeService()
    const res = await callPost(service, undefined, { name: "Box", slots: SLOTS })
    expect(res.statusCode).toBe(401)
    expect(service.createShareBoxTemplate).not.toHaveBeenCalled()
  })

  it("requires a name", async () => {
    const service = makeService()
    for (const name of [undefined, "", "   "]) {
      const res = await callPost(service, "sel_me", { name, slots: SLOTS })
      expect(res.statusCode).toBe(400)
    }
    expect(service.createShareBoxTemplate).not.toHaveBeenCalled()
  })

  it("refuses a template with no slots", async () => {
    // An empty template generates an empty box for every member: the cycle
    // looks scheduled and delivers nothing.
    const service = makeService()
    for (const slots of [undefined, [], "not an array"]) {
      const res = await callPost(service, "sel_me", { name: "Box", slots })
      expect(res.statusCode).toBe(400)
    }
    expect(service.createShareBoxTemplate).not.toHaveBeenCalled()
  })

  it("takes coordinator_seller_id from the caller, never the body", async () => {
    const service = makeService()
    const res = await callPost(service, "sel_me", {
      name: "Autumn Box",
      slots: SLOTS,
      coordinator_seller_id: "sel_someone_else",
    })
    expect(res.statusCode).toBe(201)
    const [args] = service.createShareBoxTemplate.mock.calls[0] as [
      Record<string, unknown>,
    ]
    expect(args.coordinator_seller_id).toBe("sel_me")
  })

  it("trims the name and creates", async () => {
    const service = makeService()
    const res = await callPost(service, "sel_me", {
      name: "  Autumn Box  ",
      slots: SLOTS,
    })
    expect(res.statusCode).toBe(201)
    const [args] = service.createShareBoxTemplate.mock.calls[0] as [
      Record<string, unknown>,
    ]
    expect(args.name).toBe("Autumn Box")
  })

  it("400s rather than 500s when the service rejects the slots", async () => {
    const service = makeService()
    service.createShareBoxTemplate.mockRejectedValueOnce(
      new Error("slot.quantity must be a positive integer")
    )
    const res = await callPost(service, "sel_me", {
      name: "Box",
      slots: [{ key: "x", quantity: -1 }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({
      message: "slot.quantity must be a positive integer",
    })
  })
})
