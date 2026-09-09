import OrderCycleModuleService from "../service"

/**
 * `updateOrderCycleStatuses` gained a per-cycle callback so a caller can
 * announce each transition.
 *
 * Per cycle, not per sweep: the counts it returns say how many moved and
 * cannot say which, and a consumer needs the which. The previous Blackout emit
 * sent `{closedCount, openedCount}` for exactly that reason — it was built on
 * the only thing this method used to give back.
 */
const proto = OrderCycleModuleService.prototype as any

const cycle = (id: string) => ({
  id,
  name: `Cycle ${id}`,
  coordinator_seller_id: "sel_coord",
})

const makeCtx = (toOpen: any[], toClose: any[]) => {
  const calls: string[] = []
  return {
    calls,
    ctx: {
      listOrderCycles: jest.fn(async (filters: Record<string, unknown>) =>
        Array.isArray(filters.status) ? toOpen : toClose
      ),
      updateOrderCycles: jest.fn(async (input: { id: string }) => {
        calls.push(`update:${input.id}`)
      }),
    },
  }
}

describe("updateOrderCycleStatuses", () => {
  it("still returns the counts its existing callers read", async () => {
    const { ctx } = makeCtx([cycle("oc_1")], [cycle("oc_2"), cycle("oc_3")])

    expect(await proto.updateOrderCycleStatuses.call(ctx)).toEqual({
      opened: 1,
      closed: 2,
    })
  })

  it("works with no callback at all", async () => {
    const { ctx } = makeCtx([cycle("oc_1")], [])

    await expect(proto.updateOrderCycleStatuses.call(ctx)).resolves.toEqual({
      opened: 1,
      closed: 0,
    })
  })

  it("announces each cycle after its status is written, with the direction", async () => {
    const { ctx, calls } = makeCtx([cycle("oc_1")], [cycle("oc_2")])

    await proto.updateOrderCycleStatuses.call(
      ctx,
      async (c: { id: string }, to: string) => {
        calls.push(`announce:${c.id}:${to}`)
      }
    )

    expect(calls).toEqual([
      "update:oc_1",
      "announce:oc_1:open",
      "update:oc_2",
      "announce:oc_2:closed",
    ])
  })

  it("hands the callback the whole row, not just an id", async () => {
    // The wire shape needs coordinator_seller_id and name too.
    const seen: Array<Record<string, unknown>> = []
    const { ctx } = makeCtx([cycle("oc_1")], [])

    await proto.updateOrderCycleStatuses.call(ctx, async (c: Record<string, unknown>) => {
      seen.push(c)
    })

    expect(seen[0]).toMatchObject({
      id: "oc_1",
      name: "Cycle oc_1",
      coordinator_seller_id: "sel_coord",
    })
  })

  it("finishes the sweep when an announcement throws", async () => {
    // The status transition is the sweep's real work. A consumer that could
    // not be told is not a reason to leave other cycles in the wrong state.
    const { ctx, calls } = makeCtx([cycle("oc_1"), cycle("oc_2")], [])

    const result = await proto.updateOrderCycleStatuses.call(ctx, async () => {
      throw new Error("webhook module missing")
    })

    expect(result).toEqual({ opened: 2, closed: 0 })
    expect(calls).toEqual(["update:oc_1", "update:oc_2"])
  })

  it("announces nothing when nothing transitioned", async () => {
    const seen: string[] = []
    const { ctx } = makeCtx([], [])

    await proto.updateOrderCycleStatuses.call(ctx, async (c: { id: string }) => {
      seen.push(c.id)
    })

    expect(seen).toEqual([])
  })
})
