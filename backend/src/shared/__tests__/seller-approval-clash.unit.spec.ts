import { isHandleClash } from "../seller-approval-service"

/**
 * What approveSeller counts as a store-name clash when createSellerWorkflow
 * fails. Only Medusa's mapped unique violation on seller.handle, for the
 * handle this store name makes (its real wording is pinned on Postgres by
 * integration-tests/http/seller-application-approval.spec.ts, whose clash
 * cases answer 409 only if it matches). In particular not
 * setAuthAppMetadataStep's refusal of a login that is already linked, which
 * also says "already exists" and once resumed approval onto the store the
 * login had been invited into (SD-127 re-review).
 */
describe("isHandleClash", () => {
  it("is the seller handle's unique violation for this handle", () => {
    expect(isHandleClash(new Error("Seller with handle: sunny-farm, already exists."), "sunny-farm")).toBe(true)
  })

  it("is not the app-metadata refusal of a login that is already linked", () => {
    expect(isHandleClash(new Error("Key seller_id already exists in app metadata"), "sunny-farm")).toBe(false)
  })

  it("is not another handle's violation, or another table's", () => {
    expect(isHandleClash(new Error("Seller with handle: other-farm, already exists."), "sunny-farm")).toBe(false)
    expect(isHandleClash(new Error("Member with email: a@example.com, already exists."), "sunny-farm")).toBe(false)
  })

  it("is not anything without that message", () => {
    expect(isHandleClash(undefined, "sunny-farm")).toBe(false)
    expect(isHandleClash({ message: 42 }, "sunny-farm")).toBe(false)
    expect(isHandleClash(new Error("sunny-farm already exists"), "sunny-farm")).toBe(false)
  })
})
