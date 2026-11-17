import { MutationObserver, QueryClientProvider } from "@tanstack/react-query"
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
 * Writes are sent once. The panel's query client retried every failed
 * mutation once unless the status was 401, 403 or 429, and the SD-146 review
 * measured what that does: a DELETE answering 204, which the SDK cannot parse
 * as JSON, went out twice, and a POS order answered 502 was sent twice. A
 * gateway error or a dropped connection can follow a write the backend has
 * committed, so a retry duplicates POS orders, invoices, cottage-food sales,
 * farm records, and POS checkout's earnings transfer, which takes no
 * idempotency key.
 */

const browser = await vi.hoisted(async () =>
  (await import("../__tests__/browser-storage")).installBrowserStorage()
)
// fetchQuery logs every failed request in development builds; vitest runs as one.
vi.mock("./logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { useCreateInvoice } from "../hooks/api/invoicing"
import { usePosCheckout, usePosCreateOrder } from "../hooks/api/pos"
import { useUpdateOnboarding } from "../hooks/api/users"
import { useSaveProfile } from "../routes/cottage-food/_shared"
import { setAuthToken } from "./client"
import { queryClient } from "./query-client"
import { sdk } from "./sdk"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
let reply: () => Response | Promise<Response> = () => json(200, {})
const fetchMock = vi.fn(async () => reply())

/** Render a hook under the app's own query client and hand back its result. */
const hookResult = <T,>(useHook: () => T): T => {
  let result: T | undefined
  const Capture = () => {
    result = useHook()
    return null
  }
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Capture />
    </QueryClientProvider>
  )
  return result as T
}

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-seller")
  fetchMock.mockClear()
  reply = () => json(200, {})
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  queryClient.clear()
})
afterAll(() => browser.restore())

describe("the panel's query client", () => {
  it("never retries a mutation, and keeps the query rule: one retry, none for 401, 403 or 429", () => {
    const defaults = queryClient.getDefaultOptions()
    expect(defaults.mutations?.retry).toBe(false)

    const queryRetry = defaults.queries?.retry as (
      count: number,
      error: unknown
    ) => boolean
    expect(queryRetry(0, { status: 500 })).toBe(true)
    expect(queryRetry(1, { status: 500 })).toBe(false)
    for (const status of [401, 403, 429]) {
      expect(queryRetry(0, { status })).toBe(false)
    }
  })
})

describe("a write that fails is sent exactly once", () => {
  it("a POS order answered 502", async () => {
    reply = () => json(502, { message: "Bad Gateway" })
    const createOrder = hookResult(usePosCreateOrder)

    await expect(
      createOrder.mutateAsync({
        items: [{ title: "Jam", quantity: 1, unit_price: 500 }],
        currency_code: "usd",
        payment_method: "cash",
      })
    ).rejects.toMatchObject({ status: 502 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("POS checkout's earnings transfer answered 500", async () => {
    reply = () => json(500, { message: "Internal Server Error" })
    const checkout = hookResult(usePosCheckout)

    await expect(
      checkout.mutateAsync({
        payee_vendor_id: "sel_2",
        amount: 10,
        payment_method: "manual",
      })
    ).rejects.toMatchObject({ status: 500 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("an invoice whose request fails on the network", async () => {
    reply = () => Promise.reject(new TypeError("Failed to fetch"))
    const createInvoice = hookResult(useCreateInvoice)

    await expect(
      createInvoice.mutateAsync({ customer_id: "cus_1", total: 120 })
    ).rejects.toThrow("Failed to fetch")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a cottage-food profile save answered 504", async () => {
    reply = () => json(504, { message: "Gateway Timeout" })
    const save = hookResult(() => useSaveProfile())

    await expect(
      save.mutateAsync({ operation_type: "SHELF_STABLE" })
    ).rejects.toMatchObject({
      status: 504,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a fetchQuery write answered 502", async () => {
    reply = () => json(502, { message: "Bad Gateway" })
    const updateOnboarding = hookResult(useUpdateOnboarding)

    await expect(updateOnboarding.mutateAsync()).rejects.toThrow("Bad Gateway")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a farm DELETE answered 204, which the SDK rejects as unparseable JSON", async () => {
    reply = () => new Response(null, { status: 204 })
    const observer = new MutationObserver(queryClient, {
      mutationFn: () =>
        sdk.client.fetch("/vendor/farm/lots/lot_1", { method: "DELETE" }),
    })

    await expect(observer.mutate()).rejects.toBeInstanceOf(SyntaxError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * No mutation puts a retry back. Read as TypeScript across the source: a
 * `retry` other than `false` or `0` may appear only in a query's options (an
 * object with `queryKey` or `queryFn`) or in the client's `queries` defaults.
 * Anywhere else it reaches a mutation: `useMutation`'s options, options a
 * caller hands to a mutation hook, or the client's mutation defaults.
 */
describe("retry settings in the panel's source", () => {
  const SRC = join(__dirname, "..")
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
  const files = walk(SRC)
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/\.spec\.tsx?$/.test(file) && !file.endsWith(".d.ts"))

  const nameOf = (name: ts.PropertyName) =>
    ts.isIdentifier(name) || ts.isStringLiteralLike(name)
      ? name.text
      : undefined
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
      ? unwrap(node.expression)
      : node
  const neverRetries = (value: ts.Expression) => {
    const v = unwrap(value)
    return (
      v.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isNumericLiteral(v) && Number(v.text) === 0)
    )
  }
  const isQueryOptions = (object: ts.ObjectLiteralExpression) =>
    object.properties.some(
      (p) => p.name && ["queryKey", "queryFn"].includes(nameOf(p.name) ?? "")
    ) ||
    (ts.isPropertyAssignment(object.parent) &&
      nameOf(object.parent.name) === "queries")

  it("finds the retry settings it reads, the client's two defaults among them", () => {
    const found: string[] = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      if (!source.includes("retry")) continue
      const ast = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
      )
      const visit = (node: ts.Node) => {
        if (
          (ts.isPropertyAssignment(node) ||
            ts.isShorthandPropertyAssignment(node)) &&
          nameOf(node.name) === "retry"
        ) {
          found.push(relative(SRC, file).split(sep).join("/"))
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(found.filter((file) => file === "lib/query-client.ts")).toHaveLength(
      2
    )
    expect(found.length).toBeGreaterThan(10)
  })

  it("lets no mutation retry", () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      if (!source.includes("retry")) continue
      const ast = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true
      )
      const visit = (node: ts.Node) => {
        if (
          ts.isShorthandPropertyAssignment(node) &&
          node.name.text === "retry"
        ) {
          offenders.push(`${relative(SRC, file)}: shorthand retry`)
        }
        if (
          ts.isPropertyAssignment(node) &&
          nameOf(node.name) === "retry" &&
          !neverRetries(node.initializer) &&
          !(
            ts.isObjectLiteralExpression(node.parent) &&
            isQueryOptions(node.parent)
          )
        ) {
          const { line } = ast.getLineAndCharacterOfPosition(node.getStart())
          offenders.push(
            `${relative(SRC, file).split(sep).join("/")}:${line + 1}`
          )
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(offenders).toEqual([])
  })
})
