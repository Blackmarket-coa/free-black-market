import { actingCustomerId } from "../actor-scope"

const req = (auth_context: unknown) => ({ auth_context }) as never

describe("actingCustomerId", () => {
  it("returns the actor id for a customer actor", () => {
    expect(
      actingCustomerId(req({ actor_type: "customer", actor_id: "cus_123" }))
    ).toBe("cus_123")
  })

  it("returns null for non-customer actors (seller/driver)", () => {
    expect(
      actingCustomerId(req({ actor_type: "seller", actor_id: "sel_1" }))
    ).toBeNull()
    expect(
      actingCustomerId(req({ actor_type: "driver", actor_id: "drv_1" }))
    ).toBeNull()
  })

  it("returns null when unauthenticated or malformed", () => {
    expect(actingCustomerId(req(undefined))).toBeNull()
    expect(actingCustomerId(req({}))).toBeNull()
    // actor_type present but no id
    expect(actingCustomerId(req({ actor_type: "customer" }))).toBeNull()
    // id present but not a customer
    expect(actingCustomerId(req({ actor_id: "cus_1" }))).toBeNull()
  })
})
