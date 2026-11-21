import { GET, POST } from "../hawala/payments/route"
import { HAWALA_LEDGER_MODULE } from "../../../modules/hawala-ledger"

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

// The gate's resolved store, so resolveVendorSellerId needs no lookup.
const vendorReq = (scope: { resolve: jest.Mock }, body?: unknown): any => ({
  body,
  auth_context: { actor_id: "mem_payer" },
  _seller_id: "sel_payer",
  _sellerContextResolved: true,
  scope,
})

describe("vendor hawala payments", () => {
  it("refuses every vendor-to-vendor payment until an operator and counsel decide, before it resolves anything", async () => {
    // Posture A (SD-145 review): the same VENDOR_PAYMENT transfer as
    // pos/checkout, from the store's earnings to any payee in the body, with
    // a LOAN label on offer. Measured in review: 201, payer 40 -> 35.
    const createVendorToVendorPayment = jest.fn()
    const resolve = jest.fn(() => ({ createVendorToVendorPayment }))

    const res = createRes()
    await POST(
      vendorReq({ resolve }, { payee_vendor_id: "sel_payee", amount: 5, payment_type: "LOAN" }),
      res
    )

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      message:
        "Vendor-to-vendor payments are not available. Record the payment outside FBM or invoice the other vendor instead.",
      type: "not_allowed",
    })
    expect(resolve).not.toHaveBeenCalled()
    expect(createVendorToVendorPayment).not.toHaveBeenCalled()
  })

  it("still lists the store's payment history", async () => {
    const listVendorPayments = jest.fn(async (filter: Record<string, string>) =>
      filter.payer_vendor_id === "sel_payer"
        ? [
            {
              id: "vp_1",
              payee_vendor_id: "sel_payee",
              amount: "5.0000",
              payment_type: "LOAN",
              invoice_number: null,
              reference_note: null,
              status: "COMPLETED",
              created_at: "2026-11-17T00:00:00.000Z",
            },
          ]
        : []
    )
    const resolve = jest.fn((key: string) => {
      expect(key).toBe(HAWALA_LEDGER_MODULE)
      return { listVendorPayments }
    })

    const res = createRes()
    await GET(vendorReq({ resolve }), res)

    expect(res.statusCode).toBe(200)
    expect(listVendorPayments).toHaveBeenCalledWith({ payer_vendor_id: "sel_payer" })
    expect(listVendorPayments).toHaveBeenCalledWith({ payee_vendor_id: "sel_payer" })
    expect(res.body.sent).toEqual([
      expect.objectContaining({ id: "vp_1", payee_vendor_id: "sel_payee", amount: 5, payment_type: "LOAN" }),
    ])
    expect(res.body.received).toEqual([])
  })
})
