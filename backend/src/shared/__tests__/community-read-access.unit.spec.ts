import {
  actorId,
  actorIsAnyOf,
  actorIsGardenMember,
  actorMayReadDelivery,
  actorOwnsCourier,
  actorOwnsProducer,
  forbidden,
} from "../community-read-access"

/**
 * The access model D10-5 asked for.
 *
 * The row listed unauthenticated `/store/*` reads each returning personal data
 * belonging to someone other than the caller, and deferred all of them for
 * want of a ruling on "owner, member of the same garden, or subject". These
 * pin the ruling itself; the routes that apply it are covered separately.
 */
type Row = Record<string, unknown>

const makeReq = (opts: {
  actorId?: string | null
  actorType?: string
  rows?: Record<string, Row[]>
  graphThrows?: boolean
}) => {
  const graph = jest.fn(async ({ entity }: { entity: string }) => {
    if (opts.graphThrows) throw new Error("module unavailable")
    return { data: opts.rows?.[entity] ?? [] }
  })
  return {
    graph,
    req: {
      ...(opts.actorId
        ? { auth_context: { actor_id: opts.actorId, actor_type: opts.actorType ?? "customer" } }
        : {}),
      scope: { resolve: () => ({ graph }) },
    } as never,
  }
}

describe("actorId / actorIsAnyOf", () => {
  it("reads the authenticated actor of any type", () => {
    expect(actorId(makeReq({ actorId: "sel_1", actorType: "seller" }).req)).toBe("sel_1")
  })

  it("is null for an unauthenticated caller", () => {
    expect(actorId(makeReq({}).req)).toBeNull()
  })

  it("treats an empty actor id as absent", () => {
    expect(actorId(makeReq({ actorId: "" }).req)).toBeNull()
  })

  it("matches a named principal", () => {
    expect(actorIsAnyOf(makeReq({ actorId: "cus_1" }).req, "cus_9", "cus_1")).toBe(true)
  })

  it("ignores nullish candidates rather than matching them", () => {
    // The trap: a record with a null courier_id must not become readable.
    const { req } = makeReq({ actorId: "cus_1" })
    expect(actorIsAnyOf(req, null, undefined, "")).toBe(false)
  })

  it("never matches for an unauthenticated caller", () => {
    expect(actorIsAnyOf(makeReq({}).req, "cus_1")).toBe(false)
  })
})

describe("actorIsGardenMember", () => {
  it("admits a member", async () => {
    const { req } = makeReq({
      actorId: "cus_1",
      rows: { garden_membership: [{ id: "gm_1" }] },
    })
    await expect(actorIsGardenMember(req, "gdn_1")).resolves.toBe(true)
  })

  it("refuses a signed-in stranger — membership, not merely an account", async () => {
    const { req } = makeReq({ actorId: "cus_2", rows: { garden_membership: [] } })
    await expect(actorIsGardenMember(req, "gdn_1")).resolves.toBe(false)
  })

  it("refuses an unauthenticated caller without querying at all", async () => {
    const { req, graph } = makeReq({})
    await expect(actorIsGardenMember(req, "gdn_1")).resolves.toBe(false)
    expect(graph).not.toHaveBeenCalled()
  })

  it("filters on both the garden and the caller", async () => {
    const { req, graph } = makeReq({
      actorId: "cus_1",
      rows: { garden_membership: [{ id: "gm_1" }] },
    })
    await actorIsGardenMember(req, "gdn_1")
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { garden_id: "gdn_1", customer_id: "cus_1" },
      })
    )
  })

  it("denies rather than admits when the lookup fails", async () => {
    const { req } = makeReq({ actorId: "cus_1", graphThrows: true })
    await expect(actorIsGardenMember(req, "gdn_1")).resolves.toBe(false)
  })
})

