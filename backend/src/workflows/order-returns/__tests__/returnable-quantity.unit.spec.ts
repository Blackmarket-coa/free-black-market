import { MedusaError } from "@medusajs/framework/utils"
import { assertReturnableQuantities, returnableQuantity } from "../returnable-quantity"

/**
 * The quantity rule `createBuyerReturnRequestWorkflow` applies under its
 * order lock. The workflow itself (lock, core return, seller link) runs on a
 * real database in `integration-tests/http/store-return-request.spec.ts`,
 * including the receive-then-ask-again case this rule exists for.
 */

describe("returnableQuantity", () => {
  it("is what was fulfilled when nothing has been returned", () => {
    expect(returnableQuantity({ fulfilled_quantity: 3 })).toBe(3)
  })

  it("subtracts units already requested, received back, dismissed and written off", () => {
    expect(
      returnableQuantity({
        fulfilled_quantity: 10,
        return_requested_quantity: 1,
        return_received_quantity: 2,
        return_dismissed_quantity: 3,
        written_off_quantity: 1,
      })
    ).toBe(3)
  })

  it("counts received units as gone, which core's fulfilled - requested does not", () => {
    // After a receipt core has moved the units from requested to received.
    expect(
      returnableQuantity({ fulfilled_quantity: 2, return_requested_quantity: 0, return_received_quantity: 2 })
    ).toBe(0)
  })

  it("reads the order module's numeric strings and never goes below zero", () => {
    expect(returnableQuantity({ fulfilled_quantity: "2", return_requested_quantity: "3" })).toBe(0)
    expect(returnableQuantity(undefined)).toBe(0)
  })
})

describe("assertReturnableQuantities", () => {
  const items = [
    { id: "ordli_1", detail: { fulfilled_quantity: 2, return_received_quantity: 2 } },
    { id: "ordli_2", detail: { fulfilled_quantity: 3, return_requested_quantity: 1 } },
  ]

  it("passes a request within what is left", () => {
    expect(() => assertReturnableQuantities(items, [{ id: "ordli_2", quantity: 2 }])).not.toThrow()
  })

  it("refuses units already received back, as invalid data (a 400)", () => {
    let thrown: unknown
    try {
      assertReturnableQuantities(items, [{ id: "ordli_1", quantity: 1 }])
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(MedusaError)
    expect((thrown as MedusaError).type).toBe(MedusaError.Types.INVALID_DATA)
  })

  it("refuses more than is left", () => {
    expect(() => assertReturnableQuantities(items, [{ id: "ordli_2", quantity: 3 }])).toThrow(
      /more than 2 of item ordli_2/
    )
  })

  it("leaves an item not on the order to core's validation", () => {
    expect(() => assertReturnableQuantities(items, [{ id: "ordli_missing", quantity: 1 }])).not.toThrow()
  })

  it("reads counters flattened onto the item when there is no detail", () => {
    expect(() =>
      assertReturnableQuantities([{ id: "ordli_3", fulfilled_quantity: 1, return_received_quantity: 1 }], [
        { id: "ordli_3", quantity: 1 },
      ])
    ).toThrow(MedusaError)
  })
})
