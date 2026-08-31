import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireEmbedKey, optionalEmbedKey } from "../embed-key"
import type { EmbedRequest } from "../embed-key"
import { meterEmbedRequest } from "../../../shared/usage-metering"
import { EMBED_KEYS_MODULE } from "../../../modules/embed-keys"

jest.mock("../../../shared/usage-metering", () => ({
  meterEmbedRequest: jest.fn(),
}))

/**
 * The embed-key gates guarding `/store/embed/*` (hard) and
 * `/store/vendors/:handle` (soft). The pure helpers (extractEmbedKey,
 * originAllowed) are covered in shared/__tests__/embed-auth.unit.spec.ts;
 * these specs cover the middleware branches themselves: status codes, the
 * request context they attach, metering, and the two very different failure
 * postures (hard gate fails closed, soft gate fails open to keyless).
 *
 * Harness follows require-plan-feature.unit.spec.ts: hand-rolled req/res plus
 * a jest.fn() next, asserting on which was called.
 */

type FakeRes = {
  statusCode: number
  body: Record<string, unknown>
  status: jest.Mock
  json: jest.Mock
}

const makeRes = (): FakeRes => {
  const res = { statusCode: 200, body: undefined } as unknown as FakeRes
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = jest.fn((payload: Record<string, unknown>) => {
    res.body = payload
    return res
  })
  return res
}

type HarnessOpts = {
  method?: string
  authorization?: string
  origin?: string
  referer?: string
  /** verifyKey resolution; null = invalid/revoked; "throws" = lookup blew up */
  keyResolution?: { id: string; seller_id: string } | null | "throws"
  /** the vendor's connect_domains allow-list */
  domains?: unknown
}

const makeReq = (opts: HarnessOpts = {}) => {
  const embedKeys = {
    verifyKey: jest.fn(async () => {
      if (opts.keyResolution === "throws") throw new Error("db down")
      return opts.keyResolution === undefined
        ? { id: "ek_1", seller_id: "sel_1" }
        : opts.keyResolution
    }),
  }
  const query = {
    graph: jest.fn(async () => ({
      data: [{ connect_domains: opts.domains ?? ["shop.example.com"] }],
    })),
  }

  const headers: Record<string, string> = {}
  if (opts.authorization) headers.authorization = opts.authorization
  if (opts.origin) headers.origin = opts.origin
  if (opts.referer) headers.referer = opts.referer

  const req = {
    method: opts.method ?? "GET",
    headers,
    scope: {
      resolve: (key: string) => {
        if (key === EMBED_KEYS_MODULE) return embedKeys
        if (key === ContainerRegistrationKeys.QUERY) return query
        return undefined
      },
    },
  }

  return { req: req as unknown as EmbedRequest, embedKeys, query }
}

const VALID_AUTH = "PublishableKey pk_live_abc123"
const ALLOWED_ORIGIN = "https://shop.example.com"

beforeEach(() => {
  jest.clearAllMocks()
})

describe("requireEmbedKey", () => {
  it("401s when no key is presented, without hitting the key store", async () => {
    const { req, embedKeys } = makeReq()
    const res = makeRes()
    const next = jest.fn()

    await requireEmbedKey(req, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ type: "unauthorized" })
    expect(embedKeys.verifyKey).not.toHaveBeenCalled()
  })

  it("401s an invalid or revoked key", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: ALLOWED_ORIGIN,
      keyResolution: null,
    })
    const res = makeRes()
    const next = jest.fn()

    await requireEmbedKey(req, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ type: "unauthorized" })
  })

  it("403s a valid key used from an origin outside connect_domains", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: "https://evil.example.net",
    })
    const res = makeRes()
    const next = jest.fn()

    await requireEmbedKey(req, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ type: "not_allowed" })
    expect(meterEmbedRequest).not.toHaveBeenCalled()
  })

  it("passes an allowed request through with context attached and metered", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: ALLOWED_ORIGIN,
    })
    const res = makeRes()
    const next = jest.fn()

    await requireEmbedKey(req, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(req.embed_seller_id).toBe("sel_1")
    expect(req.embed_key_id).toBe("ek_1")
    expect(req.embed_origin).toBe(ALLOWED_ORIGIN)
    expect(meterEmbedRequest).toHaveBeenCalledWith(req.scope, "sel_1")
  })

  it("falls back to Referer when the request carries no Origin", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      referer: "https://shop.example.com/products?page=2",
    })
    const res = makeRes()
    const next = jest.fn()

    await requireEmbedKey(req, res as never, next)

    expect(next).toHaveBeenCalled()
    // embed_origin records the Origin header specifically, not the fallback.
    expect(req.embed_origin).toBeNull()
  })

  it("lets CORS preflights straight through", async () => {
    const { req, embedKeys } = makeReq({ method: "OPTIONS" })
    const res = makeRes()
    const next = jest.fn()

    await requireEmbedKey(req, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(embedKeys.verifyKey).not.toHaveBeenCalled()
  })

  it("fails CLOSED with 500 when key resolution blows up", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: ALLOWED_ORIGIN,
      keyResolution: "throws",
    })
    const res = makeRes()
    const next = jest.fn()

    await requireEmbedKey(req, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ type: "server_error" })
  })
})

describe("optionalEmbedKey", () => {
  it("passes a keyless request through untouched — the public path", async () => {
    const { req, embedKeys } = makeReq()
    const res = makeRes()
    const next = jest.fn()

    await optionalEmbedKey(req, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(req.embed_seller_id).toBeUndefined()
    expect(embedKeys.verifyKey).not.toHaveBeenCalled()
  })

  it("still 401s an invalid key — a key, once used, is held to the contract", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: ALLOWED_ORIGIN,
      keyResolution: null,
    })
    const res = makeRes()
    const next = jest.fn()

    await optionalEmbedKey(req, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it("still 403s a disallowed origin", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: "https://evil.example.net",
    })
    const res = makeRes()
    const next = jest.fn()

    await optionalEmbedKey(req, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })

  it("attaches context on a valid key but does NOT meter — billing is the hard path's job", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: ALLOWED_ORIGIN,
    })
    const res = makeRes()
    const next = jest.fn()

    await optionalEmbedKey(req, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(req.embed_seller_id).toBe("sel_1")
    expect(req.embed_key_id).toBe("ek_1")
    expect(meterEmbedRequest).not.toHaveBeenCalled()
  })

  it("fails OPEN to keyless when resolution blows up — never break the public catalog", async () => {
    const { req } = makeReq({
      authorization: VALID_AUTH,
      origin: ALLOWED_ORIGIN,
      keyResolution: "throws",
    })
    const res = makeRes()
    const next = jest.fn()

    await optionalEmbedKey(req, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(req.embed_seller_id).toBeUndefined()
  })
})
