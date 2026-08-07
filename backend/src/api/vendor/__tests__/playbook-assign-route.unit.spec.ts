import { GET, POST } from "../playbook/assign/route"

jest.mock("../../../shared", () => ({
  requireSellerId: jest.fn(),
}))

const mockWorkflowRun = jest.fn()
jest.mock("../../../workflows/assign-playbook", () => ({
  assignPlaybookWorkflow: jest.fn(() => ({
    run: (args) => mockWorkflowRun(args),
  })),
}))

jest.mock("../../../modules/playbook", () => ({
  PLAYBOOK_MODULE: "playbook",
  PLAYBOOK_IDS: [
    "stall",
    "atelier",
    "grove",
    "workshop",
    "commons",
    "cycle",
    "kitchen",
    "harvest",
    "hub",
    "service",
  ],
}))

import { requireSellerId } from "../../../shared"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  return res
}

const makeReq = (
  body,
  opts: { listPlaybookAssignments?: jest.Mock } = {}
) => ({
  body,
  scope: {
    resolve: (key: string) => {
      if (key === "playbook") {
        return {
          listPlaybookAssignments:
            opts.listPlaybookAssignments ?? jest.fn().mockResolvedValue([]),
        }
      }
      return {}
    },
  },
})

beforeEach(() => {
  ;(requireSellerId as jest.Mock).mockReset()
  mockWorkflowRun.mockReset()
})

describe("GET /vendor/playbook/assign", () => {
  it("returns null when seller has no assignment", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    const list = jest.fn().mockResolvedValue([])
    const res = createRes()
    await GET(
      makeReq(undefined, { listPlaybookAssignments: list }) as any,
      res as any
    )
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ playbook_assignment: null })
    expect(list).toHaveBeenCalledWith({ seller_id: "sel_123" })
  })

  it("returns the existing assignment row", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    const row = { id: "pa_1", seller_id: "sel_123", recipe_id: "stall" }
    const list = jest.fn().mockResolvedValue([row])
    const res = createRes()
    await GET(
      makeReq(undefined, { listPlaybookAssignments: list }) as any,
      res as any
    )
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ playbook_assignment: row })
  })

  it("returns 401 when not authenticated", async () => {
    // requireSellerId already writes 401 + returns null when unauthenticated.
    ;(requireSellerId as jest.Mock).mockImplementation(async (_req, res) => {
      res.status(401).json({ message: "Unauthorized" })
      return null
    })
    const res = createRes()
    await GET(makeReq(undefined) as any, res as any)
    expect(res.statusCode).toBe(401)
  })
})

describe("POST /vendor/playbook/assign", () => {
  it("upserts via workflow with valid input", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    const row = {
      id: "pa_1",
      seller_id: "sel_123",
      recipe_id: "atelier",
      playbook_id: "pb_1",
    }
    mockWorkflowRun.mockResolvedValue({
      result: { playbook_assignment: row },
    })

    const res = createRes()
    await POST(
      makeReq({
        recipe_id: "atelier",
        answers: {
          size: "solo",
          governance: "i_decide",
          offering: "make_or_grow",
        },
        recommended_recipe_id: "stall",
        overridden: true,
      }) as any,
      res as any
    )

    expect(res.statusCode).toBe(200)
    // `transition` is null on a first assignment (no `from` to record) and
    // `preflight` is null because no switch is happening.
    expect(res.body).toEqual({
      playbook_assignment: row,
      transition: null,
      preflight: null,
    })
    expect(mockWorkflowRun).toHaveBeenCalledWith({
      input: {
        seller_id: "sel_123",
        recipe_id: "atelier",
        answers: {
          size: "solo",
          governance: "i_decide",
          offering: "make_or_grow",
        },
        recommended_recipe_id: "stall",
        migrated_from: null,
        reason: null,
        stranded_listing_count: 0,
      },
    })
  })

  it("persists roles + resources on the assignment metadata", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    mockWorkflowRun.mockResolvedValue({
      result: {
        playbook_assignment: { id: "pa_9", seller_id: "sel_123", recipe_id: "stall" },
      },
    })
    const res = createRes()
    await POST(
      makeReq({
        recipe_id: "stall",
        roles: ["stall", "atelier"],
        resources: ["audience", "marketing"],
      }) as any,
      res as any
    )
    expect(res.statusCode).toBe(200)
    expect(mockWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          seller_id: "sel_123",
          recipe_id: "stall",
          metadata: {
            roles: ["stall", "atelier"],
            resources: ["audience", "marketing"],
          },
        }),
      })
    )
  })

  it("rejects invalid role ids with 400", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    const res = createRes()
    await POST(
      makeReq({ recipe_id: "stall", roles: ["stall", "not_real"] }) as any,
      res as any
    )
    expect(res.statusCode).toBe(400)
    expect(mockWorkflowRun).not.toHaveBeenCalled()
  })

  it("rejects invalid resource keys with 400", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    const res = createRes()
    await POST(
      makeReq({ recipe_id: "stall", resources: ["land", "not_a_resource"] }) as any,
      res as any
    )
    expect(res.statusCode).toBe(400)
    expect(mockWorkflowRun).not.toHaveBeenCalled()
  })

  it("rejects invalid recipe_id with 400", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    const res = createRes()
    await POST(makeReq({ recipe_id: "not_a_real_playbook" }) as any, res as any)
    expect(res.statusCode).toBe(400)
    expect(res.body.type).toBe("invalid_data")
    expect(mockWorkflowRun).not.toHaveBeenCalled()
  })

  it("rejects invalid answers shape with 400", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_123")
    const res = createRes()
    await POST(
      makeReq({
        recipe_id: "stall",
        answers: { size: "huge", governance: "i_decide", offering: "make_or_grow" },
      }) as any,
      res as any
    )
    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/Invalid answers.size/)
  })

  it("accepts payload without answers (programmatic assignment)", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_456")
    mockWorkflowRun.mockResolvedValue({
      result: { playbook_assignment: { id: "pa_2", seller_id: "sel_456", recipe_id: "grove" } },
    })
    const res = createRes()
    await POST(makeReq({ recipe_id: "grove" }) as any, res as any)
    expect(res.statusCode).toBe(200)
    expect(mockWorkflowRun).toHaveBeenCalledWith({
      input: {
        seller_id: "sel_456",
        recipe_id: "grove",
        answers: undefined,
        recommended_recipe_id: undefined,
        migrated_from: null,
        reason: null,
        stranded_listing_count: 0,
      },
    })
  })

  it("ignores client-supplied migrated_from (server-controlled only)", async () => {
    ;(requireSellerId as jest.Mock).mockResolvedValue("sel_789")
    mockWorkflowRun.mockResolvedValue({
      result: { playbook_assignment: { id: "pa_3", seller_id: "sel_789", recipe_id: "stall" } },
    })
    const res = createRes()
    await POST(
      makeReq({ recipe_id: "stall", migrated_from: "producer" } as any) as any,
      res as any
    )
    expect(res.statusCode).toBe(200)
    expect(mockWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ migrated_from: null }),
      })
    )
  })

  it("returns 401 when not authenticated", async () => {
    ;(requireSellerId as jest.Mock).mockImplementation(async (_req, res) => {
      res.status(401).json({ message: "Unauthorized" })
      return null
    })
    const res = createRes()
    await POST(makeReq({ recipe_id: "stall" }) as any, res as any)
    expect(res.statusCode).toBe(401)
    expect(mockWorkflowRun).not.toHaveBeenCalled()
  })
})
