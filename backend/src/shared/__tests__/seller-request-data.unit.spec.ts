import { validateSellerRequestData } from "../seller-approval-service"

/**
 * What approval reads from a stored seller application. The node-operator
 * answer was left out, so approval passed `false` to the metadata and to
 * provisioning for every applicant (measured on Postgres: the request said
 * true, the approved store's metadata said false, and no credential was
 * issued). The full path is pinned by
 * integration-tests/http/vendor-onboarding-journey.spec.ts.
 */
describe("validateSellerRequestData", () => {
  const filed = (extra: Record<string, unknown> = {}) => ({
    auth_identity_id: "authid_1",
    member: { name: "Bravo", email: "bravo@example.com" },
    seller: { name: "Bravo Pantry" },
    vendor_type: "maker",
    playbook: "stall",
    roles: ["stall", "kitchen"],
    recommended_playbook: "hub",
    resources: ["transportation", "goods"],
    ...extra,
  })

  it("carries a stored opt-in to carry deliveries", () => {
    expect(validateSellerRequestData(filed({ node_operator_opt_in: true })).node_operator_opt_in).toBe(true)
  })

  it("reads an opt-out, a missing answer, or anything but true as not opted in", () => {
    expect(validateSellerRequestData(filed({ node_operator_opt_in: false })).node_operator_opt_in).toBe(false)
    expect(validateSellerRequestData(filed()).node_operator_opt_in).toBe(false)
    expect(validateSellerRequestData(filed({ node_operator_opt_in: "true" })).node_operator_opt_in).toBe(false)
    expect(validateSellerRequestData(filed({ node_operator_opt_in: 1 })).node_operator_opt_in).toBe(false)
  })

  it("still carries the playbook answers approval assigns", () => {
    expect(validateSellerRequestData(filed())).toMatchObject({
      playbook: "stall",
      roles: ["stall", "kitchen"],
      recommended_playbook: "hub",
      resources: ["transportation", "goods"],
    })
  })
})
