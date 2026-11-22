import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

/**
 * SD-151 (4): the token sign-up stores names no actor. After approval the
 * session says approved and the panel opens, but Mercur's vendor gate reads
 * the actor off the token, so every `/vendor/*` call answered 403 "Seller is
 * not active" (measured), and the panel drops a token only on a 401.
 * `POST /auth/token/refresh` with that token returns one that names the store
 * (measured). The panel now refreshes it once when the backend says approved,
 * stores the result only if it names an actor, and otherwise signs the vendor
 * out to the login page with a message. One refresh per token: no loop.
 */

const browser = await vi.hoisted(async () =>
  (await import("../__tests__/browser-storage")).installBrowserStorage()
)

// Where the pages send the vendor: <Navigate> records its target.
const router = vi.hoisted(() => ({ navigations: [] as string[] }))
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useLocation: () => ({
      pathname: "/dashboard",
      search: "",
      hash: "",
      state: null,
      key: "default",
    }),
    Navigate: ({ to }: { to: string }) => {
      router.navigations.push(to)
      return null
    },
    Link: ({ children }: { children?: unknown }) => children,
  }
})
vi.mock("./logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
// The layout's providers are not what is under test here.
vi.mock("../providers/matrix-provider", () => ({
  MatrixProvider: ({ children }: { children: unknown }) => children,
}))
vi.mock("../providers/sidebar-provider", () => ({
  SidebarProvider: ({ children }: { children: unknown }) => children,
}))
vi.mock("../providers/search-provider", () => ({
  SearchProvider: ({ children }: { children: unknown }) => children,
}))

import { createBackend, json, jwt } from "../__tests__/backend"
import { ProtectedRoute } from "../components/authentication/protected-route"
import {
  useMe,
  useOnboarding,
  usersQueryKeys,
  type SellerSessionResponse,
} from "../hooks/api/users"
import { PendingApproval } from "../routes/pending-approval/pending-approval"
import { fetchQuery, getAuthToken, setAuthToken } from "./client"
import { classifySessionError } from "./session-error"
import {
  APPROVED_SIGN_IN_AGAIN,
  TokenRefreshFailed,
  TokenRefreshUnavailable,
  storedTokenWasRefused,
  tokenActor,
  upgradeApprovedSellerToken,
} from "./seller-token"

const backend = createBackend()

/** A sign-up token (no actor) and the token a refresh returns after approval. */
let serial = 0
const signUpToken = () =>
  jwt({ actor_id: "", actor_type: "seller", auth_identity_id: "authid_1", n: ++serial })
const sellerToken = () =>
  jwt({ actor_id: "sel_1", actor_type: "seller", auth_identity_id: "authid_1", n: ++serial })

const approved = {
  status: "approved",
  seller_id: "sel_1",
  message: "Your seller account is approved.",
}
const session: SellerSessionResponse = {
  registration_status: approved as SellerSessionResponse["registration_status"],
  seller: { id: "sel_1", name: "Bravo Pantry" } as SellerSessionResponse["seller"],
}
const reason = `/login?reason=${encodeURIComponent(APPROVED_SIGN_IN_AGAIN)}`

/**
 * `retryOnMount: false`: in the browser the page is mounted when its read
 * fails and is handed the error. A static render mounts a new observer each
 * time, which for a failed query with no data would report "loading, about to
 * retry" instead; with this it reports the stored state, as the mounted page
 * sees it.
 */
const newClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false },
      mutations: { retry: false },
    },
  })
const render = (client: QueryClient, element: ReactElement) =>
  show(client, element).navigations
/** What a screen renders, and where it sends the vendor. */
const show = (client: QueryClient, element: ReactElement) => {
  router.navigations.length = 0
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>
  )
  return { html, navigations: [...router.navigations] }
}
const limited = () =>
  json(429, {
    message: "Too many requests, please try again later",
    type: "rate_limit_exceeded",
    retry_after: 27,
  })
/** The query a screen registered when it rendered, run as the screen would run it. */
const run = (client: QueryClient, queryKey: readonly unknown[]) => {
  const query = client.getQueryCache().find({ queryKey, exact: true })
  expect(query, `query ${JSON.stringify(queryKey)}`).toBeDefined()
  return query!.fetch().catch((error: unknown) => error)
}

