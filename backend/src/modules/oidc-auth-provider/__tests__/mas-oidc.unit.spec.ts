import { createServer, type Server } from "http"
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose"
import { MedusaError } from "@medusajs/framework/utils"
import type { AuthIdentityProviderService } from "@medusajs/framework/types"
import MasOidcAuthService, { type MasOidcOptions } from "../service"

/**
 * Real-crypto coverage for the `mas` provider: an in-process node:http "MAS"
 * serves discovery + an ephemeral RSA JWKS + the token endpoint, and jose
 * does genuine signature/iss/aud verification against it. A fetch mock (the
 * adapters.unit.spec pattern) cannot intercept jose's JWKS fetch — jose's
 * node build uses http.get, not fetch — so the local server covers both.
 */

const CLIENT_ID = "00000000000000000000000FBM"
const SUB = "01JMASULID0000000000000000"

let server: Server
let issuer: string
let privateKey: CryptoKey
let strangerKey: CryptoKey
let publicJwk: JWK

const idp = {
  tokenStatus: 200,
  tokenResponse: {} as Record<string, unknown>,
  lastTokenBody: undefined as URLSearchParams | undefined,
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256")
  privateKey = pair.privateKey as CryptoKey
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", use: "sig" }
  strangerKey = (await generateKeyPair("RS256")).privateKey as CryptoKey

  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", issuer).pathname
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }
    if (path === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        jwks_uri: `${issuer}/oauth2/keys.json`,
        id_token_signing_alg_values_supported: ["RS256"],
      })
    }
    if (path === "/oauth2/keys.json") {
      return json(200, { keys: [publicJwk] })
    }
    if (path === "/oauth2/token") {
      let raw = ""
      req.on("data", (chunk) => (raw += chunk))
      req.on("end", () => {
        idp.lastTokenBody = new URLSearchParams(raw)
        if (idp.tokenStatus !== 200) return json(idp.tokenStatus, { error: "invalid_grant" })
        json(200, idp.tokenResponse)
      })
      return
    }
    json(404, { error: "not_found" })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("no port")
  issuer = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  idp.tokenStatus = 200
  idp.tokenResponse = {}
  idp.lastTokenBody = undefined
})

const options = (over: Partial<MasOidcOptions> = {}): MasOidcOptions => ({
  issuer,
  clientId: CLIENT_ID,
  clientSecret: "fbm-secret",
  callbackUrl: "https://api.fbm.test/auth/customer/mas/callback",
  matrixServerName: "blackout.test",
  ...over,
})

const makeService = (over: Partial<MasOidcOptions> = {}) =>
  new MasOidcAuthService({ logger: console as never }, options(over))

/** Map-backed stub of the auth module's provider service. */
const makeIdentityService = (existing?: { entity_id: string }) => {
  const state = new Map<string, Record<string, unknown>>()
  const calls = { create: [] as unknown[], update: [] as unknown[] }
  const service: AuthIdentityProviderService = {
    setState: async (key, value) => {
      state.set(key, value)
    },
    getState: async (key) => state.get(key) ?? null,
    retrieve: async ({ entity_id }) => {
      if (existing && existing.entity_id === entity_id) {
        return { id: "authid_1", entity_id } as never
      }
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "not found")
    },
    create: async (data) => {
      calls.create.push(data)
      return { id: "authid_new", ...data } as never
    },
    update: async (entity_id, data) => {
      calls.update.push({ entity_id, ...data })
      return { id: "authid_1", entity_id, ...data } as never
    },
  }
  return { service, state, calls }
}

const mintIdToken = async (
  claims: Record<string, unknown>,
  over: { iss?: string; aud?: string; key?: CryptoKey } = {}
): Promise<string> =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(over.iss ?? issuer)
    .setAudience(over.aud ?? CLIENT_ID)
    .setSubject(SUB)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(over.key ?? privateKey)

/** Run authenticate() and pull the state key + parked state back out. */
const beginLogin = async (
  service: MasOidcAuthService,
  identity: ReturnType<typeof makeIdentityService>
) => {
  const result = await service.authenticate({ query: {}, body: {} }, identity.service)
  expect(result.success).toBe(true)
  const location = new URL((result as { location: string }).location)
  const stateKey = location.searchParams.get("state")!
  const parked = identity.state.get(stateKey)!
  return { location, stateKey, parked }
}

describe("validateOptions", () => {
  it("requires issuer, clientId, clientSecret and callbackUrl", () => {
    for (const key of ["issuer", "clientId", "clientSecret", "callbackUrl"] as const) {
      const bad: Record<string, unknown> = { ...options() }
      delete bad[key]
      expect(() => MasOidcAuthService.validateOptions(bad)).toThrow(key)
    }
    expect(() => MasOidcAuthService.validateOptions({ ...options() })).not.toThrow()
  })
})

describe("authenticate", () => {
  it("parks PKCE state and redirects to the discovered authorization endpoint", async () => {
    const identity = makeIdentityService()
    const service = makeService()
    const { location, parked } = await beginLogin(service, identity)

    expect(`${location.origin}${location.pathname}`).toBe(`${issuer}/authorize`)
    expect(location.searchParams.get("response_type")).toBe("code")
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID)
    expect(location.searchParams.get("redirect_uri")).toBe(options().callbackUrl)
    expect(location.searchParams.get("scope")).toBe("openid profile")
    expect(location.searchParams.get("code_challenge_method")).toBe("S256")
    expect(location.searchParams.get("code_challenge")).toBeTruthy()
    expect(location.searchParams.get("nonce")).toBe(parked.nonce)
    expect(parked.callback_url).toBe(options().callbackUrl)
    expect(typeof parked.code_verifier).toBe("string")
  })

  it("honors a body callback_url override and custom scopes", async () => {
    const identity = makeIdentityService()
    const service = makeService({ scopes: "openid profile email" })
    const result = await service.authenticate(
      { query: {}, body: { callback_url: "https://other.fbm.test/cb" } },
      identity.service
    )
    const location = new URL((result as { location: string }).location)
    expect(location.searchParams.get("redirect_uri")).toBe("https://other.fbm.test/cb")
    expect(location.searchParams.get("scope")).toBe("openid profile email")
  })

  it("passes through an IdP error", async () => {
    const identity = makeIdentityService()
    const result = await makeService().authenticate(
      { query: { error: "access_denied", error_description: "nope", error_uri: "u" } },
      identity.service
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain("nope")
  })
})

