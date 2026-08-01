import { GET } from "../route"
import { VENDOR_QUEST_MODULE } from "../../../../../modules/vendor-quest"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"

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

const makeScope = (resolve: (key: string) => unknown) => ({ resolve })

type RouteArgs = Parameters<typeof GET>
const invoke = (req: unknown, res: TestRes) =>
  GET(req as RouteArgs[0], res as unknown as RouteArgs[1])

const QUESTS_FLAG = PHASE0_FEATURE_FLAGS.VENDOR_QUESTS_V1

describe("vendor creator quests route", () => {
  afterEach(() => {
    delete process.env[QUESTS_FLAG]
  })

  it("flag off: returns an empty list and never resolves the quest module", async () => {
    const resolve = jest.fn().mockReturnValue(undefined)
    const req = { auth_context: { actor_id: "sel_1" }, scope: makeScope(resolve) }

    const res = createRes()
    await invoke(req, res)

    expect(res.body).toEqual({ quests: [], count: 0 })
    expect(resolve).not.toHaveBeenCalledWith(VENDOR_QUEST_MODULE)
  })

  it("flag on: maps the catalog + caller enrollments to QuestHighlight", async () => {
    process.env[QUESTS_FLAG] = "true"

    const service = {
      getCatalog: jest.fn().mockReturnValue([
        { key: "q1", title: "Quest One", stages: [{}, {}] },
        { key: "q2", title: "Quest Two", stages: [{}, {}, {}] },
      ]),
      listEnrollmentsForSeller: jest.fn().mockResolvedValue([
        { quest_key: "q1", current_stage: 1, status: "ACTIVE" },
        // A dropped enrollment must not contribute progress.
        { quest_key: "q2", current_stage: 2, status: "DROPPED" },
      ]),
    }
    const resolve = jest.fn((key: string) =>
      key === VENDOR_QUEST_MODULE ? service : undefined
    )
    const req = { auth_context: { actor_id: "sel_1" }, scope: makeScope(resolve) }

    const res = createRes()
    await invoke(req, res)

    expect(service.listEnrollmentsForSeller).toHaveBeenCalledWith("sel_1")
    expect(res.body).toEqual({
      count: 2,
      quests: [
        { quest_title: "Quest One", current: 1, required: 2, karma_reward: 100 },
        { quest_title: "Quest Two", current: 0, required: 3, karma_reward: 150 },
      ],
    })
  })
})
