import type { ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Record Payment had no pending guard, unlike Issue Invoice, so a double-click
 * sent two payment requests. The backend accepts a payment on an invoice that
 * is already paid, so only the idempotency key stood between a double-click
 * and a second payment row. The button is now disabled while a payment is in
 * flight, as Issue Invoice is.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)

// The invoicing hooks the section reads, with the mutation state under test.
const hooks = vi.hoisted(() => {
  const issued = (id: string, total: number) => ({
    id,
    invoice_number: `INV-${id}`,
    order_id: null,
    customer_id: "cus_1",
    status: "issued",
    presentation_status: "issued",
    total,
    amount_paid: 0,
    outstanding: total,
    currency_code: "usd",
    terms_days: 30,
    issued_at: "2026-11-01T00:00:00.000Z",
    due_at: "2026-12-01T00:00:00.000Z",
    paid_at: null,
  })
  return {
    invoices: [issued("inv_1", 120), issued("inv_2", 80)],
    recordPayment: {
      isPending: false,
      variables: undefined as undefined | { id: string; amount: number },
      mutateAsync: vi.fn(async (_: { id: string; amount: number }) => ({})),
    },
    createInvoice: { isPending: false, mutateAsync: vi.fn(async () => ({})) },
  }
})
vi.mock("../../hooks/api/invoicing", () => ({
  useInvoices: () => ({ data: { invoices: hooks.invoices } }),
  useInvoiceAging: () => ({ data: undefined }),
  useCreateInvoice: () => hooks.createInvoice,
  useUpdateInvoiceState: () => ({
    isPending: false,
    mutateAsync: vi.fn(async () => ({})),
  }),
  useRecordInvoicePayment: () => hooks.recordPayment,
}))

// Every Button the section renders, so a test can read and press it without a
// DOM. The real Button still renders.
const ui = vi.hoisted(() => ({
  buttons: [] as Array<{
    children?: unknown
    disabled?: boolean
    isLoading?: boolean
    onClick?: () => unknown
  }>,
}))
vi.mock("@medusajs/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@medusajs/ui")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      ui.buttons.push(props as (typeof ui.buttons)[number])
      return createElement(actual.Button, props)
    },
  }
})

import { InvoicingSection } from "./finances"

/** Render the section; return its HTML and its Record Payment buttons. */
const renderSection = () => {
  ui.buttons.length = 0
  const html = renderToStaticMarkup(<InvoicingSection />)
  const recordPayment = ui.buttons.filter(
    (b) => b.children === "Record Payment"
  )
  return { html, recordPayment }
}
/** A browser fires no click on a disabled button, and Medusa's Button is disabled while loading. */
const press = (button: (typeof ui.buttons)[number]) => {
  if (!button.disabled && !button.isLoading) button.onClick?.()
}

beforeEach(() => {
  browser.store.clear()
  hooks.recordPayment.isPending = false
  hooks.recordPayment.variables = undefined
  hooks.recordPayment.mutateAsync.mockClear()
})
afterAll(() => browser.restore())

describe("Record Payment", () => {
  it("is enabled on each issued invoice while no payment is in flight", () => {
    const { html, recordPayment } = renderSection()

    expect(recordPayment).toHaveLength(2)
    expect(
      recordPayment.map((b) => [Boolean(b.disabled), Boolean(b.isLoading)])
    ).toEqual([
      [false, false],
      [false, false],
    ])
    expect(html.match(/<button[^>]*disabled=""/g) ?? []).toHaveLength(0)
  })

  it("is disabled on every invoice while a payment is in flight, with the spinner on the one being paid", () => {
    hooks.recordPayment.isPending = true
    hooks.recordPayment.variables = { id: "inv_1", amount: 120 }

    const { html, recordPayment } = renderSection()

    expect(
      recordPayment.map((b) => [Boolean(b.disabled), Boolean(b.isLoading)])
    ).toEqual([
      [true, true],
      [true, false],
    ])
    // The real Button renders them disabled.
    expect(html.match(/<button[^>]*disabled=""/g) ?? []).toHaveLength(2)
  })

  it("sends one request for a double-click", () => {
    // First click: no payment in flight.
    const first = renderSection().recordPayment[0]
    press(first)
    expect(hooks.recordPayment.mutateAsync).toHaveBeenCalledTimes(1)
    expect(hooks.recordPayment.mutateAsync).toHaveBeenCalledWith({
      id: "inv_1",
      amount: 120,
    })

    // The mutation is now pending, as react-query reports it from the first
    // click; the second click lands on the re-rendered, disabled button.
    hooks.recordPayment.isPending = true
    hooks.recordPayment.variables = { id: "inv_1", amount: 120 }
    press(renderSection().recordPayment[0])

    expect(hooks.recordPayment.mutateAsync).toHaveBeenCalledTimes(1)
  })
})
