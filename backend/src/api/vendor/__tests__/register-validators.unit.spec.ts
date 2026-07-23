import { createSellerRegistrationSchema } from "../register/validators"

const BASE = {
  name: "Test Seller",
  member: { name: "Test Member", email: "member@example.com" },
}

describe("createSellerRegistrationSchema", () => {
  it("accepts a minimal payload without quiz fields", () => {
    const parsed = createSellerRegistrationSchema.parse(BASE)
    expect(parsed.playbook).toBeUndefined()
    expect(parsed.roles).toBeUndefined()
    expect(parsed.resources).toBeUndefined()
  })

  it("accepts the full quiz payload including a multi-role selection", () => {
    const parsed = createSellerRegistrationSchema.parse({
      ...BASE,
      playbook: "stall",
      roles: ["stall", "creator"],
      recommended_playbook: "stall",
      resources: ["goods", "creativity", "capital"],
    })
    expect(parsed.playbook).toBe("stall")
    expect(parsed.roles).toEqual(["stall", "creator"])
    expect(parsed.recommended_playbook).toBe("stall")
    expect(parsed.resources).toEqual(["goods", "creativity", "capital"])
  })

  it("rejects unknown playbook ids in roles", () => {
    expect(() =>
      createSellerRegistrationSchema.parse({
        ...BASE,
        roles: ["stall", "not-a-playbook"],
      })
    ).toThrow()
  })

  it("rejects unknown resource keys", () => {
    expect(() =>
      createSellerRegistrationSchema.parse({
        ...BASE,
        resources: ["land", "unicorns"],
      })
    ).toThrow()
  })
})
