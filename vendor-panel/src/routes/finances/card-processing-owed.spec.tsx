import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CardProcessingOwed } from "./card-processing-owed"

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

describe("CardProcessingOwed", () => {
  it("says what is owed, that it comes from the next sales before payout, and why", () => {
    const out = text(
      renderToStaticMarkup(
        <CardProcessingOwed
          owed={{ outstanding: 1.46, open: [{ order_id: "order_1", amount: 1.46, since: null }] }}
          currency="USD"
        />
      )
    )
    expect(out).toContain("Card processing owed $1.46")
    expect(out).toContain("This is taken from your next sales, before any payout.")
    expect(out).toContain("Anything still owed 180 days after the refund is forgiven.")
    expect(out).not.toContain("Forgiven:")
    expect(out).toContain(
      "Why: an order of yours was refunded. Card processing on an order is not returned when the order is refunded, and your earnings at the time did not cover it."
    )
    // Says only what the ledger knows: the amount is an estimate and the
    // order may not have been a card charge (SD-36).
    expect(out).not.toMatch(/Stripe/)
    expect(out).toContain("Refunded: order_1.")
    // Never framed as a fee FBM raised, or a penalty.
    expect(out).not.toMatch(/increase|penalty|late/i)
  })

  it("renders nothing when nothing is owed or forgiven", () => {
    expect(renderToStaticMarkup(<CardProcessingOwed owed={{ outstanding: 0, open: [] }} currency="USD" />)).toBe("")
    expect(
      renderToStaticMarkup(<CardProcessingOwed owed={{ outstanding: 0, open: [], forgiven: [] }} currency="USD" />)
    ).toBe("")
  })

  it("a forgiven amount alone shows as forgiven — not owed, never taken from sales", () => {
    const out = text(
      renderToStaticMarkup(
        <CardProcessingOwed
          owed={{
            outstanding: 0,
            open: [],
            forgiven: [
              { order_id: "order_1", amount: 1.0, since: null, forgiven_at: "2027-03-30T12:00:00.000Z" },
              { order_id: "order_2", amount: 0.46, since: null, forgiven_at: "2027-03-31T12:00:00.000Z" },
            ],
          }}
          currency="USD"
        />
      )
    )
    expect(out).not.toContain("Card processing owed")
    expect(out).toContain(
      "Forgiven: $1.46 of card processing went unrepaid for 180 days after the refund, so you no longer owe it and it will not be taken from your sales."
    )
  })

  it("owed and forgiven together show both", () => {
    const out = text(
      renderToStaticMarkup(
        <CardProcessingOwed
          owed={{
            outstanding: 0.42,
            open: [{ order_id: "order_3", amount: 0.42, since: null }],
            forgiven: [{ order_id: "order_1", amount: 1.46, since: null, forgiven_at: "2027-03-30T12:00:00.000Z" }],
          }}
          currency="USD"
        />
      )
    )
    expect(out).toContain("Card processing owed $0.42")
    expect(out).toContain("Forgiven: $1.46")
  })
})
