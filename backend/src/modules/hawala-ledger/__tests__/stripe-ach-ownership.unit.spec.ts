/**
 * SD-34: the two Stripe reads the bank-link route trusts.
 */
import { StripeAchService } from "../stripe-ach"

const make = (stripe: any) => {
  const svc = new StripeAchService({
    stripeSecretKey: "sk_test_unused",
    stripeWebhookSecret: "",
    platformFeePercentage: 0.008,
    platformFeeMax: 5,
  })
  ;(svc as any).stripe = stripe
  return svc
}

describe("StripeAchService ownership reads (SD-34)", () => {
  it("findCustomerIdFor re-checks the metadata on the search result and never creates", async () => {
    const create = jest.fn()
    const svc = make({
      customers: {
        search: jest.fn().mockResolvedValue({
          data: [
            { id: "cus_other", metadata: { medusa_customer_id: "cust_10" } },
            { id: "cus_mine", metadata: { medusa_customer_id: "cust_1" } },
          ],
        }),
        create,
      },
    })
    await expect(svc.findCustomerIdFor("cust_1")).resolves.toBe("cus_mine")
    expect(create).not.toHaveBeenCalled()
  })

  it("findCustomerIdFor returns null when nothing matches exactly", async () => {
    const svc = make({
      customers: { search: jest.fn().mockResolvedValue({ data: [{ id: "cus_x", metadata: { medusa_customer_id: "cust_10" } }] }) },
    })
    await expect(svc.findCustomerIdFor("cust_1")).resolves.toBeNull()
  })

  it("findCustomerIdFor escapes quotes in the search query", async () => {
    const search = jest.fn().mockResolvedValue({ data: [] })
    const svc = make({ customers: { search } })
    await svc.findCustomerIdFor("a'b")
    expect(search).toHaveBeenCalledWith({ query: "metadata['medusa_customer_id']:'a\\'b'" })
  })

  it.each([
    [{ account_holder: { type: "customer", customer: "cus_mine" } }, "cus_mine"],
    [{ account_holder: { type: "customer", customer: { id: "cus_mine" } } }, "cus_mine"],
    [{ account_holder: { type: "account", account: "acct_1" } }, null],
    [{ account_holder: null }, null],
  ])("financialConnectionsAccountHolder(%j) -> %s", async (account, expected) => {
    const svc = make({ financialConnections: { accounts: { retrieve: jest.fn().mockResolvedValue(account) } } })
    await expect(svc.financialConnectionsAccountHolder("fca_1")).resolves.toBe(expected)
  })
})
