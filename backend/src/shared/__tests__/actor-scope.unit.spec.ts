import { actingCustomerId, hawalaAccountOwnershipError } from "../actor-scope"

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

describe("hawalaAccountOwnershipError", () => {
  const makeReq = (auth_context: unknown, account: unknown) =>
    ({
      auth_context,
      scope: { resolve: () => ({ retrieveLedgerAccount: async () => account }) },
    }) as never

  it("passes (null) when a customer owns the account", async () => {
    const r = makeReq(
      { actor_type: "customer", actor_id: "cus_1" },
      { owner_type: "CUSTOMER", owner_id: "cus_1" }
    )
    expect(await hawalaAccountOwnershipError(r, "acc_1")).toBeNull()
  })

  it("rejects when the account belongs to another customer", async () => {
    const r = makeReq(
      { actor_type: "customer", actor_id: "cus_1" },
      { owner_type: "CUSTOMER", owner_id: "cus_2" }
    )
    expect(await hawalaAccountOwnershipError(r, "acc_1")).toMatch(/not yours/i)
  })

  it("rejects when owner_type doesn't match the actor", async () => {
    const r = makeReq(
      { actor_type: "customer", actor_id: "cus_1" },
      { owner_type: "SELLER", owner_id: "cus_1" }
    )
    expect(await hawalaAccountOwnershipError(r, "acc_1")).toMatch(/not yours/i)
  })

  it("maps seller actors to the SELLER owner_type", async () => {
    const r = makeReq(
      { actor_type: "seller", actor_id: "sel_1" },
      { owner_type: "SELLER", owner_id: "sel_1" }
    )
    expect(await hawalaAccountOwnershipError(r, "acc_1")).toBeNull()
  })

  it("rejects when the referenced account is missing", async () => {
    const r = makeReq({ actor_type: "customer", actor_id: "cus_1" }, null)
    expect(await hawalaAccountOwnershipError(r, "acc_x")).toMatch(/not found/i)
  })

  it("skips (null) for actor types with no ledger owner_type (driver)", async () => {
    const r = makeReq(
      { actor_type: "driver", actor_id: "drv_1" },
      { owner_type: "CUSTOMER", owner_id: "cus_2" }
    )
    expect(await hawalaAccountOwnershipError(r, "acc_1")).toBeNull()
  })
})
