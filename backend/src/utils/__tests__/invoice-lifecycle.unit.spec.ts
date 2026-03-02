import { isAllowedInvoiceTransition } from "../../api/vendor/invoices/route"

describe("invoice lifecycle transitions", () => {
  it("allows draft -> sent", () => {
    expect(isAllowedInvoiceTransition("draft", "sent")).toBe(true)
  })

  it("blocks paid -> sent", () => {
    expect(isAllowedInvoiceTransition("paid", "sent")).toBe(false)
  })
})
