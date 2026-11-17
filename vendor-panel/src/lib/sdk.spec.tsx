import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative, sep } from "path"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
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
 * SD-146: the farm, cottage-food, invoicing, POS, digital-products and
 * bug-report screens import `sdk` from lib/sdk. It was built with
 * `auth: { type: "session" }`, for which the JS SDK sends no Authorization
 * header (`getJwtHeader_`), and the panel never makes a session: it signs
 * sellers in with JWTs. Mercur's vendor gate reads only the bearer, so every
 * `/vendor` call those screens made was refused.
 *
 * The fixed client must send the token the rest of the panel sends, from the
 * panel's one store, and treat a 401 as `fetchQuery` does: drop the token,
 * after which the protected layout sends the seller to sign in.
 */

// lib/client decides once, when it loads, whether it runs in a browser, and
// the SDK reads `window.localStorage` on every request, so the browser's
// storage exists before any import below is evaluated.
const browser = vi.hoisted(() => {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
  }
  const g = globalThis as { window?: unknown }
  const previousWindow = g.window
  g.window = { localStorage, location: { origin: "http://panel.test" } }
  return { store, previousWindow }
})

// Where the protected layout sends the seller: <Navigate> records its target.
// The layout reads the location only to pass it along, so no router is needed.
const router = vi.hoisted(() => ({ navigations: [] as unknown[] }))
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useLocation: () => ({
      pathname: "/farm",
      search: "",
      hash: "",
      state: null,
      key: "default",
    }),
    Navigate: ({ to }: { to: unknown }) => {
      router.navigations.push(to)
      return null
    },
  }
})
// fetchQuery logs every failed request in development builds; vitest runs as one.
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

import { ProtectedRoute } from "../components/authentication/protected-route"
import {
  clearAuthToken,
  fetchQuery,
  getAuthToken,
  setAuthToken,
} from "./client"
import { isFetchError } from "./is-fetch-error"
import { queryClient } from "./query-client"
import { sdk } from "./sdk"

/** The key the panel's sign-in writes and `getAuthToken` reads. */
const TOKEN_KEY = "medusa_auth_token"

type Sent = { path: string; method: string; headers: Headers; body: unknown }
const sent: Sent[] = []
let reply = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
const answer = (status: number, body: Record<string, unknown>) => {
  reply = () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
}
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      path: new URL(String(input), "http://panel.test").pathname,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    })
    return reply()
  }
)

/** Render the protected layout once and return where it navigated, if anywhere. */
const protectedLayoutNavigates = () => {
  router.navigations.length = 0
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ProtectedRoute />
    </QueryClientProvider>
  )
  return [...router.navigations]
}