beforeEach(() => {
  browser.store.clear()
  backend.reset()
  vi.stubGlobal("fetch", backend.fetch)
  backend.on("GET", "/auth/seller/session", () => json(200, session))
  backend.on("GET", "/auth/seller/registration-status", () =>
    json(200, approved)
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("tokenActor", () => {
  it("reads whether a JWT names an actor, and leaves alone what it cannot read", () => {
    expect(tokenActor(sellerToken())).toBe("actor")
    expect(tokenActor(signUpToken())).toBe("none")
    expect(tokenActor(jwt({ actor_type: "seller" }))).toBe("none")
    expect(tokenActor("tok-seller")).toBe("unreadable")
    expect(tokenActor("a.b.c")).toBe("unreadable")
  })
})

describe("upgradeApprovedSellerToken", () => {
  it("sends nothing for a token that names an actor, or one it cannot read", async () => {
    setAuthToken(sellerToken())
    await expect(upgradeApprovedSellerToken()).resolves.toBe("ok")
    setAuthToken("tok-opaque")
    await expect(upgradeApprovedSellerToken()).resolves.toBe("ok")

    expect(backend.sent).toHaveLength(0)
  })

  it("refreshes a token that names no actor: POST /auth/token/refresh with that token as the bearer, and stores the one returned", async () => {
    const stale = signUpToken()
    const fresh = sellerToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", () => json(200, { token: fresh }))

    await expect(upgradeApprovedSellerToken()).resolves.toBe("refreshed")

    expect(backend.sent).toHaveLength(1)
    expect(backend.sent[0]).toMatchObject({
      method: "POST",
      path: "/auth/token/refresh",
      body: {},
    })
    expect(backend.sent[0].headers.get("authorization")).toBe(`Bearer ${stale}`)
    expect(getAuthToken()).toBe(fresh)

    // The next vendor call carries the token that names the store.
    backend.on("GET", "/vendor/sellers/me/onboarding", () =>
      json(200, { onboarding: {} })
    )
    await fetchQuery("/vendor/sellers/me/onboarding", { method: "GET" })
    expect(backend.sent[1].headers.get("authorization")).toBe(`Bearer ${fresh}`)
  })

  it("does not store a refreshed token that still names no actor, and never asks again for that token", async () => {
    const stale = signUpToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", () =>
      json(200, { token: signUpToken() })
    )

    await expect(upgradeApprovedSellerToken()).resolves.toBe("sign_in_again")
    expect(getAuthToken()).toBe(stale)

    await expect(upgradeApprovedSellerToken()).resolves.toBe("sign_in_again")
    await expect(upgradeApprovedSellerToken()).resolves.toBe("sign_in_again")
    expect(backend.calls()).toEqual(["POST /auth/token/refresh"])
  })

  it.each([
    // Measured: an expired sign-up token's refresh answers 401 "Unauthorized".
    ["a 401", () => json(401, { message: "Unauthorized" })],
    ["an answer with no token", () => json(200, {})],
  ])("%s from the refresh means sign in again, after one request", async (_, reply) => {
    const stale = signUpToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", reply)

    await expect(upgradeApprovedSellerToken()).resolves.toBe("sign_in_again")
    await expect(upgradeApprovedSellerToken()).resolves.toBe("sign_in_again")

    expect(backend.calls()).toEqual(["POST /auth/token/refresh"])
    // The helper drops nothing: the page that signs the vendor out does.
    expect(getAuthToken()).toBe(stale)
  })

  it.each([
    // Measured: the refresh shares the `POST /auth/*` limiter with sign-in,
    // and both answered this together.
    [
      "a 429",
      () =>
        json(429, {
          message: "Too many requests, please try again later",
          type: "rate_limit_exceeded",
          retry_after: 27,
        }),
      429,
    ],
    ["a 500", () => json(500, { message: "boom" }), 500],
    ["a 503", () => json(503, { message: "Service Unavailable" }), 503],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch")), undefined],
  ])("%s from the refresh is not a refusal: it rejects with a non-401 error, keeps the token, and asks again next time", async (_, reply, status) => {
    const stale = signUpToken()
    const fresh = sellerToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", reply)

    const error = await upgradeApprovedSellerToken().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TokenRefreshUnavailable)
    expect(error).not.toBeInstanceOf(TokenRefreshFailed)
    expect((error as TokenRefreshUnavailable).status).toBe(status)
    expect((error as TokenRefreshUnavailable).status).not.toBe(401)
    // What the session screens read: anything but a 401 offers a retry.
    expect(classifySessionError(error as Error)).toBe("unavailable")
    expect(getAuthToken()).toBe(stale)
    expect(storedTokenWasRefused()).toBe(false)

    // The next read asks again, and a working answer is stored.
    backend.on("POST", "/auth/token/refresh", () => json(200, { token: fresh }))
    await expect(upgradeApprovedSellerToken()).resolves.toBe("refreshed")
    expect(backend.calls()).toEqual([
      "POST /auth/token/refresh",
      "POST /auth/token/refresh",
    ])
    expect(getAuthToken()).toBe(fresh)
  })

  it("makes one request when several readers ask at once", async () => {
    const fresh = sellerToken()
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", () => json(200, { token: fresh }))

    const outcomes = await Promise.all([
      upgradeApprovedSellerToken(),
      upgradeApprovedSellerToken(),
      upgradeApprovedSellerToken(),
    ])

    expect(outcomes).toEqual(["refreshed", "refreshed", "refreshed"])
    expect(backend.calls()).toEqual(["POST /auth/token/refresh"])
    expect(getAuthToken()).toBe(fresh)
  })

  it("keeps a token a sign-in stored while the refresh was in flight", async () => {
    let release: (response: Response) => void = () => undefined
    backend.on(
      "POST",
      "/auth/token/refresh",
      () => new Promise<Response>((resolve) => (release = resolve))
    )
    setAuthToken(signUpToken())

    const pending = upgradeApprovedSellerToken()
    await vi.waitFor(() => expect(backend.sent).toHaveLength(1))
    const signedIn = sellerToken()
    setAuthToken(signedIn)
    release(json(200, { token: sellerToken() }))
    await pending

    expect(getAuthToken()).toBe(signedIn)
  })
})

describe("the protected layout, for a sign-up token kept after approval", () => {
  it("refreshes the token inside the session read, then shows the panel", async () => {
    const stale = signUpToken()
    const fresh = sellerToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", () => json(200, { token: fresh }))
    const client = newClient()

    // First render: the session is being read.
    expect(render(client, <ProtectedRoute />)).toEqual([])
    await run(client, usersQueryKeys.session())

    expect(backend.calls()).toEqual([
      "GET /auth/seller/session",
      "POST /auth/token/refresh",
    ])
    expect(
      backend.sent.map((s) => s.headers.get("authorization"))
    ).toEqual([`Bearer ${stale}`, `Bearer ${stale}`])
    expect(getAuthToken()).toBe(fresh)
    // The panel opens: no redirect.
    expect(render(client, <ProtectedRoute />)).toEqual([])
    expect(client.getQueryData(usersQueryKeys.session())).toEqual(session)
  })

  it("signs the vendor out to the login page with a message when the refresh does not work, and asks once", async () => {
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", () =>
      json(401, { message: "Unauthorized" })
    )
    const client = newClient()

    render(client, <ProtectedRoute />)
    const error = await run(client, usersQueryKeys.session())

    expect(error).toBeInstanceOf(TokenRefreshFailed)
    expect(render(client, <ProtectedRoute />)).toEqual([reason])
    expect(getAuthToken()).toBe("")
    // Signed out: the layout now only points at the login page, and nothing
    // is asked again.
    expect(render(client, <ProtectedRoute />)).toEqual(["/login"])
    expect(backend.calls()).toEqual([
      "GET /auth/seller/session",
      "POST /auth/token/refresh",
    ])
  })

  it("signs out on a refused refresh even when an earlier read left a pending session cached", async () => {
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", () =>
      json(401, { message: "Unauthorized" })
    )
    const client = newClient()
    client.setQueryData(usersQueryKeys.session(), {
      registration_status: { status: "pending", message: "Pending." },
      seller: null,
    })

    render(client, <ProtectedRoute />)
    await run(client, usersQueryKeys.session())

    expect(render(client, <ProtectedRoute />)).toEqual([reason])
    expect(getAuthToken()).toBe("")
  })

  it("does not sign out a vendor who has signed in again because of the old token's error", async () => {
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", () =>
      json(401, { message: "Unauthorized" })
    )
    const client = newClient()
    client.setQueryData(usersQueryKeys.session(), session)
    render(client, <ProtectedRoute />)
    await run(client, usersQueryKeys.session())

    // A new sign-in replaces the token; the failed read's error is still cached.
    const signedIn = sellerToken()
    setAuthToken(signedIn)

    expect(render(client, <ProtectedRoute />)).toEqual([])
    expect(getAuthToken()).toBe(signedIn)
  })

  it.each([
    ["a 429 from the auth limiter", limited],
    ["a 502", () => json(502, { message: "Bad Gateway" })],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("on %s from the refresh, shows the error screen with a retry and keeps the token, even over a cached session", async (_, reply) => {
    const stale = signUpToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", reply)
    const client = newClient()
    // A session an earlier read cached: the panel must not open on it.
    client.setQueryData(usersQueryKeys.session(), session)

    render(client, <ProtectedRoute />)
    const error = await run(client, usersQueryKeys.session())
    expect(error).toBeInstanceOf(TokenRefreshUnavailable)

    const screen = show(client, <ProtectedRoute />)
    expect(screen.navigations).toEqual([])
    expect(screen.html).toContain("We hit a snag loading your account")
    expect(screen.html).toContain("could not be updated just now")
    expect(screen.html).toContain("Try again")
    expect(getAuthToken()).toBe(stale)

    // Try again: the refresh is asked once more, and the panel opens.
    const fresh = sellerToken()
    backend.on("POST", "/auth/token/refresh", () => json(200, { token: fresh }))
    await run(client, usersQueryKeys.session())
    expect(render(client, <ProtectedRoute />)).toEqual([])
    expect(getAuthToken()).toBe(fresh)
    expect(
      backend.calls().filter((c) => c === "POST /auth/token/refresh")
    ).toHaveLength(2)
  })

  it("does not keep the retry screen up for a vendor who has signed in again after a refresh got no answer", async () => {
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", limited)
    const client = newClient()
    client.setQueryData(usersQueryKeys.session(), session)
    render(client, <ProtectedRoute />)
    await run(client, usersQueryKeys.session())
    expect(show(client, <ProtectedRoute />).html).toContain(
      "We hit a snag loading your account"
    )

    // A new sign-in stores a token that names the store; the 429 is still cached.
    const signedIn = sellerToken()
    setAuthToken(signedIn)

    const screen = show(client, <ProtectedRoute />)
    expect(screen.html).not.toContain("We hit a snag loading your account")
    expect(screen.navigations).toEqual([])
    expect(getAuthToken()).toBe(signedIn)
  })

  it("leaves a token that already names the store alone", async () => {
    const token = sellerToken()
    setAuthToken(token)
    const client = newClient()

    render(client, <ProtectedRoute />)
    await run(client, usersQueryKeys.session())

    expect(backend.calls()).toEqual(["GET /auth/seller/session"])
    expect(getAuthToken()).toBe(token)
    expect(render(client, <ProtectedRoute />)).toEqual([])
  })

  it("does not refresh while the application is still pending", async () => {
    const stale = signUpToken()
    setAuthToken(stale)
    backend.on("GET", "/auth/seller/session", () =>
      json(200, {
        registration_status: { status: "pending", message: "Pending." },
        seller: null,
      })
    )
    const client = newClient()

    render(client, <ProtectedRoute />)
    await run(client, usersQueryKeys.session())

    expect(backend.calls()).toEqual(["GET /auth/seller/session"])
    expect(getAuthToken()).toBe(stale)
    expect(render(client, <ProtectedRoute />)).toEqual(["/pending-approval"])
  })
})

