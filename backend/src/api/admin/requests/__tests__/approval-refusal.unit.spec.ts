import { SellerApprovalRefusedError } from "../../../../shared/seller-approval-service"
import { approvalErrorResponse } from "../approval-refusal"

/**
 * How both admin approval routes answer a refused approval. The admin
 * panel's Accept posts to POST /admin/requests/:id, which answered every
 * refusal 500 while /approve answered 409 or 400 (measured on Postgres; the
 * HTTP path is pinned by integration-tests/http/vendor-onboarding-journey.spec.ts).
 */
describe("approvalErrorResponse", () => {
  it("answers a conflict refusal 409 with its message", () => {
    expect(approvalErrorResponse(new SellerApprovalRefusedError(409, "The store name is taken."))).toEqual({
      status: 409,
      body: { message: "The store name is taken.", type: "conflict" },
    })
  })

  it("answers an invalid-data refusal 400 with its message", () => {
    expect(approvalErrorResponse(new SellerApprovalRefusedError(400, "Needs a Latin letter."))).toEqual({
      status: 400,
      body: { message: "Needs a Latin letter.", type: "invalid_data" },
    })
  })

  it("answers unreadable application data 400, as /approve did", () => {
    expect(approvalErrorResponse(new Error("Invalid request data: missing member name"))).toEqual({
      status: 400,
      body: { message: "Invalid request data: missing member name" },
    })
  })

  it("leaves any other error to the route", () => {
    expect(approvalErrorResponse(new Error("Seller creation workflow failed: boom"))).toBeNull()
    expect(approvalErrorResponse("not an error")).toBeNull()
    expect(approvalErrorResponse(undefined)).toBeNull()
  })
})
