import { POST } from "../pos/checkout/route"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

describe("vendor pos checkout", () => {
  it("captures payment and returns receipt export payload", async () => {
    const req: any = {
      body: {
        payee_vendor_id: "seller_receiver",
        amount: 120,
        payment_method: "manual",
      },
      auth_context: { actor_id: "seller_payer" },
      scope: {
        resolve: () => ({
          createVendorToVendorPayment: async () => ({
            id: "pay_1",
            status: "completed",
            amount: 120,
            invoice_number: null,
            created_at: "2026-01-01T00:00:00.000Z",
          }),
        }),
      },
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(201)
    expect(res.body.payment.id).toBe("pay_1")
    expect(res.body.receipt_export.format).toBe("json")
    expect(res.body.receipt_export.payload.payment_id).toBe("pay_1")
  })
})