describe("the pending-approval page, when the status turns approved", () => {
  it("refreshes the token, drops a session cached while pending, and goes to the dashboard", async () => {
    const stale = signUpToken()
    const fresh = sellerToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", () => json(200, { token: fresh }))
    const client = newClient()
    // What the protected layout cached when it sent the applicant here.
    client.setQueryData(usersQueryKeys.session(), {
      registration_status: { status: "pending", message: "Pending." },
      seller: null,
    })
    expect(render(client, <ProtectedRoute />)).toEqual(["/pending-approval"])

    render(client, <PendingApproval />)
    await run(client, usersQueryKeys.registrationStatus())

    expect(backend.calls()).toEqual([
      "GET /auth/seller/registration-status",
      "POST /auth/token/refresh",
    ])
    expect(backend.sent[1].headers.get("authorization")).toBe(`Bearer ${stale}`)
    expect(getAuthToken()).toBe(fresh)
    expect(render(client, <PendingApproval />)).toEqual(["/dashboard"])
    // The layout no longer holds the pending session that would send the
    // vendor straight back: it reads the session again.
    expect(client.getQueryData(usersQueryKeys.session())).toBeUndefined()
    expect(render(client, <ProtectedRoute />)).toEqual([])
  })

  it("signs the vendor out to the login page with the message when the refresh does not work", async () => {
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", () =>
      json(200, { token: signUpToken() })
    )
    const client = newClient()

    render(client, <PendingApproval />)
    const error = await run(client, usersQueryKeys.registrationStatus())

    expect(error).toBeInstanceOf(TokenRefreshFailed)
    expect(render(client, <PendingApproval />)).toEqual([reason])
    expect(getAuthToken()).toBe("")
    expect(backend.calls()).toEqual([
      "GET /auth/seller/registration-status",
      "POST /auth/token/refresh",
    ])
  })
  it("on a 429 from the refresh, keeps the vendor here with the reason and a retry, signed in", async () => {
    const stale = signUpToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", limited)
    const client = newClient()

    render(client, <PendingApproval />)
    const error = await run(client, usersQueryKeys.registrationStatus())

    expect(error).toBeInstanceOf(TokenRefreshUnavailable)
    const page = show(client, <PendingApproval />)
    expect(page.navigations).toEqual([])
    expect(page.html).toContain("Your store is approved")
    expect(page.html).toContain("Too many requests, please try again later")
    expect(page.html).toContain("Try again")
    expect(getAuthToken()).toBe(stale)
  })

  it("on a 429 over an approved status read before, stays here with the retry instead of opening the dashboard", async () => {
    const stale = signUpToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", limited)
    const client = newClient()
    // What an earlier read of this page cached.
    client.setQueryData(usersQueryKeys.registrationStatus(), approved)

    render(client, <PendingApproval />)
    await run(client, usersQueryKeys.registrationStatus())

    const page = show(client, <PendingApproval />)
    expect(page.navigations).toEqual([])
    expect(page.html).toContain("Your store is approved")
    expect(page.html).toContain("Try again")
    expect(getAuthToken()).toBe(stale)
  })

  it("does not sign out a vendor who has signed in again because of the old token's error", async () => {
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", () =>
      json(401, { message: "Unauthorized" })
    )
    const client = newClient()
    render(client, <PendingApproval />)
    const error = await run(client, usersQueryKeys.registrationStatus())
    expect(error).toBeInstanceOf(TokenRefreshFailed)

    // A new sign-in replaces the token; the failed read's error is still cached.
    const signedIn = sellerToken()
    setAuthToken(signedIn)

    expect(render(client, <PendingApproval />)).not.toContain(reason)
    expect(getAuthToken()).toBe(signedIn)
  })
})

