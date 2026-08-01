import { GET } from "../route"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../../../../../modules/progression"

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

const makeScope = (map: Record<string, unknown>) => ({
  resolve: (key: string) => map[key],
})

type RouteArgs = Parameters<typeof GET>
const invoke = (req: unknown, res: TestRes) =>
  GET(req as RouteArgs[0], res as unknown as RouteArgs[1])

const ownerQuery = (members: unknown[]) => ({
  graph: jest.fn().mockResolvedValue({ data: [{ id: "sel_1", members }] }),
})

describe("vendor creator xp-balances route", () => {
  it("returns spendable XP as the single aggregate 'All spaces' balance", async () => {
    const progression = { getSpendableXp: jest.fn().mockResolvedValue(7400) }
    const req = {
      auth_context: { actor_id: "sel_1" },
      scope: makeScope({
        [ContainerRegistrationKeys.QUERY]: ownerQuery([{ id: "cus_owner", role: "owner" }]),
        [PROGRESSION_MODULE]: progression,
      }),
    }

    const res = createRes()
    await invoke(req, res)

    expect(progression.getSpendableXp).toHaveBeenCalledWith("cus_owner")
    expect(res.body).toEqual({
      balances: [{ space_id: "all", space_name: "All spaces", xp: 7400 }],
    })
  })

  it("reports 0 XP (never errors) when the seller has no resolvable member", async () => {
    const progression = { getSpendableXp: jest.fn() }
    const req = {
      auth_context: { actor_id: "sel_1" },
      scope: makeScope({
        [ContainerRegistrationKeys.QUERY]: ownerQuery([]),
        [PROGRESSION_MODULE]: progression,
      }),
    }

    const res = createRes()
    await invoke(req, res)

    expect(progression.getSpendableXp).not.toHaveBeenCalled()
    expect(res.body).toEqual({
      balances: [{ space_id: "all", space_name: "All spaces", xp: 0 }],
    })
  })
})
