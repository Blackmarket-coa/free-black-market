import { describe, expect, it } from "vitest"
import { assignmentDraft, parseDollars } from "./assignment"

describe("parseDollars", () => {
  it("reads plain dollar amounts exactly, in cents", () => {
    expect(parseDollars("15")).toBe(1500)
    expect(parseDollars("8.57")).toBe(857)
    expect(parseDollars("0.1")).toBe(10)
    expect(parseDollars(" 6.43 ")).toBe(643)
    expect(parseDollars("")).toBe(0)
  })

  it("refuses anything it would have to guess at", () => {
    for (const bad of ["-1", "1.234", "1,000", "$15", "abc", "1e3", "15."]) expect(parseDollars(bad)).toBeNull()
  })
})

describe("assignmentDraft", () => {
  it("builds the request when the amounts add up to the unassigned fee", () => {
    expect(assignmentDraft(1500, { order_a: "8.57", order_b: "6.43" }, "")).toEqual({
      totalCents: 1500,
      problems: [],
      body: { allocations: [{ order_id: "order_a", amount: 8.57 }, { order_id: "order_b", amount: 6.43 }] },
    })
  })

  it("an order left blank or at 0 is not sent; BMC's part is", () => {
    expect(assignmentDraft(1500, { order_a: "5", order_b: "" }, "10").body).toEqual({
      allocations: [{ order_id: "order_a", amount: 5 }],
      bmc_absorbs: 10,
    })
    expect(assignmentDraft(1500, { order_a: "0" }, "15").body).toEqual({ allocations: [], bmc_absorbs: 15 })
  })

  it("does not add up: says by how much, sends nothing", () => {
    const d = assignmentDraft(1500, { order_a: "14.99" }, "")
    expect(d.body).toBeNull()
    expect(d.problems).toEqual(["The amounts add up to $14.99; $15.00 is unassigned"])
  })

  it("an unreadable amount, or an order not yet in the ledger, sends nothing", () => {
    expect(assignmentDraft(1500, { order_a: "15.001" }, "").body).toBeNull()
    expect(assignmentDraft(1500, { order_a: "15" }, "x").body).toBeNull()
    expect(assignmentDraft(1500, { order_a: "15" }, "", new Set(["order_a"])).problems).toEqual([
      "order_a has not reached the ledger yet, so it cannot owe the fee",
    ])
  })

  it("nothing at all is not an assignment", () => {
    expect(assignmentDraft(0, {}, "").problems).toEqual(["Put the fee on at least one order, or say what BMC absorbs"])
  })
})
