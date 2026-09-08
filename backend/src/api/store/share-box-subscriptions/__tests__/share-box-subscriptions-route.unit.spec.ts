import { GET, POST } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../modules/order-cycle"

/**
 * `/store/share-box-subscriptions` — the member half of the CSA scheduler, and
 * the first caller of `createShareBoxSubscriptionRecord` and its siblings.
 *
 * Two behaviours here are not obvious from the service signatures and are the
 * reason this suite exists:
 *
 * 1. `share_box_subscription` has a UNIQUE index on
 *    (`share_box_template_id`, `customer_id`). A member holds at most one row
 *    per template, so re-subscribing after cancelling must revive that row —
 *    creating a second would trip the index and 500.
 * 2. Subscribing to an `is_active: false` template would produce a
 *    subscription that can never generate a box, because
 *    `generateBoxesForCycle` filters on `is_active` and #840 made deleting a
 *    subscribed template deactivate it instead.
 */

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

const TEMPLATE = { id: "sbt_1", is_active: true }

type Overrides = {
  template?: Record<string, unknown> | null
  existing?: Array<Record<string, unknown>>
}

const makeService = (o: Overrides = {}) => ({
  retrieveShareBoxTemplate: jest.fn(async (_id: string) => {
    if (o.template === null) throw new Error("not found")
    return o.template ?? TEMPLATE
  }),
  listShareBoxSubscriptions: jest.fn(
    async (_filters: Record<string, unknown>) => o.existing ?? []
  ),
  createShareBoxSubscriptionRecord: jest.fn(
    async (args: Record<string, unknown>) => ({ id: "sbs_new", ...args })
  ),
  reactivateShareBoxSubscription: jest.fn(async (id: string) => ({
    id,
    status: "active",
    cancelled_at: null,
    cancelled_reason: null,
  })),
})

type Service = ReturnType<typeof makeService>

