import { Modules } from "@medusajs/framework/utils"
import { POST } from "../route"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"

/**
 * The demand_pool.fulfilled event is the trigger for cross-mode reputation
 * AND savings recording (Tier 1, docs/SAVINGS_ROUTING_SPEC.md), so who it
 * names matters. Filtering to COMMITTED alone excluded exactly the people
 * who paid — escrowing moves a participant off COMMITTED — which starved
 * both subscribers. This pins the corrected follow-through set.
 */

type FulfilledEvent = {
  name: string
  data: {
    demand_post_id: string
    organizer_id: string | null
    organizer_type: string | null
    participant_ids: string[]
  }
}

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: Record<string, unknown>) {
      res.body = payload
      return res
    },
  }
  return res
}

function makeScope() {
  const participants = [
    { id: "p1", customer_id: "cus_committed", status: "COMMITTED" },
    { id: "p2", customer_id: "cus_escrowed", status: "ESCROWED" },
    { id: "p3", customer_id: "cus_confirmed", status: "CONFIRMED" },
  ]
  const demandPool = {
    transitionDemandStatus: jest.fn(async () => ({
      id: "dp_1",
      status: "FULFILLED",
      creator_id: "cus_org",
      creator_type: "CUSTOMER",
    })),
    listDemandParticipants: jest.fn(async () => participants),
  }
  const eventBus = {
    emit: jest.fn(async (_event: FulfilledEvent) => undefined),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === DEMAND_POOL_MODULE) return demandPool
      if (key === Modules.EVENT_BUS) return eventBus
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  return { scope, demandPool, eventBus }
}

const callPost = (scope: ReturnType<typeof makeScope>["scope"], res: ReturnType<typeof makeRes>) =>
  POST(
    {
      params: { id: "dp_1" },
      body: { action: "mark_fulfilled" },
      scope,
    } as unknown as Parameters<typeof POST>[0],
    res as unknown as Parameters<typeof POST>[1]
  )

describe("POST /admin/collective/demand-pools/:id — mark_fulfilled event", () => {
  it("emits demand_pool.fulfilled for everyone who followed through, not only COMMITTED", async () => {
    const { scope, demandPool, eventBus } = makeScope()
    const res = makeRes()

    await callPost(scope, res)

    expect(res.statusCode).toBe(200)
    expect(demandPool.listDemandParticipants).toHaveBeenCalledWith({
      demand_post_id: "dp_1",
      status: ["COMMITTED", "ESCROWED", "CONFIRMED"],
    })
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    const emitted = eventBus.emit.mock.calls[0][0]
    expect(emitted.name).toBe("demand_pool.fulfilled")
    expect(emitted.data.participant_ids).toEqual([
      "cus_committed",
      "cus_escrowed",
      "cus_confirmed",
    ])
  })

  it("still completes the transition when the emit fails (best-effort event)", async () => {
    const { scope, eventBus } = makeScope()
    eventBus.emit.mockRejectedValueOnce(new Error("bus down"))
    const res = makeRes()

    await callPost(scope, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { demand_pool: { status: string } }
    expect(body.demand_pool.status).toBe("FULFILLED")
  })
})