describe("validateCallback", () => {
  it("verifies the id_token and creates the auth identity (entity_id = sub, mxid in user_metadata)", async () => {
    const identity = makeIdentityService()
    const service = makeService()
    const { stateKey, parked } = await beginLogin(service, identity)

    idp.tokenResponse = {
      access_token: "at-1",
      id_token: await mintIdToken({
        nonce: parked.nonce,
        preferred_username: "ibis",
        email: "ibis@example.test",
        name: "Ibis",
      }),
    }

    const result = await service.validateCallback(
      { query: { code: "code-1", state: stateKey } },
      identity.service
    )
    expect(result.success).toBe(true)

    // The exchange used PKCE + client_secret_post with the parked verifier.
    const body = idp.lastTokenBody!
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("client_id")).toBe(CLIENT_ID)
    expect(body.get("client_secret")).toBe("fbm-secret")
    expect(body.get("code")).toBe("code-1")
    expect(body.get("redirect_uri")).toBe(String(parked.callback_url))
    expect(body.get("code_verifier")).toBe(String(parked.code_verifier))

    expect(identity.calls.create).toHaveLength(1)
    const created = identity.calls.create[0] as Record<string, unknown>
    expect(created.entity_id).toBe(SUB)
    const meta = created.user_metadata as Record<string, unknown>
    expect(meta.mxid).toBe("@ibis:blackout.test")
    expect(meta.matrix_localpart).toBe("ibis")
    expect(meta.preferred_username).toBe("ibis")
    expect(meta.email).toBe("ibis@example.test")
    expect(meta.name).toBe("Ibis")
  })

  it("updates the existing identity on a repeat login (update-on-retrieve)", async () => {
    const identity = makeIdentityService({ entity_id: SUB })
    const service = makeService()
    const { stateKey, parked } = await beginLogin(service, identity)

    idp.tokenResponse = {
      id_token: await mintIdToken({ nonce: parked.nonce, preferred_username: "ibis2" }),
    }
    const result = await service.validateCallback(
      { query: { code: "c", state: stateKey } },
      identity.service
    )
    expect(result.success).toBe(true)
    expect(identity.calls.create).toHaveLength(0)
    expect(identity.calls.update).toHaveLength(1)
    const updated = identity.calls.update[0] as Record<string, any>
    expect(updated.entity_id).toBe(SUB)
    expect(updated.user_metadata.mxid).toBe("@ibis2:blackout.test")
  })

  it("rejects an id_token whose nonce is not this transaction's", async () => {
    const identity = makeIdentityService()
    const service = makeService()
    const { stateKey } = await beginLogin(service, identity)
    idp.tokenResponse = { id_token: await mintIdToken({ nonce: "someone-elses" }) }
    const result = await service.validateCallback(
      { query: { code: "c", state: stateKey } },
      identity.service
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain("nonce")
  })

  it("rejects an id_token minted for another audience", async () => {
    const identity = makeIdentityService()
    const service = makeService()
    const { stateKey, parked } = await beginLogin(service, identity)
    idp.tokenResponse = {
      id_token: await mintIdToken({ nonce: parked.nonce }, { aud: "someone-else" }),
    }
    const result = await service.validateCallback(
      { query: { code: "c", state: stateKey } },
      identity.service
    )
    expect(result.success).toBe(false)
  })

  it("rejects a signature the issuer's JWKS cannot validate", async () => {
    const identity = makeIdentityService()
    const service = makeService()
    const { stateKey, parked } = await beginLogin(service, identity)
    idp.tokenResponse = {
      id_token: await mintIdToken({ nonce: parked.nonce }, { key: strangerKey }),
    }
    const result = await service.validateCallback(
      { query: { code: "c", state: stateKey } },
      identity.service
    )
    expect(result.success).toBe(false)
  })

  it("fails cleanly on unknown/expired state, missing code, IdP rejection and a token response without id_token", async () => {
    const identity = makeIdentityService()
    const service = makeService()

    const noState = await service.validateCallback(
      { query: { code: "c", state: "never-parked" } },
      identity.service
    )
    expect(noState).toEqual({ success: false, error: "No state provided, or session expired" })

    const noCode = await service.validateCallback({ query: {} }, identity.service)
    expect(noCode).toEqual({ success: false, error: "No code provided" })

    const denied = await beginLogin(service, identity)
    idp.tokenStatus = 400
    const rejected = await service.validateCallback(
      { query: { code: "bad", state: denied.stateKey } },
      identity.service
    )
    expect(rejected.success).toBe(false)
    expect(rejected.error).toContain("Could not exchange token")

    idp.tokenStatus = 200
    const second = await beginLogin(service, identity)
    idp.tokenResponse = { access_token: "at-only" }
    const noIdToken = await service.validateCallback(
      { query: { code: "c", state: second.stateKey } },
      identity.service
    )
    expect(noIdToken.success).toBe(false)
    expect(noIdToken.error).toContain("id_token")
  })
})

describe("register", () => {
  it("is NOT_ALLOWED — MAS accounts are never minted from FBM", async () => {
    await expect(makeService().register({})).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
  })
})
