import { POST } from "../pos/checkout/route"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  return res
}

describe("vendor pos checkout", () => {
  it("refuses every vendor-to-vendor payment until an operator and counsel decide, and moves nothing", async () => {
    // Posture A (SD-145 review): the payer is a member id behind the vendor
    // gate, member-owned SELLER_EARNINGS accounts exist and can hold money,
    // and this route would move USD out of them to any payee in the body.
    const createVendorToVendorPayment = jest.fn()
    const req: any = {
      body: {
        payee_vendor_id: "seller_receiver",
        amount: 120,
        payment_method: "manual",
      },
      auth_context: { actor_id: "mem_payer" },
      _seller_id: "sel_payer",
      _sellerContextResolved: true,
      scope: { resolve: () => ({ createVendorToVendorPayment }) },
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      message:
        "Vendor-to-vendor payments are not available. Record the payment outside FBM or invoice the other vendor instead.",
      type: "not_allowed",
    })
    expect(createVendorToVendorPayment).not.toHaveBeenCalled()
  })
})
