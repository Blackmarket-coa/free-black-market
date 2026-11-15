import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { ReturnRequest } from "@/types/order-return"

// The seller chat loads TalkJS; this spec is about the request card.
vi.mock("@/components/organisms/Chat/Chat", () => ({
  Chat: () => <span data-chat="" />,
}))
// Reached through the atoms barrel; server-only, and unused by this card.
vi.mock("@/lib/data/cookies", () => ({}))

import { SingleOrderReturn } from "../SingleOrderReturn"

/**
 * `/user/returns` renders one card per row of `GET /store/return-request`.
 * The backend serves only requests with lines, but a row without (an
 * operator's draft return, which it used to serve) crashed the whole page
 * at `line_items[0].created_at`, and an order with no seller at
 * `order.seller.photo`. Rendered through `react-dom/server`, as the other
 * component specs here are (no DOM environment in this workspace).
 */

const request = (over: Partial<ReturnRequest> = {}): ReturnRequest =>
  ({
    id: "return_1",
    status: "requested",
    created_at: "2026-11-15T10:00:00.000Z",
    order: {
      id: "order_1",
      display_id: 42,
      currency_code: "usd",
      items: [
        {
          id: "ordli_1",
          title: "Heirloom",
          product_title: "Tomatoes",
          thumbnail: null,
          unit_price: 5,
        },
      ],
      seller: { id: "sel_1", name: "Grower Co", handle: "grower", photo: null },
    },
    line_items: [
      {
        line_item_id: "ordli_1",
        quantity: 1,
        reason_id: "rr_1",
        created_at: "2026-11-14T09:00:00.000Z",
      },
    ],
    ...over,
  }) as unknown as ReturnRequest

const render = (item: ReturnRequest) =>
  renderToStaticMarkup(
    <SingleOrderReturn
      item={item}
      user={null}
      defaultOpen
      returnReason={[{ id: "rr_1", label: "Arrived damaged" } as never]}
    />
  )

describe("SingleOrderReturn", () => {
  // The workspace compiles JSX with the classic runtime under vitest, as the
  // other component specs note.
  beforeAll(() => {
    vi.stubGlobal("React", React)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it("renders a request with its order, date, item, reason and seller", () => {
    const html = render(request())
    expect(html).toContain("Order: #42")
    expect(html).toContain("Nov 14, 2026")
    expect(html).toContain("Tomatoes")
    expect(html).toContain("Arrived damaged")
    expect(html).toContain("Grower Co")
  })

  it("renders a request with no lines, dated by the return itself", () => {
    const html = render(request({ status: "open", line_items: [] }))
    expect(html).toContain("Order: #42")
    expect(html).toContain("Nov 15, 2026")
    expect(html).toContain("0 item")
  })

  it("renders a request with no date at all", () => {
    const html = render(request({ created_at: undefined, line_items: [] }))
    expect(html).toContain("Return requested date: -")
  })

  it("renders an order with no seller, without the seller block", () => {
    const html = render(
      request({ order: { ...request().order, seller: null } })
    )
    expect(html).toContain("Order: #42")
    expect(html).not.toContain("data-chat")
  })
})
