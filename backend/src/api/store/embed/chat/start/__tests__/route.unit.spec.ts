import { POST } from "../route"
import { getChatProvider } from "../../../../../../shared/chat"

jest.mock("../../../../../../shared/chat", () => ({
  getChatProvider: jest.fn(),
}))

/**
 * The embedded "Message the vendor" button.
 *
 * The defect this pins: every Matrix-routed chat came back with
 * `widget_url: <BLACKOUT_BASE_URL or https://theblackout.app>/embed/room/<id>`.
 * Blackout has no such route and the default origin is a holding page, so
 * connect.js iframed a dead page instead of telling the visitor the vendor
 * would reply by email. A widget URL is now returned only when
 * BLACKOUT_EMBED_ROOM_URL is configured; otherwise the key is `null`, which
 * every shipped connect.js already treats as "show the email message".
 */

const mockGetChatProvider = getChatProvider as jest.Mock

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

const ROOM_ID = "!abc123:fbm.example"
const VENDOR_MXID = "@vendor:fbm.example"

const seller = {
  id: "sel_1",
  name: "Harvest Co",
  handle: "harvest-co",
  email: "vendor@harvest.test",
}

let sellers: Record<string, unknown>[]
let metaRows: Record<string, unknown>[]
let graph: jest.Mock
let createNotifications: jest.Mock

const makeMatrix = () => ({
  kind: "matrix",
  sanitizeLocalpart: jest.fn((s: string) => s.toLowerCase()),
  ensureRoom: jest.fn(async (..._args: unknown[]) => ROOM_ID as string | null),
  invite: jest.fn(async (..._args: unknown[]) => undefined),
  sendMessage: jest.fn(async (..._args: unknown[]) => true),
})
let matrix: ReturnType<typeof makeMatrix>

const makeReq = (
  body: Record<string, unknown>,
  sellerId: string | null = "sel_1"
) =>
  ({
    embed_seller_id: sellerId ?? undefined,
    embed_key_id: "ek_1",
    body,
    headers: {},
    scope: {
      resolve: (name: string) =>
        name === "query" ? { graph } : { createNotifications },
    },
  }) as never

const VALID = {
  customer_email: "Visitor@Example.com",
  message: "Do you ship <b>bulk</b> orders?",
}

const ENV = ["BLACKOUT_EMBED_ROOM_URL", "BLACKOUT_BASE_URL"] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]

  sellers = [seller]
  metaRows = [{ mxid: VENDOR_MXID }]
  graph = jest.fn(async ({ entity }: { entity: string }) => ({
    data: entity === "seller" ? sellers : metaRows,
  }))
  createNotifications = jest.fn(async () => [])
  matrix = makeMatrix()
  mockGetChatProvider.mockReset()
  mockGetChatProvider.mockReturnValue(matrix)
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("POST /store/embed/chat/start — widget_url", () => {
  it("returns widget_url: null by default, keeping the key", async () => {
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({
      channel: "matrix",
      room_id: ROOM_ID,
      widget_url: null,
    })
    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("no longer builds the dead /embed/room URL from BLACKOUT_BASE_URL", async () => {
    process.env.BLACKOUT_BASE_URL = "https://blackout.example"
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body).toHaveProperty("widget_url", null)
  })

  it("fills the configured template with the URL-encoded room id", async () => {
    process.env.BLACKOUT_EMBED_ROOM_URL =
      "https://chat.example.com/embed/room/{roomId}?theme=light"
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body?.channel).toBe("matrix")
    expect(res.body?.room_id).toBe(ROOM_ID)
    expect(res.body?.widget_url).toBe(
      "https://chat.example.com/embed/room/!abc123%3Afbm.example?theme=light"
    )
  })

  it("keeps a room id from escaping its path segment", async () => {
    process.env.BLACKOUT_EMBED_ROOM_URL = "https://chat.example.com/r/{roomId}"
    matrix.ensureRoom.mockResolvedValue("!a/b?c#d:fbm.example")
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.body?.widget_url).toBe(
      "https://chat.example.com/r/!a%2Fb%3Fc%23d%3Afbm.example"
    )
  })

  it("returns null for a template with no {roomId} placeholder", async () => {
    // Every visitor would otherwise be sent to the same page.
    process.env.BLACKOUT_EMBED_ROOM_URL = "https://chat.example.com/embed"
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body).toHaveProperty("widget_url", null)
  })

  it("returns null for a template connect.js would refuse to open", async () => {
    // connect.js only iframes http(s); anything else strands the visitor on
    // "Connecting you to the vendor…".
    process.env.BLACKOUT_EMBED_ROOM_URL = "javascript:alert('{roomId}')"
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body).toHaveProperty("widget_url", null)
  })
})

