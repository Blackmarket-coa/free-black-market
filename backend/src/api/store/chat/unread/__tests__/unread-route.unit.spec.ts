import { GET } from "../route"
import { getChatProvider } from "../../../../../shared/chat"

jest.mock("../../../../../shared/chat", () => ({
  getChatProvider: jest.fn(),
}))

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

const makeReq = () => ({
  auth_context: { actor_id: "cus_1" },
  scope: {
    resolve: () => ({
      graph: async () => ({
        data: [{ id: "cus_1", email: "buyer@example.com" }],
      }),
    }),
  },
})

describe("GET /store/chat/unread degraded handling", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns degraded:true when the matrix call throws", async () => {
    ;(getChatProvider as jest.Mock).mockReturnValue({
      buildMxid: (lp: string) => `@${lp}:server`,
      getUnreadCount: jest.fn(async () => {
        throw new Error("synapse down")
      }),
    })

    const res = createRes()
    await GET(makeReq() as any, res as any)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ unread_count: 0, degraded: true })
  })

  it("returns a clean count with no degraded flag on success", async () => {
    ;(getChatProvider as jest.Mock).mockReturnValue({
      buildMxid: (lp: string) => `@${lp}:server`,
      getUnreadCount: jest.fn(async () => 3),
    })

    const res = createRes()
    await GET(makeReq() as any, res as any)

    expect(res.body).toEqual({ unread_count: 3 })
    expect(res.body.degraded).toBeUndefined()
  })

  it("returns legitimate zero without degraded flag when matrix is unconfigured", async () => {
    ;(getChatProvider as jest.Mock).mockReturnValue(null)

    const res = createRes()
    await GET(makeReq() as any, res as any)

    expect(res.body).toEqual({ unread_count: 0 })
    expect(res.body.degraded).toBeUndefined()
  })
})