const makeReq = (
  service: Service,
  customerId: string | undefined,
  extra: { query?: Record<string, unknown>; body?: unknown } = {}
) => ({
  params: {},
  query: extra.query ?? {},
  body: extra.body,
  auth_context: customerId ? { actor_id: customerId } : undefined,
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
  customerId: string | undefined,
  query: Record<string, unknown> = {}
) => {
  const res = createRes()
  await GET(
    makeReq(service, customerId, { query }) as unknown as GetArgs[0],
    res as unknown as GetArgs[1]
  )
  return res
}

const callPost = async (
  service: Service,
  customerId: string | undefined,
  body: unknown
) => {
  const res = createRes()
  await POST(
    makeReq(service, customerId, { body }) as unknown as PostArgs[0],
    res as unknown as PostArgs[1]
  )
  return res
}

describe("GET /store/share-box-subscriptions", () => {
  it("401s without an authenticated customer", async () => {
    const service = makeService()
    const res = await callGet(service, undefined)
    expect(res.statusCode).toBe(401)
    expect(service.listShareBoxSubscriptions).not.toHaveBeenCalled()
  })

  it("always scopes the list to the caller", async () => {
    const service = makeService()
    await callGet(service, "cus_me")
    const [filters] = service.listShareBoxSubscriptions.mock.calls[0]
    expect(filters.customer_id).toBe("cus_me")
  })

  it("cannot be widened by a query parameter", async () => {
    const service = makeService()
    await callGet(service, "cus_me", { customer_id: "cus_other" })
    const [filters] = service.listShareBoxSubscriptions.mock.calls[0]
    expect(JSON.stringify(filters)).not.toContain("cus_other")
  })

  it("accepts only the three real statuses as a filter", async () => {
    const service = makeService()
    await callGet(service, "cus_me", { status: "paused" })
    expect(service.listShareBoxSubscriptions.mock.calls[0][0].status).toBe("paused")

    const service2 = makeService()
    await callGet(service2, "cus_me", { status: "nonsense" })
    expect(service2.listShareBoxSubscriptions.mock.calls[0][0]).not.toHaveProperty(
      "status"
    )
  })
})

describe("POST /store/share-box-subscriptions", () => {
  it("401s without an authenticated customer", async () => {
    const service = makeService()
    const res = await callPost(service, undefined, {
      share_box_template_id: "sbt_1",
    })
    expect(res.statusCode).toBe(401)
    expect(service.createShareBoxSubscriptionRecord).not.toHaveBeenCalled()
  })

  it("requires a template id", async () => {
    const service = makeService()
    const res = await callPost(service, "cus_me", {})
    expect(res.statusCode).toBe(400)
  })

  it("404s an unknown template", async () => {
    const service = makeService({ template: null })
    const res = await callPost(service, "cus_me", {
      share_box_template_id: "sbt_missing",
    })
    expect(res.statusCode).toBe(404)
    expect(service.createShareBoxSubscriptionRecord).not.toHaveBeenCalled()
  })

  it("refuses to subscribe to a closed template", async () => {
    // The design point. `generateBoxesForCycle` filters on `is_active`, and
    // #840 made deleting a subscribed template deactivate it — so this
    // subscription could never produce a box, while looking live to the member.
    const service = makeService({ template: { id: "sbt_1", is_active: false } })
    const res = await callPost(service, "cus_me", {
      share_box_template_id: "sbt_1",
    })
    expect(res.statusCode).toBe(409)
    expect(service.createShareBoxSubscriptionRecord).not.toHaveBeenCalled()
  })

  it("takes customer_id from the session, never the body", async () => {
    const service = makeService()
    const res = await callPost(service, "cus_me", {
      share_box_template_id: "sbt_1",
      customer_id: "cus_someone_else",
      customer_external_id: "@someone:example.org",
    })
    expect(res.statusCode).toBe(201)
    const [args] = service.createShareBoxSubscriptionRecord.mock.calls[0]
    expect(args.customer_id).toBe("cus_me")
    expect(args).not.toHaveProperty("customer_external_id")
  })

  it("409s when already actively subscribed, without creating a second row", async () => {
    const service = makeService({
      existing: [{ id: "sbs_1", status: "active" }],
    })
    const res = await callPost(service, "cus_me", {
      share_box_template_id: "sbt_1",
    })
    expect(res.statusCode).toBe(409)
    expect(service.createShareBoxSubscriptionRecord).not.toHaveBeenCalled()
  })

  it("revives a cancelled subscription instead of tripping the unique index", async () => {
    // The bug this avoids: UNIQUE (share_box_template_id, customer_id) means a
    // second create for the same pair 500s. A member who cancelled and comes
    // back must get their row revived.
    const service = makeService({
      existing: [{ id: "sbs_1", status: "cancelled" }],
    })
    const res = await callPost(service, "cus_me", {
      share_box_template_id: "sbt_1",
    })
    expect(res.statusCode).toBe(200)
    expect(service.createShareBoxSubscriptionRecord).not.toHaveBeenCalled()
    expect(service.reactivateShareBoxSubscription).toHaveBeenCalledWith("sbs_1")
    expect(res.body).toMatchObject({ reactivated: true })
  })

  it("revives a paused subscription the same way", async () => {
    const service = makeService({ existing: [{ id: "sbs_1", status: "paused" }] })
    const res = await callPost(service, "cus_me", {
      share_box_template_id: "sbt_1",
    })
    expect(res.statusCode).toBe(200)
    expect(service.reactivateShareBoxSubscription).toHaveBeenCalledWith("sbs_1")
  })

  it("looks for the existing row scoped to this member and template", async () => {
    const service = makeService()
    await callPost(service, "cus_me", { share_box_template_id: "sbt_1" })
    const [filters] = service.listShareBoxSubscriptions.mock.calls[0]
    expect(filters).toEqual({
      share_box_template_id: "sbt_1",
      customer_id: "cus_me",
    })
  })

  it("checks the template is open before looking for an existing row", async () => {
    const service = makeService({
      template: { id: "sbt_1", is_active: false },
      existing: [{ id: "sbs_1", status: "cancelled" }],
    })
    const res = await callPost(service, "cus_me", {
      share_box_template_id: "sbt_1",
    })
    expect(res.statusCode).toBe(409)
    expect(service.reactivateShareBoxSubscription).not.toHaveBeenCalled()
  })
})