describe("POST /store/embed/chat/start — Matrix delivery", () => {
  it("invites the vendor and posts the visitor's email and message as plain text", async () => {
    const res = makeRes()
    await POST(
      makeReq({ ...VALID, customer_name: "Ada Visitor" }),
      res as never
    )

    expect(res.statusCode).toBe(201)
    expect(matrix.ensureRoom).toHaveBeenCalledWith(
      expect.objectContaining({ invite: [VENDOR_MXID] })
    )
    expect(matrix.invite).toHaveBeenCalledWith(ROOM_ID, VENDOR_MXID)

    expect(matrix.sendMessage).toHaveBeenCalledTimes(1)
    const [roomId, text] = matrix.sendMessage.mock.calls[0] as [string, string]
    expect(roomId).toBe(ROOM_ID)
    // Email is normalised; the message goes through verbatim, unformatted.
    expect(text).toContain("visitor@example.com")
    expect(text).toContain("Do you ship <b>bulk</b> orders?")
    expect(text).toContain("Ada Visitor")
  })
})

describe("POST /store/embed/chat/start — fallbacks and errors", () => {
  const expectEmailFallback = (res: ReturnType<typeof makeRes>) => {
    expect(res.statusCode).toBe(201)
    expect(res.body).toMatchObject({
      channel: "email",
      room_id: null,
      widget_url: null,
    })
    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "vendor@harvest.test",
        channel: "email",
        template: "embed-chat-message",
        data: expect.objectContaining({
          customer_email: "visitor@example.com",
          message: "Do you ship <b>bulk</b> orders?",
        }),
      })
    )
  }

  it("emails the vendor when the chat provider cannot create a room", async () => {
    matrix.ensureRoom.mockResolvedValue(null)
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expectEmailFallback(res)
    expect(matrix.sendMessage).not.toHaveBeenCalled()
  })

  it("emails the vendor when the message cannot be posted to the room", async () => {
    // Without a widget the visitor is told to expect an email reply, so the
    // vendor must actually receive the message somewhere.
    matrix.sendMessage.mockResolvedValue(false)
    process.env.BLACKOUT_EMBED_ROOM_URL = "https://chat.example.com/r/{roomId}"
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expectEmailFallback(res)
  })

  it("emails the vendor when chat is not configured", async () => {
    mockGetChatProvider.mockReturnValue(null)
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expectEmailFallback(res)
  })

  it("emails the vendor when they have no Matrix id", async () => {
    metaRows = []
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expectEmailFallback(res)
    expect(matrix.ensureRoom).not.toHaveBeenCalled()
  })

  it("still answers the visitor when the email itself fails", async () => {
    mockGetChatProvider.mockReturnValue(null)
    createNotifications.mockRejectedValue(new Error("smtp down"))
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(201)
    expect(res.body).toMatchObject({ channel: "email", widget_url: null })
  })

  it("returns a generic 500 when the chat provider throws", async () => {
    matrix.ensureRoom.mockRejectedValue(
      new Error("[chat] Blackout provider is selected but not implemented")
    )
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({
      message: "Failed to start chat",
      type: "server_error",
    })
  })

  it("returns 404 when the vendor does not exist", async () => {
    sellers = []
    const res = makeRes()
    await POST(makeReq(VALID), res as never)

    expect(res.statusCode).toBe(404)
    expect(res.body?.type).toBe("not_found")
    expect(mockGetChatProvider).not.toHaveBeenCalled()
    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("rejects a missing or malformed email or an empty message", async () => {
    for (const body of [
      { message: "hi" },
      { customer_email: "not-an-email", message: "hi" },
      { customer_email: "a@b.co", message: "   " },
    ]) {
      const res = makeRes()
      await POST(makeReq(body), res as never)
      expect(res.statusCode).toBe(400)
    }
    expect(graph).not.toHaveBeenCalled()
  })

  it("still requires the embed-key context", async () => {
    const res = makeRes()
    await POST(makeReq(VALID, null), res as never)

    expect(res.statusCode).toBe(401)
    expect(graph).not.toHaveBeenCalled()
  })
})
