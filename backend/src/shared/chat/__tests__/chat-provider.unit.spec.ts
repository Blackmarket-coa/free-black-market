import {
  configuredChatProviderKind,
  getChatProvider,
  resetChatProvider,
} from ".."
import { isChatProviderKind } from "../types"
import { getMatrixService } from "../../matrix-service"

jest.mock("../../matrix-service", () => ({
  getMatrixService: jest.fn(),
}))

const mockMatrix = getMatrixService as jest.Mock

const ENV = ["CHAT_PROVIDER"] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  resetChatProvider()
  mockMatrix.mockReset()
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetChatProvider()
})

const fakeMatrix = () => ({
  ensureUser: jest.fn(),
  mintLoginToken: jest.fn(),
  getUnreadCount: jest.fn(async () => 3),
  resolveRoomId: jest.fn(),
  ensureRoom: jest.fn(),
  invite: jest.fn(),
  sendMessage: jest.fn(),
  getServerName: () => "fbm.example",
  sanitizeLocalpart: (s: string) => s,
  buildMxid: (s: string) => `@${s}:fbm.example`,
  generalRoomAlias: () => "general",
})

describe("configuredChatProviderKind", () => {
  it("defaults to matrix so an existing deployment is unchanged", () => {
    expect(configuredChatProviderKind()).toBe("matrix")
  })

  it("honours an explicit selection, case-insensitively", () => {
    process.env.CHAT_PROVIDER = "Blackout"
    expect(configuredChatProviderKind()).toBe("blackout")
  })

  it("falls back to matrix on an unknown value rather than disabling chat", () => {
    // A typo in an env var must not silently take a marketplace's messaging
    // offline — that would look like an outage with no error to trace.
    process.env.CHAT_PROVIDER = "mtarix"
    expect(configuredChatProviderKind()).toBe("matrix")
  })
})

describe("getChatProvider — matrix", () => {
  it("returns the Matrix service, tagged with its kind", () => {
    mockMatrix.mockReturnValue(fakeMatrix())
    const provider = getChatProvider()
    expect(provider).not.toBeNull()
    expect(provider!.kind).toBe("matrix")
  })

  it("returns null when the homeserver is not configured", () => {
    // The load-bearing contract: every caller already handles null, which is
    // how a marketplace without chat degrades instead of erroring.
    mockMatrix.mockReturnValue(null)
    expect(getChatProvider()).toBeNull()
  })

  it("passes calls through to the underlying service unchanged", async () => {
    const matrix = fakeMatrix()
    mockMatrix.mockReturnValue(matrix)
    const provider = getChatProvider()!
    await expect(provider.getUnreadCount("@a:fbm.example")).resolves.toBe(3)
    expect(provider.buildMxid("acme")).toBe("@acme:fbm.example")
  })

  it("memoises so repeated resolution does not rebuild the client", () => {
    mockMatrix.mockReturnValue(fakeMatrix())
    getChatProvider()
    getChatProvider()
    expect(mockMatrix).toHaveBeenCalledTimes(1)
  })

  it("re-resolves after a reset", () => {
    mockMatrix.mockReturnValue(fakeMatrix())
    getChatProvider()
    resetChatProvider()
    getChatProvider()
    expect(mockMatrix).toHaveBeenCalledTimes(2)
  })
})

describe("getChatProvider — blackout", () => {
  beforeEach(() => {
    process.env.CHAT_PROVIDER = "blackout"
  })

  it("returns a provider rather than null, so the misconfiguration surfaces", () => {
    // Returning null here would read as "chat is switched off" and silently
    // skip every chat side effect — the failure this must not hide.
    const provider = getChatProvider()
    expect(provider).not.toBeNull()
    expect(provider!.kind).toBe("blackout")
  })

  it("never silently falls back to FBM's homeserver", async () => {
    // Falling back would route a tenant's private conversations to the wrong
    // server, which is far worse than an error.
    mockMatrix.mockReturnValue(fakeMatrix())
    const provider = getChatProvider()!
    expect(provider.kind).toBe("blackout")
    await expect(provider.getUnreadCount("@a:x")).rejects.toThrow(
      /not implemented/i
    )
  })

  it("fails with a legible reason naming the operation and the fix", async () => {
    const provider = getChatProvider()!
    await expect(provider.sendMessage("!r:x", "hi")).rejects.toThrow(
      /sendMessage/
    )
    await expect(provider.sendMessage("!r:x", "hi")).rejects.toThrow(
      /CHAT_PROVIDER=matrix/
    )
  })

  it("fails on the synchronous identity helpers too", () => {
    const provider = getChatProvider()!
    expect(() => provider.getServerName()).toThrow(/not implemented/i)
    expect(() => provider.buildMxid("acme")).toThrow(/not implemented/i)
  })
})

describe("isChatProviderKind", () => {
  it("accepts the supported backends and rejects anything else", () => {
    expect(isChatProviderKind("matrix")).toBe(true)
    expect(isChatProviderKind("blackout")).toBe(true)
    expect(isChatProviderKind("synapse")).toBe(false)
    expect(isChatProviderKind(null)).toBe(false)
  })
})