describe("reads made at the app's root, beside the protected layout", () => {
  const Probe = () => {
    useMe()
    useOnboarding()
    return null
  }

  it("refresh the token once before any /vendor call, and send the new token", async () => {
    const stale = signUpToken()
    const fresh = sellerToken()
    setAuthToken(stale)
    backend.on("POST", "/auth/token/refresh", () => json(200, { token: fresh }))
    backend.on("GET", "/vendor/sellers/me", () => json(200, { seller: {} }))
    backend.on("GET", "/vendor/sellers/me/onboarding", () =>
      json(200, { onboarding: {} })
    )
    const client = newClient()

    render(client, <Probe />)
    await Promise.all([
      run(client, usersQueryKeys.me()),
      run(client, ["onboarding"]),
    ])

    const vendorCalls = backend.sent.filter((s) => s.path.startsWith("/vendor"))
    expect(vendorCalls.map((s) => s.path).sort()).toEqual([
      "/vendor/sellers/me",
      "/vendor/sellers/me/onboarding",
    ])
    expect(vendorCalls.map((s) => s.headers.get("authorization"))).toEqual([
      `Bearer ${fresh}`,
      `Bearer ${fresh}`,
    ])
    expect(
      backend.calls().filter((c) => c === "POST /auth/token/refresh")
    ).toHaveLength(1)
  })

  it("make no /vendor call with a token that could not be refreshed", async () => {
    setAuthToken(signUpToken())
    backend.on("POST", "/auth/token/refresh", () =>
      json(401, { message: "Unauthorized" })
    )
    const client = newClient()

    render(client, <Probe />)
    await Promise.all([
      run(client, usersQueryKeys.me()),
      run(client, ["onboarding"]),
    ])

    expect(backend.sent.filter((s) => s.path.startsWith("/vendor"))).toEqual([])
    expect(
      backend.calls().filter((c) => c === "POST /auth/token/refresh")
    ).toHaveLength(1)
  })
})
