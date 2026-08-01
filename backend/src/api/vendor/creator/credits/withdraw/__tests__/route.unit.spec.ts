import { POST } from "../route"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { CREATOR_CREDITS_FLAG } from "../../../../../../lib/creator-credits"

// api/vendor/** is inside the TS-3 de-`any`'d ratchet; typed doubles, no `any`.
type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

const makeScope = (map: Record<string, unknown>) => ({
  resolve: (key: string) => map[key],
})

type RouteArgs = Parameters<typeof POST>
const invoke = (req: unknown, res: TestRes) =>
  POST(req as RouteArgs[0], res as unknown as RouteArgs[1])

type AccountFilter = { account_type?: string }
const makeHawala = (createTransfer: jest.Mock) => ({
  listLedgerAccounts: jest.fn(async (filter: AccountFilter) =>
    filter.account_type === "RESERVE"
      ? [{ id: "ccr_issuer" }]
      : [{ id: "ccr_creator", available_balance: 500 }]
  ),
  createTransfer,
})

const liveReq = (body: Record<string, unknown>, hawala: unknown) => ({
  auth_context: { actor_id: "sel_1" },
  body,
  scope: makeScope({ [HAWALA_LEDGER_MODULE]: hawala }),
})

describe("vendor creator credits withdraw route", () => {
  afterEach(() => {
    delete process.env[CREATOR_CREDITS_FLAG]
  })

  it("is dark when the flag is off: 404 and no service resolution", async () => {
    const resolve = jest.fn()
    const req = { auth_context: { actor_id: "sel_1" }, body: { credits: 100 }, scope: { resolve } }

    const res = createRes()
    await invoke(req, res)

    expect(res.statusCode).toBe(404)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("flag on: burns ₡ creator → issuer as a pending redemption request", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const createTransfer = jest.fn().mockResolvedValue({ id: "le_burn" })
    const hawala = makeHawala(createTransfer)

    const req = liveReq({ credits: 100 }, hawala)
    const res = createRes()
    await invoke(req, res)

    expect(createTransfer).toHaveBeenCalledTimes(1)
    const arg = createTransfer.mock.calls[0][0] as {
      debit_account_id: string
      credit_account_id: string
      amount: number
      entry_type: string
      reference_type: string
      idempotency_key: string
      metadata: Record<string, unknown>
    }
    expect(arg).toEqual(
      expect.objectContaining({
        debit_account_id: "ccr_creator",
        credit_account_id: "ccr_issuer",
        amount: 100,
        entry_type: "CREDIT_REFUND_BURN",
        reference_type: "MANUAL",
      })
    )
    expect(arg.metadata).toEqual(
      expect.objectContaining({ redemption_request: true, status: "pending_settlement" })
    )
    // Idempotency key is a stable function of the generated request id.
    const body = res.body as { request_id: string; credits: number; status: string }
    expect(arg.idempotency_key).toBe(`credit-withdraw-${body.request_id}`)
    expect(body.request_id).toMatch(/^cwr_/)
    expect(body.credits).toBe(100)
    expect(body.status).toBe("pending")
    expect(res.statusCode).toBe(200)
  })

  it("flag on: 409 when the creator's CCR balance can't cover the burn", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const createTransfer = jest
      .fn()
      .mockRejectedValue(new Error("Insufficient balance in account CCR-000123"))
    const hawala = makeHawala(createTransfer)

    const req = liveReq({ credits: 100000 }, hawala)
    const res = createRes()
    await invoke(req, res)

    expect(res.statusCode).toBe(409)
    expect((res.body as { type?: string }).type).toBe("insufficient_balance")
  })

  it("flag on: 400 for a non-positive amount, before touching the ledger", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const createTransfer = jest.fn()
    const hawala = makeHawala(createTransfer)

    const req = liveReq({ credits: 0 }, hawala)
    const res = createRes()
    await invoke(req, res)

    expect(res.statusCode).toBe(400)
    expect(createTransfer).not.toHaveBeenCalled()
  })
})
