import reencryptChannelCredentials from "../reencrypt-channel-credentials"
import { CHANNEL_CONNECTOR_MODULE } from "../../modules/channel-connector/module-key"
import { channelCredentialCipher } from "../../modules/channel-connector/lib/credentials"

/**
 * The script exists because the cipher's plaintext passthrough — the thing that
 * makes deploying encryption non-breaking — also means a connection nobody
 * edits stays readable forever. These cover the ways a migration script like
 * this does damage: writing when it was only asked to count, touching state it
 * has no business touching, and reporting success over failures.
 */

const OLD_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...OLD_ENV }
  process.env.CHANNEL_CREDENTIAL_KEY = "unit-test-channel-key-000000000000"
  jest.clearAllMocks()
})

afterAll(() => {
  process.env = OLD_ENV
})

const row = (id: string, token: string, overrides: Record<string, unknown> = {}) => ({
  id,
  seller_id: `sel_${id}`,
  channel_id: "faire",
  access_token: token,
  ...overrides,
})

function makeContainer(rows: Record<string, unknown>[]) {
  const updateChannelConnections = jest.fn(
    async (_input: { id: string; access_token: string }) => undefined
  )
  const logger = {
    info: jest.fn((_m: string) => undefined),
    error: jest.fn((_m: string) => undefined),
    warn: jest.fn((_m: string) => undefined),
  }
  const service = {
    listChannelConnections: async () => rows,
    updateChannelConnections,
  }
  return {
    container: {
      resolve: (key: string) =>
        key === CHANNEL_CONNECTOR_MODULE ? service : logger,
    },
    updateChannelConnections,
    logger,
  }
}

const logged = (logger: { info: jest.Mock }) =>
  logger.info.mock.calls.map((c) => String(c[0])).join("\n")

describe("reencryptChannelCredentials", () => {
  it("counts plaintext without writing anything by default", async () => {
    // Dry run is the default because rewriting every credential row is not
    // something to do because a command was typed slightly wrong.
    const { container, updateChannelConnections, logger } = makeContainer([
      row("a", "plaintext-token"),
      row("b", channelCredentialCipher.encrypt("already-safe")),
    ])

    await reencryptChannelCredentials({ container, args: [] } as never)

    expect(updateChannelConnections).not.toHaveBeenCalled()
    expect(logged(logger)).toMatch(/1 encrypted, 1 plaintext/)
    expect(logged(logger)).toMatch(/dry run/i)
  })

  it("encrypts plaintext rows when asked, and leaves encrypted ones alone", async () => {
    const { container, updateChannelConnections } = makeContainer([
      row("a", "plaintext-token"),
      row("b", channelCredentialCipher.encrypt("already-safe")),
    ])

    await reencryptChannelCredentials({ container, args: ["--apply"] } as never)

    expect(updateChannelConnections).toHaveBeenCalledTimes(1)
    const written = updateChannelConnections.mock.calls[0][0]
    expect(written.id).toBe("a")
    expect(channelCredentialCipher.isEncrypted(written.access_token)).toBe(true)
    expect(channelCredentialCipher.decrypt(written.access_token)).toBe(
      "plaintext-token"
    )
  })

  it("writes only the token column", async () => {
    // Not `upsertConnection`, which clears throttle state and re-enables a
    // connection the vendor may have deliberately paused. This is a storage
    // migration and has no business changing what the connection is doing.
    const { container, updateChannelConnections } = makeContainer([
      row("a", "plaintext-token", { enabled: false, needs_reauth: true }),
    ])

    await reencryptChannelCredentials({ container, args: ["--apply"] } as never)

    expect(Object.keys(updateChannelConnections.mock.calls[0][0]).sort()).toEqual(
      ["access_token", "id"]
    )
  })

  it("never logs any part of a token", async () => {
    // A "first four characters" preview is a genuinely useful debugging aid and
    // exactly the kind of thing that lives in a log aggregator forever.
    const secret = "faire_live_sk_SUPERSECRET"
    const { container, logger } = makeContainer([row("a", secret)])

    await reencryptChannelCredentials({ container, args: [] } as never)

    const all = [...logger.info.mock.calls, ...logger.error.mock.calls]
      .map((c) => String(c[0]))
      .join("\n")
    expect(all).not.toContain(secret)
    expect(all).not.toContain("faire_live")
    // But it does say which row, so the finding is actionable.
    expect(all).toContain("sel_a/faire")
  })

  it("counts an empty token separately from an encrypted one", async () => {
    // A row with no token is broken, not protected. Folding it into either
    // count would misreport how much exposure is left.
    const { container, logger } = makeContainer([row("a", "")])

    await reencryptChannelCredentials({ container, args: [] } as never)

    expect(logged(logger)).toMatch(/0 encrypted, 0 plaintext, 1 with no token/)
  })

  it("throws when a row could not be encrypted", async () => {
    // Otherwise a deploy pipeline records success while readable tokens remain.
    delete process.env.CHANNEL_CREDENTIAL_KEY
    delete process.env.JWT_SECRET
    const { container, updateChannelConnections } = makeContainer([
      row("a", "plaintext-token"),
    ])

    await expect(
      reencryptChannelCredentials({ container, args: ["--apply"] } as never)
    ).rejects.toThrow(/could not be encrypted/)
    expect(updateChannelConnections).not.toHaveBeenCalled()
  })

  it("does nothing when there are no connections", async () => {
    const { container, updateChannelConnections, logger } = makeContainer([])
    await reencryptChannelCredentials({ container, args: ["--apply"] } as never)
    expect(updateChannelConnections).not.toHaveBeenCalled()
    expect(logged(logger)).toMatch(/no channel connections/)
  })
})