beforeEach(() => {
  browser.store.clear()
  sent.length = 0
  fetchMock.mockClear()
  answer(200, { ok: true })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => {
  ;(globalThis as { window?: unknown }).window = browser.previousWindow
})

describe("lib/sdk sends the panel's token", () => {
  it("sends the token the panel stored at sign-in as a bearer", async () => {
    // setAuthToken is what the panel's sign-in calls with the login's JWT.
    setAuthToken("tok-seller")

    await sdk.client.fetch("/vendor/invoices")

    expect(sent).toHaveLength(1)
    expect(sent[0].path).toBe("/vendor/invoices")
    expect(sent[0].headers.get("authorization")).toBe("Bearer tok-seller")
    // One store: the token is where the panel keeps it, under its key, and
    // nowhere else.
    expect([...browser.store.entries()]).toEqual([[TOKEN_KEY, "tok-seller"]])
  })

  it("reads the store on every request, so a new sign-in's token goes out and a dropped one does not", async () => {
    setAuthToken("tok-first")
    await sdk.client.fetch("/vendor/cottage-food/compliance")
    setAuthToken("tok-second")
    await sdk.client.fetch("/vendor/cottage-food/compliance")
    clearAuthToken()
    await sdk.client.fetch("/vendor/cottage-food/compliance")

    expect(sent.map((s) => s.headers.get("authorization"))).toEqual([
      "Bearer tok-first",
      "Bearer tok-second",
      null,
    ])
  })

  it("sends the same bearer fetchQuery sends", async () => {
    setAuthToken("tok-same")
    await fetchQuery("/vendor/farm/stats", { method: "GET" })
    await sdk.client.fetch("/vendor/farm/stats")

    expect(sent).toHaveLength(2)
    expect(sent[1].headers.get("authorization")).toBe(
      sent[0].headers.get("authorization")
    )
    expect(sent[1].headers.get("authorization")).toBe("Bearer tok-same")
  })

  it("sends writes the same way, with their JSON body", async () => {
    setAuthToken("tok-writer")
    await sdk.client.fetch("/vendor/invoices/inv_1", {
      method: "PATCH",
      body: { status: "void", reason: "duplicate" },
    })

    expect(sent[0].method).toBe("PATCH")
    expect(sent[0].headers.get("authorization")).toBe("Bearer tok-writer")
    expect(JSON.parse(String(sent[0].body))).toEqual({
      status: "void",
      reason: "duplicate",
    })
  })
})

describe("lib/sdk on a 401", () => {
  it("with no token: sends no Authorization header, rejects with the 401 the panel's handlers read, and the protected layout sends the seller to sign in", async () => {
    answer(401, { message: "Unauthorized" })

    const error = await sdk.client
      .fetch("/vendor/invoices")
      .catch((e: unknown) => e)

    expect(sent).toHaveLength(1)
    expect(sent[0].headers.has("authorization")).toBe(false)
    // The route ErrorBoundary sends a thrown FetchError 401 to /login, and the
    // query client never retries a 401: both read `status` off a FetchError.
    expect(isFetchError(error)).toBe(true)
    expect((error as { status?: number }).status).toBe(401)
    const retry = queryClient.getDefaultOptions().queries?.retry
    expect(typeof retry).toBe("function")
    expect(
      (retry as (count: number, error: unknown) => boolean)(0, error)
    ).toBe(false)

    expect(protectedLayoutNavigates()).toEqual(["/login"])
  })

  it("drops a token the backend refuses, so the protected layout that showed the page now sends the seller to sign in", async () => {
    setAuthToken("tok-revoked")
    // With a token the layout does not redirect: it waits for the session.
    expect(protectedLayoutNavigates()).toEqual([])

    answer(401, { message: "Unauthorized" })
    await expect(sdk.client.fetch("/vendor/farm/stats")).rejects.toMatchObject({
      status: 401,
    })

    expect(sent[0].headers.get("authorization")).toBe("Bearer tok-revoked")
    expect(getAuthToken()).toBe("")
    expect(browser.store.has(TOKEN_KEY)).toBe(false)
    expect(protectedLayoutNavigates()).toEqual(["/login"])
  })

  // fetchQuery drops the token on a 401 from any route isPublicAuthRoute does
  // not exempt (sign-in and email verification), and on nothing else: a 403
  // from a guard or a 500 is not a bad token.
  it.each([
    [401, "/vendor/invoices", ""],
    [401, "/admin/digital-products", ""],
    [403, "/vendor/invoices", "tok"],
    [404, "/vendor/farm/harvests/har_gone", "tok"],
    [500, "/vendor/pos/config", "tok"],
    [401, "/auth/seller/emailpass", "tok"],
    [401, "/vendor/verify-email", "tok"],
  ])(
    "a %i from %s leaves the stored token as fetchQuery leaves it",
    async (status, path, expected) => {
      answer(status, { message: "refused" })

      setAuthToken("tok")
      await expect(fetchQuery(path, { method: "GET" })).rejects.toThrow()
      const afterFetchQuery = getAuthToken()

      setAuthToken("tok")
      await expect(sdk.client.fetch(path)).rejects.toMatchObject({ status })
      const afterSdk = getAuthToken()

      expect(afterFetchQuery).toBe(expected)
      expect(afterSdk).toBe(afterFetchQuery)
    }
  )
})

/**
 * A walk over the panel's source, read as TypeScript so that comments and
 * strings do not count: no file can import a session-type client, because
 * none is configured, and SDK clients are made in one place, lib/client,
 * where each is a JWT client reading the panel's store.
 */
describe("SDK clients in the panel's source", () => {
  const SRC = join(__dirname, "..")
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
  const files = walk(SRC)
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/\.spec\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
  const sources = files.map((file) => ({
    file: relative(SRC, file).split(sep).join("/"),
    ast: ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    ),
  }))

  const visit = (node: ts.Node, fn: (node: ts.Node) => void) => {
    fn(node)
    ts.forEachChild(node, (child) => visit(child, fn))
  }
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
      ? unwrap(node.expression)
      : node
  const nameOf = (name: ts.PropertyName) =>
    ts.isIdentifier(name) || ts.isStringLiteralLike(name)
      ? name.text
      : undefined
  const property = (object: ts.Expression | undefined, name: string) => {
    const literal = object && unwrap(object)
    if (!literal || !ts.isObjectLiteralExpression(literal)) return undefined
    const found = literal.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && nameOf(p.name) === name
    )
    return found && unwrap(found.initializer)
  }
  const importsOf = (ast: ts.SourceFile) =>
    ast.statements.filter(
      (s): s is ts.ImportDeclaration & { moduleSpecifier: ts.StringLiteral } =>
        ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)
    )

  it("walks the whole source tree, the seventeen former session importers among it", () => {
    expect(sources.length).toBeGreaterThan(500)
    const importers = sources
      .filter(({ ast }) =>
        importsOf(ast).some((s) =>
          /^\.\.?\/(?:.*\/)?sdk$/.test(s.moduleSpecifier.text)
        )
      )
      .map(({ file }) => file)
    expect(importers.length).toBeGreaterThanOrEqual(17)
    expect(importers).toEqual(
      expect.arrayContaining([
        "hooks/api/invoicing.ts",
        "hooks/api/pos.ts",
        "routes/bug-report/page.tsx",
        "routes/cottage-food/_shared.tsx",
        "routes/farm/page.tsx",
      ])
    )
  })

  it("configures no session-type SDK client anywhere", () => {
    // `type: "session"` in an object literal is how a JS SDK client is told
    // to send no Authorization header.
    const offenders: string[] = []
    for (const { file, ast } of sources) {
      visit(ast, (node) => {
        if (
          ts.isPropertyAssignment(node) &&
          nameOf(node.name) === "type" &&
          ts.isStringLiteralLike(unwrap(node.initializer)) &&
          (unwrap(node.initializer) as ts.StringLiteralLike).text === "session"
        ) {
          offenders.push(file)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it("makes SDK clients only in lib/client, each with JWT auth", () => {
    // A file can make a client only through the SDK's default export, a
    // namespace import of it, or its Client class.
    const makers = new Map<string, string[]>()
    for (const { file, ast } of sources) {
      for (const declaration of importsOf(ast)) {
        const clause = declaration.importClause
        if (declaration.moduleSpecifier.text !== "@medusajs/js-sdk" || !clause)
          continue
        if (clause.isTypeOnly) continue
        const names: string[] = clause.name ? [clause.name.text] : []
        const bindings = clause.namedBindings
        if (bindings && ts.isNamespaceImport(bindings))
          names.push(bindings.name.text)
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text
            if (!element.isTypeOnly && imported === "Client")
              names.push(element.name.text)
          }
        }
        if (names.length) makers.set(file, names)
      }
    }
    expect([...makers.keys()]).toEqual(["lib/client/client.ts"])

    const constructors = makers.get("lib/client/client.ts") ?? []
    const client = sources.find(({ file }) => file === "lib/client/client.ts")
    const authTypes: Array<string | undefined> = []
    visit(client!.ast, (node) => {
      if (!ts.isNewExpression(node)) return
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression)
          ? callee.expression.text
          : undefined
      if (!name || !constructors.includes(name)) return
      const type = property(property(node.arguments?.[0], "auth"), "type")
      authTypes.push(
        type && ts.isStringLiteralLike(type) ? type.text : undefined
      )
    })
    // `sdk` (token in localStorage, read per request) and `publicAuthSdk`
    // (sign-in, token in memory, handed to setAuthToken).
    expect(authTypes).toEqual(["jwt", "jwt"])
  })
})
