import { readFileSync } from "fs"
import { join } from "path"
import { isValidElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { matchRoutes, type RouteObject } from "react-router-dom"
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
 * The user menu's "Report a bug" linked to /bug-report, which no route served:
 * the link landed on the no-match page, and the bug-report page was unreachable.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)

// The page's form, which hands the page its `submit`.
const form = vi.hoisted(() => ({
  submit: undefined as undefined | ((payload: unknown) => Promise<unknown>),
}))
vi.mock("../../components/bug-report/bug-report-form", () => ({
  BugReportForm: (props: {
    submit: (payload: unknown) => Promise<unknown>
  }) => {
    form.submit = props.submit
    return null
  },
}))

import { MainLayout } from "../../components/layout/main-layout"
import { ProtectedRoute } from "../../components/authentication/protected-route"
import { setAuthToken } from "../../lib/client"
import { RouteMap } from "../../providers/router-provider/route-map"
import BugReportPage from "./page"

const sent: Array<{
  path: string
  method: string
  headers: Headers
  body: unknown
}> = []
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      path: new URL(String(input), "http://panel.test").pathname,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(
      JSON.stringify({ url: "https://github.com/x/y/issues/7", number: 7 }),
      {
        status: 201,
        headers: { "content-type": "application/json" },
      }
    )
  }
)

beforeEach(() => {
  browser.store.clear()
  sent.length = 0
  form.submit = undefined
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

const routes = RouteMap as RouteObject[]
const deepest = (path: string) => matchRoutes(routes, path)?.at(-1)?.route

describe("/bug-report", () => {
  it("is served by the bug-report page, inside the signed-in layout", async () => {
    const matches = matchRoutes(routes, "/bug-report") ?? []
    const route = matches.at(-1)?.route
    expect(route?.path).toBe("bug-report")

    const loaded = (await route?.lazy?.()) as
      | { Component?: unknown }
      | undefined
    expect(loaded?.Component).toBe(BugReportPage)

    // Signed in (ProtectedRoute) and in the main layout, where the user menu is.
    const elements = matches.map((m) => m.route.element).filter(isValidElement)
    expect(elements.map((element) => element.type)).toEqual(
      expect.arrayContaining([ProtectedRoute, MainLayout])
    )
  })

  it("is where the user menu's links go, and each of them reaches a page", () => {
    const file = join(
      __dirname,
      "../../components/layout/user-menu/user-menu.tsx"
    )
    const ast = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const targets: string[] = []
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(ast) === "to" &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      ) {
        targets.push(node.initializer.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)

    expect(targets).toContain("/bug-report")
    const noMatch = deepest("/no-such-page")
    expect(noMatch?.path).toBe("*")
    for (const target of targets) {
      expect(deepest(target), target).not.toBe(noMatch)
    }
  })

  it("files the report as POST /vendor/bug-report with the seller's bearer and the form's payload", async () => {
    setAuthToken("tok-seller")
    renderToStaticMarkup(<BugReportPage />)
    expect(form.submit).toBeTypeOf("function")

    // What the form hands its submit (components/bug-report/bug-report-form.tsx),
    // in the shape the backend's bugReportSchema reads.
    const payload = {
      summary: "Harvest list is empty",
      description: "The harvests page shows nothing after I add one.",
      category: "farm",
      includeDiagnostics: true,
      diagnostics: { userAgent: "test", pathname: "/farm/harvests" },
    }
    await expect(form.submit?.(payload)).resolves.toEqual({
      url: "https://github.com/x/y/issues/7",
      number: 7,
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      method: "POST",
      path: "/vendor/bug-report",
      body: payload,
    })
    expect(sent[0].headers.get("authorization")).toBe("Bearer tok-seller")
  })
})
