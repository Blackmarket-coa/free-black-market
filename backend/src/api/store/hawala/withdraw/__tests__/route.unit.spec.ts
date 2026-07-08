import { POST } from "../route"

// Keep the real env-driven `isAchPayoutConfigured`, but stub the Stripe
// service factory so no real Stripe client / network is constructed.
jest.mock("../../../../../modules/hawala-ledger/stripe-ach", () => {
  const actual = jest.requireActual("../../../../../modules/hawala-ledger/stripe-ach")
  return { ...actual, createStripeAchService: jest.fn() }
})

import { createStripeAchService } from "../../../../../modules/hawala-ledger/stripe-ach"

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

const verifiedBankAccount = {
  id: "ba_1",
  owner_id: "cust_1",
  verification_status: "VERIFIED",
  ledger_account_id: "la_1",
  stripe_bank_account_id: "ba_stripe_1",
}

const makeService = (overrides: Record<string, any> = {}) => ({
  retrieveBankAccount: jest.fn().mockResolvedValue(verifiedBankAccount),
  getAccountBalance: jest.fn().mockResolvedValue({ available_balance: 100 }),
  createAchTransactions: jest.fn().mockResolvedValue({ id: "ach_1" }),
  updateAchTransactions: jest.fn().mockResolvedValue({ id: "ach_1", status: "PROCESSING" }),
  recordWithdrawal: jest.fn().mockResolvedValue({ id: "entry_1" }),
  ...overrides,
})

const makeReq = (service: any) => ({
  auth_context: { actor_id: "cust_1" },
  body: { bank_account_id: "ba_1", amount: 50 },
  headers: {},
  scope: { resolve: () => service },
})

describe("store hawala withdraw route", () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...OLD_ENV }
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.ACH_PAYOUTS_ENABLED
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  const enablePayouts = () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy"
    process.env.ACH_PAYOUTS_ENABLED = "true"
  }

  it("fails closed with 503 and debits nothing when payouts are not configured", async () => {
    const service = makeService()
    const res = createRes()

    await POST(makeReq(service) as any, res as any)

    expect(res.statusCode).toBe(503)
    // No money moved: neither the ACH record nor the ledger debit ran.
    expect(service.createAchTransactions).not.toHaveBeenCalled()
    expect(service.recordWithdrawal).not.toHaveBeenCalled()
  })

  it("returns 502 and does NOT debit the ledger when the payout fails", async () => {
    enablePayouts()
    const service = makeService()
    ;(createStripeAchService as jest.Mock).mockReturnValue({
      createAchPayout: jest.fn().mockRejectedValue(new Error("stripe down")),
    })

    const res = createRes()
    await POST(makeReq(service) as any, res as any)

    expect(res.statusCode).toBe(502)
    expect(service.recordWithdrawal).not.toHaveBeenCalled()
    expect(service.updateAchTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ach_1", status: "FAILED" })
    )
  })

  it("executes the payout before debiting the ledger on success", async () => {
    enablePayouts()
    const service = makeService()
    const order: string[] = []
    const createAchPayout = jest.fn().mockImplementation(async () => {
      order.push("payout")
      return { payoutId: "po_1", status: "pending", arrivalDate: new Date(0) }
    })
    service.recordWithdrawal.mockImplementation(async () => {
      order.push("debit")
      return { id: "entry_1" }
    })
    ;(createStripeAchService as jest.Mock).mockReturnValue({ createAchPayout })

    const res = createRes()
    await POST(makeReq(service) as any, res as any)

    expect(res.statusCode).toBe(201)
    expect(order).toEqual(["payout", "debit"])
    // Ledger debit references the REAL Stripe payout id, not the internal txn id.
    expect(service.recordWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_transfer_id: "po_1", debit_account_id: "la_1" })
    )
    expect(res.body.payout_id).toBe("po_1")
  })

  it("returns 400 and debits nothing when the bank account has no payout destination", async () => {
    enablePayouts()
    const service = makeService({
      retrieveBankAccount: jest
        .fn()
        .mockResolvedValue({ ...verifiedBankAccount, stripe_bank_account_id: null }),
    })
    const createAchPayout = jest.fn()
    ;(createStripeAchService as jest.Mock).mockReturnValue({ createAchPayout })

    const res = createRes()
    await POST(makeReq(service) as any, res as any)

    expect(res.statusCode).toBe(400)
    expect(createAchPayout).not.toHaveBeenCalled()
    expect(service.recordWithdrawal).not.toHaveBeenCalled()
  })

  it("returns 400 and never pays out on insufficient balance", async () => {
    enablePayouts()
    const service = makeService({
      getAccountBalance: jest.fn().mockResolvedValue({ available_balance: 5 }),
    })
    const createAchPayout = jest.fn()
    ;(createStripeAchService as jest.Mock).mockReturnValue({ createAchPayout })

    const res = createRes()
    await POST(makeReq(service) as any, res as any)

    expect(res.statusCode).toBe(400)
    expect(createAchPayout).not.toHaveBeenCalled()
    expect(service.recordWithdrawal).not.toHaveBeenCalled()
  })
})
