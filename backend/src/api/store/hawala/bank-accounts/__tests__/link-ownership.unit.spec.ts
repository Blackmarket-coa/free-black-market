/**
 * SD-34: the bank-link step must attach a bank account only to the Stripe
 * customer FBM created for the signed-in customer, and only from a Financial
 * Connections account that customer holds. Every refusal is one forbidden()
 * body, and nothing is created on a refusal.
 */
jest.mock("../../../../../modules/hawala-ledger/stripe-ach", () => {
  const actual = jest.requireActual("../../../../../modules/hawala-ledger/stripe-ach")
  return { ...actual, createStripeAchService: jest.fn() }
})

import { POST as LINK } from "../link/route"
import { GET as LIST } from "../route"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"
import { createStripeAchService } from "../../../../../modules/hawala-ledger/stripe-ach"

const FORBIDDEN = { message: "You do not have access to this record.", type: "not_allowed" }

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

const makeHawala = () => ({
  listLedgerAccounts: jest.fn().mockResolvedValue([{ id: "la_wallet" }]),
  createAccount: jest.fn(),
  createBankAccounts: jest.fn().mockImplementation(async (data: any) => ({ id: "ba_1", ...data })),
  listBankAccounts: jest.fn().mockResolvedValue([]),
})

const makeAch = (over: Record<string, any> = {}) => ({
  findCustomerIdFor: jest.fn().mockResolvedValue("cus_mine"),
  financialConnectionsAccountHolder: jest.fn().mockResolvedValue("cus_mine"),
  createBankAccountFromConnection: jest
    .fn()
    .mockResolvedValue({ paymentMethodId: "pm_1", bankName: "Bank", last4: "6789" }),
  ...over,
})

const makeReq = (hawala: any, body: any, actor: string | null = "cust_1") => ({
  auth_context: actor ? { actor_id: actor } : undefined,
  body,
  headers: {},
  scope: {
    resolve: (key: string) => {
      if (key !== HAWALA_LEDGER_MODULE) throw new Error(`unexpected module key ${key}`)
      return hawala
    },
  },
})

describe("POST /store/hawala/bank-accounts/link (SD-34)", () => {
  beforeEach(() => jest.clearAllMocks())

  it("links with the server-derived Stripe customer, ignoring nothing the client could forge", async () => {
    const hawala = makeHawala()
    const ach = makeAch()
    ;(createStripeAchService as jest.Mock).mockReturnValue(ach)
    const res = createRes()

    await LINK(makeReq(hawala, { financial_connections_account_id: "fca_1" }) as any, res)

    expect(res.statusCode).toBe(201)
    expect(ach.findCustomerIdFor).toHaveBeenCalledWith("cust_1")
    expect(ach.financialConnectionsAccountHolder).toHaveBeenCalledWith("fca_1")
    expect(ach.createBankAccountFromConnection).toHaveBeenCalledWith({
      stripeCustomerId: "cus_mine",
      financialConnectionsAccountId: "fca_1",
    })
    expect(hawala.createBankAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "cust_1", stripe_customer_id: "cus_mine" })
    )
  })

  it("accepts an old client that sends its own Stripe customer id when it matches", async () => {
    const hawala = makeHawala()
    ;(createStripeAchService as jest.Mock).mockReturnValue(makeAch())
    const res = createRes()
    await LINK(
      makeReq(hawala, { stripe_customer_id: "cus_mine", financial_connections_account_id: "fca_1" }) as any,
      res
    )
    expect(res.statusCode).toBe(201)
  })

  it.each([
    ["names someone else's Stripe customer", makeAch(), { stripe_customer_id: "cus_victim", financial_connections_account_id: "fca_1" }],
    ["has no FBM-created Stripe customer", makeAch({ findCustomerIdFor: jest.fn().mockResolvedValue(null) }), { financial_connections_account_id: "fca_1" }],
    ["brings an account held by another customer", makeAch({ financialConnectionsAccountHolder: jest.fn().mockResolvedValue("cus_victim") }), { financial_connections_account_id: "fca_1" }],
    ["brings an account not held by a customer", makeAch({ financialConnectionsAccountHolder: jest.fn().mockResolvedValue(null) }), { financial_connections_account_id: "fca_1" }],
  ])("refuses with one forbidden body and creates nothing when the caller %s", async (_label, ach, body) => {
    const hawala = makeHawala()
    ;(createStripeAchService as jest.Mock).mockReturnValue(ach)
    const res = createRes()

    await LINK(makeReq(hawala, body) as any, res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN)
    expect((ach as any).createBankAccountFromConnection).not.toHaveBeenCalled()
    expect(hawala.createBankAccounts).not.toHaveBeenCalled()
    expect(hawala.createAccount).not.toHaveBeenCalled()
  })

  it("answers 401 with no customer and 400 without an account id, before touching Stripe", async () => {
    const ach = makeAch()
    ;(createStripeAchService as jest.Mock).mockReturnValue(ach)

    const anon = createRes()
    await LINK(makeReq(makeHawala(), { financial_connections_account_id: "fca_1" }, null) as any, anon)
    expect(anon.statusCode).toBe(401)

    const bad = createRes()
    await LINK(makeReq(makeHawala(), {}) as any, bad)
    expect(bad.statusCode).toBe(400)

    expect(ach.findCustomerIdFor).not.toHaveBeenCalled()
  })
})

describe("GET /store/hawala/bank-accounts (SD-34)", () => {
  it("filters on the model's owner columns, not a customer_id it does not have", async () => {
    const hawala = makeHawala()
    const res = createRes()
    await LIST(makeReq(hawala, undefined) as any, res)
    expect(res.statusCode).toBe(200)
    expect(hawala.listBankAccounts).toHaveBeenCalledWith({ owner_type: "CUSTOMER", owner_id: "cust_1" })
  })
})
