import { TooltipProvider } from "@medusajs/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { ReactElement } from "react"
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
 * A lot's allocation is a Postgres enum on the backend (`lot_allocation_enum`).
 * The panel offered "kitchen", which the backend has no equivalent of, and
 * "restaurant" in lower case, so choosing either sent a value the insert
 * refuses; the lot form defaulted to `LotAllocation.RETAIL`, which the panel
 * did not define, so the default sent nothing; and the lot page showed no
 * label for a lot stored as RETAIL.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)

// The lot form's options and the request its mutation sends.
const captured = vi.hoisted(() => ({
  formOptions: [] as Array<{ defaultValues?: Record<string, unknown> }>,
  mutationFns: [] as Array<(variables: unknown) => Promise<unknown>>,
}))
vi.mock("react-hook-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-hook-form")>()
  return {
    ...actual,
    useForm: ((options: { defaultValues?: Record<string, unknown> }) => {
      captured.formOptions.push(options)
      return actual.useForm(options as never)
    }) as typeof actual.useForm,
  }
})
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>()
  return {
    ...actual,
    useMutation: ((options: {
      mutationFn: (variables: unknown) => Promise<unknown>
    }) => {
      captured.mutationFns.push(options.mutationFn)
      return actual.useMutation(options as never)
    }) as typeof actual.useMutation,
  }
})
// The page's route parameter: a lot id on the lot page, a harvest id on the form.
const route = vi.hoisted(() => ({ params: { id: "lot_1" } }))
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useParams: () => route.params,
    useNavigate: () => () => undefined,
  }
})

import { setAuthToken } from "../../lib/client"
import {
  LotAllocation,
  LotAllocationLabels,
  LotGrade,
  type LotDTO,
} from "../../types/domain"
import LotCreatePage from "./harvests/[id]/lots/create/page"
import LotDetailPage from "./lots/[id]/page"

/** The backend's values, from the migration's `CREATE TYPE "lot_allocation_enum"`. */
const BACKEND_VALUES = [
  "RETAIL",
  "RESTAURANT",
  "WHOLESALE",
  "CSA",
  "COOPERATIVE",
  "DONATION",
  "PROCESSING",
]

const sent: Array<{ path: string; method: string; body: unknown }> = []
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      path: new URL(String(input), "http://panel.test").pathname,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(JSON.stringify({ lot: { id: "lot_new" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  }
)

/** Render under the providers the app gives every page (providers.tsx). */
const render = (client: QueryClient, element: ReactElement) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <QueryClientProvider client={client}>{element}</QueryClientProvider>
    </TooltipProvider>
  )
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")

const lot = (allocation_type: string): LotDTO => ({
  id: "lot_1",
  harvest_id: "har_1",
  lot_number: "LOT-1",
  grade: LotGrade.GRADE_A,
  quantity_total: 10,
  quantity_available: 10,
  quantity_reserved: 0,
  quantity_sold: 0,
  unit: "lb",
  allocation_type: allocation_type as LotAllocation,
  surplus_flag: false,
  is_active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  availability_windows: [],
})

beforeEach(() => {
  browser.store.clear()
  route.params = { id: "lot_1" }
  sent.length = 0
  captured.formOptions.length = 0
  captured.mutationFns.length = 0
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("lot allocation values", () => {
  it("are exactly the backend's", () => {
    expect(Object.values(LotAllocation)).toEqual(BACKEND_VALUES)
  })

  it("match the backend's model and migration in this checkout", () => {
    const backend = join(
      __dirname,
      "../../../../backend/src/modules/agriculture"
    )
    const model = join(backend, "models/lot.ts")
    const migration = join(
      backend,
      "migrations/Migration20251228CreateAgriculture.ts"
    )
    expect(existsSync(model), `${model} is part of this repository`).toBe(true)

    // The model's `enum LotAllocation`, read as TypeScript.
    const ast = ts.createSourceFile(
      model,
      readFileSync(model, "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const declaration = ast.statements.find(
      (s): s is ts.EnumDeclaration =>
        ts.isEnumDeclaration(s) && s.name.text === "LotAllocation"
    )
    const modelValues = declaration?.members.map((m) =>
      m.initializer && ts.isStringLiteral(m.initializer)
        ? m.initializer.text
        : undefined
    )
    expect(modelValues).toEqual(BACKEND_VALUES)

    // The Postgres type the migration creates.
    const created = readFileSync(migration, "utf8").match(
      /CREATE TYPE "lot_allocation_enum" AS ENUM \(([^)]*)\)/
    )
    expect(
      created?.[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""))
    ).toEqual(BACKEND_VALUES)
  })

  it("each have their own label", () => {
    const labels = BACKEND_VALUES.map(
      (value) => LotAllocationLabels[value as LotAllocation]
    )
    expect(
      labels.every((label) => typeof label === "string" && label.length > 0)
    ).toBe(true)
    expect(new Set(labels).size).toBe(BACKEND_VALUES.length)
    expect(Object.keys(LotAllocationLabels)).toEqual(BACKEND_VALUES)
  })
})

describe("the lot page", () => {
  it.each(BACKEND_VALUES)("shows the label of a lot allocated %s", (value) => {
    const client = new QueryClient()
    client.setQueryData(["farm-lot", "lot_1"], lot(value))

    const out = text(render(client, <LotDetailPage />))

    expect(out).toContain(LotAllocationLabels[value as LotAllocation])
  })

  it("shows the stored value when the panel has no label for it", () => {
    const client = new QueryClient()
    client.setQueryData(["farm-lot", "lot_1"], lot("SOMETHING_NEW"))

    expect(text(render(client, <LotDetailPage />))).toContain("SOMETHING_NEW")
  })
})

describe("the lot form", () => {
  it("defaults to RETAIL, the backend's default, and sends it when left as it is", async () => {
    setAuthToken("tok-seller")
    route.params = { id: "har_1" }
    render(new QueryClient(), <LotCreatePage />)

    const defaults = captured.formOptions.at(-1)?.defaultValues
    expect(defaults?.allocation_type).toBe("RETAIL")

    // Submit the defaults through the page's own mutation.
    await captured.mutationFns.at(-1)?.(defaults)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      method: "POST",
      path: "/vendor/farm/harvests/har_1/lots",
    })
    expect((sent[0].body as Record<string, unknown>).allocation_type).toBe(
      "RETAIL"
    )
  })
})
