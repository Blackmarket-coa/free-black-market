import { GET, POST, DELETE } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"

/**
 * `/vendor/share-box-templates/:id`.
 *
 * A template belongs to exactly one coordinator, so ownership is the whole
 * authorization rule — there is no participant tier as there is on a cycle.
 * The 404-not-403 choice is deliberate and asserted: a coordinator has no
 * business learning which template ids exist.
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

const TEMPLATE = {
  id: "sbt_1",
  coordinator_seller_id: "sel_me",
  name: "Autumn Box",
  is_active: true,
}

type Overrides = {
  template?: Record<string, unknown> | null
  subscriptions?: Array<Record<string, unknown>>
}

const makeService = (o: Overrides = {}) => ({
  retrieveShareBoxTemplate: jest.fn(async () => {
    if (o.template === null) throw new Error("not found")
    return o.template ?? TEMPLATE
  }),
  updateShareBoxTemplate: jest.fn(
    async (id: string, args: Record<string, unknown>) => ({ id, ...args })
  ),
  listShareBoxSubscriptions: jest.fn(async () => o.subscriptions ?? []),
  deleteShareBoxTemplates: jest.fn(async () => undefined),
})

type Service = ReturnType<typeof makeService>

const makeReq = (service: Service, actorId: string | undefined, body?: unknown) => ({
  params: { id: "sbt_1" },
  query: {},
  body,
  auth_context: actorId ? { actor_id: actorId } : undefined,
  scope: {
    resolve: (key: string) =>
      key === ORDER_CYCLE_MODULE || key === "orderCycleModuleService"
        ? service
        : undefined,
  },
})

type Args = Parameters<typeof GET>

const call = async (
  handler: typeof GET | typeof POST | typeof DELETE,
  service: Service,
  actorId: string | undefined,
  body?: unknown
) => {
  const res = createRes()
  await handler(
    makeReq(service, actorId, body) as unknown as Args[0],
    res as unknown as Args[1]
  )
  return res
}

describe("share-box template ownership gate", () => {
  it("401s without an authenticated seller", async () => {
    for (const handler of [GET, POST, DELETE]) {
      const service = makeService()
      const res = await call(handler, service, undefined, { name: "x" })
      expect(res.statusCode).toBe(401)
    }
  })

  it("404s a template owned by another coordinator, on every method", async () => {
    for (const handler of [GET, POST, DELETE]) {
      const service = makeService({
        template: { ...TEMPLATE, coordinator_seller_id: "sel_other" },
      })
      const res = await call(handler, service, "sel_me", { name: "x" })
      expect(res.statusCode).toBe(404)
      expect(service.updateShareBoxTemplate).not.toHaveBeenCalled()
      expect(service.deleteShareBoxTemplates).not.toHaveBeenCalled()
    }
  })

  it("404s a template that does not exist", async () => {
    const service = makeService({ template: null })
    const res = await call(GET, service, "sel_me")
    expect(res.statusCode).toBe(404)
  })

  it("returns the template to its owner", async () => {
    const service = makeService()
    const res = await call(GET, service, "sel_me")
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ share_box_template: TEMPLATE })
  })
})

describe("POST /vendor/share-box-templates/:id", () => {
  it("cannot hand the template to another coordinator", async () => {
    const service = makeService()
    await call(POST, service, "sel_me", {
      name: "Renamed",
      coordinator_seller_id: "sel_other",
    })
    const [, args] = service.updateShareBoxTemplate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(args).not.toHaveProperty("coordinator_seller_id")
  })

  it("refuses an empty slots array without calling the service", async () => {
    const service = makeService()
    for (const slots of [[], "nope"]) {
      const res = await call(POST, service, "sel_me", { slots })
      expect(res.statusCode).toBe(400)
    }
    expect(service.updateShareBoxTemplate).not.toHaveBeenCalled()
  })

  it("leaves slots untouched when the field is absent", async () => {
    // A partial update must not blank the slots.
    const service = makeService()
    await call(POST, service, "sel_me", { name: "Renamed" })
    const [, args] = service.updateShareBoxTemplate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(args.slots).toBeUndefined()
  })

  it("400s when the service rejects the slots", async () => {
    const service = makeService()
    service.updateShareBoxTemplate.mockRejectedValueOnce(
      new Error("slot.key is required")
    )
    const res = await call(POST, service, "sel_me", { slots: [{ label: "x" }] })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ message: "slot.key is required" })
  })
})

describe("DELETE /vendor/share-box-templates/:id", () => {
  it("deletes a template nobody has subscribed to", async () => {
    const service = makeService({ subscriptions: [] })
    const res = await call(DELETE, service, "sel_me")
    expect(res.statusCode).toBe(200)
    expect(service.deleteShareBoxTemplates).toHaveBeenCalledWith("sbt_1")
    expect(res.body).toEqual({ id: "sbt_1", deleted: true })
  })

  it("deactivates rather than deletes when members are subscribed", async () => {
    // Deleting would orphan every share_box_subscription pointing at it and
    // lose the record of what those members signed up for. `is_active: false`
    // is what generateBoxesForCycle reads, so it stops future boxes.
    const service = makeService({ subscriptions: [{ id: "sbs_1" }, { id: "sbs_2" }] })
    const res = await call(DELETE, service, "sel_me")

    expect(res.statusCode).toBe(200)
    expect(service.deleteShareBoxTemplates).not.toHaveBeenCalled()
    expect(service.updateShareBoxTemplate).toHaveBeenCalledWith("sbt_1", {
      is_active: false,
    })

    const body = res.body as { deactivated?: boolean; message?: string }
    expect(body.deactivated).toBe(true)
    expect(body.message).toContain("2 subscription(s)")
  })

  it("checks ownership before it counts subscriptions", async () => {
    const service = makeService({
      template: { ...TEMPLATE, coordinator_seller_id: "sel_other" },
      subscriptions: [{ id: "sbs_1" }],
    })
    const res = await call(DELETE, service, "sel_me")
    expect(res.statusCode).toBe(404)
    expect(service.listShareBoxSubscriptions).not.toHaveBeenCalled()
  })
})