describe("actorOwnsProducer / actorOwnsCourier", () => {
  it("admits the owner", async () => {
    const { req } = makeReq({
      actorId: "sel_1",
      actorType: "seller",
      rows: { food_producer: [{ id: "prd_1", owner_id: "sel_1" }] },
    })
    await expect(actorOwnsProducer(req, "prd_1")).resolves.toBe(true)
  })

  it("refuses another seller", async () => {
    const { req } = makeReq({
      actorId: "sel_2",
      rows: { food_producer: [{ id: "prd_1", owner_id: "sel_1" }] },
    })
    await expect(actorOwnsProducer(req, "prd_1")).resolves.toBe(false)
  })

  it("refuses a producer with no owner stamped, rather than grandfathering it", async () => {
    // A legacy producer predating ownership must not become everyone's on a
    // PII read — the distinction actorMayManage deliberately blurs.
    const { req } = makeReq({
      actorId: "sel_1",
      rows: { food_producer: [{ id: "prd_1", owner_id: null }] },
    })
    await expect(actorOwnsProducer(req, "prd_1")).resolves.toBe(false)
  })

  it("refuses a producer that does not exist", async () => {
    const { req } = makeReq({ actorId: "sel_1", rows: { food_producer: [] } })
    await expect(actorOwnsProducer(req, "prd_missing")).resolves.toBe(false)
  })

  it("applies the same rules to a courier", async () => {
    const { req } = makeReq({
      actorId: "cus_1",
      rows: { food_courier: [{ id: "cour_1", owner_id: "cus_1" }] },
    })
    await expect(actorOwnsCourier(req, "cour_1")).resolves.toBe(true)
    await expect(actorOwnsCourier(req, null)).resolves.toBe(false)
  })
})

describe("actorMayReadDelivery", () => {
  const delivery = { producer_id: "prd_1", courier_id: "cour_1", order_id: "fo_1" }

  it("admits the producer", async () => {
    const { req } = makeReq({
      actorId: "sel_1",
      rows: { food_producer: [{ id: "prd_1", owner_id: "sel_1" }] },
    })
    await expect(actorMayReadDelivery(req, delivery)).resolves.toBe(true)
  })

  it("admits the courier", async () => {
    const { req } = makeReq({
      actorId: "cus_courier",
      rows: {
        food_producer: [{ id: "prd_1", owner_id: "sel_1" }],
        food_courier: [{ id: "cour_1", owner_id: "cus_courier" }],
      },
    })
    await expect(actorMayReadDelivery(req, delivery)).resolves.toBe(true)
  })

  it("admits the recipient, reached through the order", async () => {
    const { req } = makeReq({
      actorId: "cus_recipient",
      rows: {
        food_producer: [{ id: "prd_1", owner_id: "sel_1" }],
        food_courier: [{ id: "cour_1", owner_id: "cus_courier" }],
        food_order: [{ id: "fo_1", customer_id: "cus_recipient" }],
      },
    })
    await expect(actorMayReadDelivery(req, delivery)).resolves.toBe(true)
  })

  it("refuses an unrelated signed-in account", async () => {
    const { req } = makeReq({
      actorId: "cus_stranger",
      rows: {
        food_producer: [{ id: "prd_1", owner_id: "sel_1" }],
        food_courier: [{ id: "cour_1", owner_id: "cus_courier" }],
        food_order: [{ id: "fo_1", customer_id: "cus_recipient" }],
      },
    })
    await expect(actorMayReadDelivery(req, delivery)).resolves.toBe(false)
  })

  it("refuses an unauthenticated caller — the enumerable-id case", async () => {
    const { req } = makeReq({ rows: {} })
    await expect(actorMayReadDelivery(req, delivery)).resolves.toBe(false)
  })

  it("refuses a guest-checkout delivery rather than opening it to everyone", async () => {
    // A null customer_id means the recipient cannot be matched. They lose
    // tracking; everyone else does not gain it.
    const { req } = makeReq({
      actorId: "cus_anyone",
      rows: {
        food_producer: [{ id: "prd_1", owner_id: "sel_1" }],
        food_courier: [{ id: "cour_1", owner_id: "cus_courier" }],
        food_order: [{ id: "fo_1", customer_id: null }],
      },
    })
    await expect(actorMayReadDelivery(req, delivery)).resolves.toBe(false)
  })

  it("refuses a delivery with no order to reach a recipient through", async () => {
    const { req } = makeReq({
      actorId: "cus_anyone",
      rows: { food_producer: [], food_courier: [] },
    })
    await expect(
      actorMayReadDelivery(req, { producer_id: null, courier_id: null, order_id: null })
    ).resolves.toBe(false)
  })
})

describe("forbidden", () => {
  it("answers 403, never 404, so the status cannot be an existence oracle", () => {
    let code = 0
    let body: unknown
    forbidden({
      status: (c: number) => {
        code = c
        return { json: (b: unknown) => (body = b) }
      },
    })
    expect(code).toBe(403)
    expect(body).toMatchObject({ type: "not_allowed" })
  })
})
