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
 * SD-146 from a real screen: the finances page's invoicing section
 * (routes/finances/finances.tsx) lists, issues, voids and settles invoices
 * through these hooks. They went through lib/sdk's session client, which sent
 * no token, so the vendor gate refused every one of these requests.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)

import { getAuthToken, setAuthToken } from "../../lib/client"
import {
  type InvoiceRecord,
  useCreateInvoice,
  useInvoices,
  useRecordInvoicePayment,
  useUpdateInvoiceState,
} from "./invoicing"

const invoice: InvoiceRecord = {
  id: "inv_1",
  invoice_number: "INV-0001",
  order_id: null,
  customer_id: "cus_1",
  status: "issued",
  presentation_status: "issued",
  total: 120,
  amount_paid: 0,
  outstanding: 120,
  currency_code: "usd",
  terms_days: 30,
  issued_at: "2026-11-01T00:00:00.000Z",
  due_at: "2026-12-01T00:00:00.000Z",
  paid_at: null,
}

type Sent = { path: string; method: string; headers: Headers; body: unknown }
const sent: Sent[] = []
let reply = (): Response => json(200, {})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      path: new URL(String(input), "http://panel.test").pathname,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return reply()
  }
)

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
const render = (client: QueryClient, element: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>
  )

/** The invoice list query, as the section registers it when it renders. */
const ListInvoices = () => {
  useInvoices()
  return null
}
const listQuery = (client: QueryClient) => {
  render(client, <ListInvoices />)
  const query = client
    .getQueryCache()
    .find({ queryKey: ["invoices"], exact: true })
  expect(query).toBeDefined()
  return query!
}

/** The section's three writes, as its buttons call them. */
const writesOf = (client: QueryClient) => {
  const hooks: {
    create?: ReturnType<typeof useCreateInvoice>
    update?: ReturnType<typeof useUpdateInvoiceState>
    pay?: ReturnType<typeof useRecordInvoicePayment>
  } = {}
  const Writes = () => {
    hooks.create = useCreateInvoice()
    hooks.update = useUpdateInvoiceState()
    hooks.pay = useRecordInvoicePayment()
    return null
  }
  render(client, <Writes />)
  return hooks as Required<typeof hooks>
}

beforeEach(() => {
  browser.store.clear()
  sent.length = 0
  fetchMock.mockClear()
  reply = () => json(200, {})
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("invoicing hooks send the seller's token", () => {
  it("useInvoices reads GET /vendor/invoices with the stored token as a bearer", async () => {
    setAuthToken("tok-seller")
    reply = () => json(200, { invoices: [invoice] })
    const client = newClient()

    const query = listQuery(client)
    await query.fetch()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ path: "/vendor/invoices", method: "GET" })
    expect(sent[0].headers.get("authorization")).toBe("Bearer tok-seller")
    expect(query.state.data).toEqual({ invoices: [invoice] })
  })

  it("issuing, voiding and recording a payment each send the bearer, to the routes the backend serves", async () => {
    setAuthToken("tok-seller")
    const client = newClient()
    const { create, update, pay } = writesOf(client)

    reply = () => json(201, { invoice })
    await create.mutateAsync({
      customer_id: "cus_1",
      total: 120,
      currency_code: "USD",
    })
    reply = () => json(200, { invoice: { ...invoice, status: "void" } })
    await update.mutateAsync({
      id: "inv_1",
      status: "void",
      reason: "duplicate",
    })
    reply = () => json(201, { invoice: { ...invoice, status: "paid" } })
    await pay.mutateAsync({ id: "inv_1", amount: 120 })

    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /vendor/invoices",
      "PATCH /vendor/invoices/inv_1",
      "POST /vendor/invoices/inv_1/payments",
    ])
    expect(sent.map((s) => s.headers.get("authorization"))).toEqual([
      "Bearer tok-seller",
      "Bearer tok-seller",
      "Bearer tok-seller",
    ])
    expect(sent.map((s) => s.body)).toEqual([
      { customer_id: "cus_1", total: 120, currency_code: "USD" },
      { status: "void", reason: "duplicate" },
      { amount: 120, method: "manual", idempotency_key: "inv_1:120" },
    ])
  })

  it("a 401 on the list drops the stored token, as the panel's own client does", async () => {
    setAuthToken("tok-revoked")
    reply = () => json(401, { message: "Unauthorized" })
    const client = newClient()

    await expect(listQuery(client).fetch()).rejects.toMatchObject({
      status: 401,
    })

    expect(sent[0].headers.get("authorization")).toBe("Bearer tok-revoked")
    expect(getAuthToken()).toBe("")
  })
})
