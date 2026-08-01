import { POST } from "../route"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { PROGRESSION_MODULE } from "../../../../../../modules/progression"
import { InsufficientXpError } from "../../../../../../modules/progression/service"
import { CREATOR_CREDITS_FLAG } from "../../../../../../lib/creator-credits"

// api/vendor/** is inside the TS-3 de-`any`'d ratchet; test doubles are typed
// with `unknown` + narrow local shapes (the resolve-escrow precedent), no `any`.
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

// requireSellerId resolves PG_CONNECTION + AUTH; an unmapped key returns
// undefined (never throws) so a "sel_"-prefixed actor short-circuits to itself.
const makeScope = (map: Record<string, unknown>) => ({
  resolve: (key: string) => map[key],
})

type RouteArgs = Parameters<typeof POST>
const invoke = (req: unknown, res: TestRes) =>
  POST(req as RouteArgs[0], res as unknown as RouteArgs[1])

const ownerQuery = () => ({
  graph: jest.fn().mockResolvedValue({
    data: [{ id: "sel_1", members: [{ id: "cus_owner", role: "owner" }] }],
  }),
})

type AccountFilter = { account_type?: string }
const makeHawala = (
  overrides: Partial<{
    createTransfer: jest.Mock
    listLedgerEntries: jest.Mock
  }> = {}
) => ({
  listLedgerAccounts: jest.fn(async (filter: AccountFilter) =>
    filter.account_type === "RESERVE"
      ? [{ id: "ccr_issuer" }]
      : [{ id: "ccr_creator", available_balance: 50, pending_balance: 0 }]
  ),
  createTransfer: jest.fn().mockResolvedValue({ id: "le_mint" }),
  listLedgerEntries: jest.fn().mockResolvedValue([]),
  ...overrides,
})

const makeProgression = (
  overrides: Partial<{
    getSpendableXp: jest.Mock
    beginXpConversion: jest.Mock
    completeRedemption: jest.Mock
    refundRedemption: jest.Mock
  }> = {}
) => ({
  getSpendableXp: jest.fn().mockResolvedValue(2500),
  beginXpConversion: jest.fn().mockResolvedValue({ redemption: { id: "xr_1" } }),
  completeRedemption: jest.fn().mockResolvedValue(undefined),
  refundRedemption: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

const liveReq = (
  body: Record<string, unknown>,
  scopeMap: Record<string, unknown>
) => ({
  auth_context: { actor_id: "sel_1" },
  body,
  scope: makeScope(scopeMap),
})

describe("vendor creator credits convert-xp route", () => {
  afterEach(() => {
    delete process.env[CREATOR_CREDITS_FLAG]
  })

  it("is dark when the flag is off: 404 and no service resolution", async () => {
    const resolve = jest.fn()
    const req = { auth_context: { actor_id: "sel_1" }, body: {}, scope: { resolve } }

    const res = createRes()
    await invoke(req, res)

    expect(res.statusCode).toBe(404)
    expect((res.body as { type?: string }).type).toBe("not_found")
    expect(resolve).not.toHaveBeenCalled()
  })

  it("flag on: converts the max whole-block default and mints ₡ from the issuer", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const hawala = makeHawala()
    const progression = makeProgression()

    const req = liveReq(
      {},
      {
        [ContainerRegistrationKeys.QUERY]: ownerQuery(),
        [PROGRESSION_MODULE]: progression,
        [HAWALA_LEDGER_MODULE]: hawala,
      }
    )

    const res = createRes()
    await invoke(req, res)

    // 2500 spendable → 2 whole blocks → 2000 XP debited, 100₡ minted.
    expect(progression.beginXpConversion).toHaveBeenCalledWith("cus_owner", 2000)
    expect(hawala.createTransfer).toHaveBeenCalledTimes(1)
    expect(hawala.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        debit_account_id: "ccr_issuer",
        credit_account_id: "ccr_creator",
        amount: 100,
        entry_type: "CREDIT_PAYOUT_MINT",
        idempotency_key: "xp-convert-xr_1",
        reference_type: "MANUAL",
        description: "XP conversion",
      })
    )
    expect(progression.completeRedemption).toHaveBeenCalledWith("xr_1")
    expect(progression.refundRedemption).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ converted_xp: 2000, credits: 100, balance: 50 })
  })

  it("flag on: honors an explicit whole-block xp amount", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const hawala = makeHawala()
    const progression = makeProgression()

    const req = liveReq(
      { xp: 1000 },
      {
        [ContainerRegistrationKeys.QUERY]: ownerQuery(),
        [PROGRESSION_MODULE]: progression,
        [HAWALA_LEDGER_MODULE]: hawala,
      }
    )

    const res = createRes()
    await invoke(req, res)

    expect(progression.beginXpConversion).toHaveBeenCalledWith("cus_owner", 1000)
    expect(hawala.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50 })
    )
    expect(res.body).toEqual({ converted_xp: 1000, credits: 50, balance: 50 })
  })

  it("flag on: refunds the XP debit and 402s when the ledger mint fails", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const hawala = makeHawala({
      createTransfer: jest.fn().mockRejectedValue(new Error("issuer unfunded")),
    })
    const progression = makeProgression()

    const req = liveReq(
      { xp: 1000 },
      {
        [ContainerRegistrationKeys.QUERY]: ownerQuery(),
        [PROGRESSION_MODULE]: progression,
        [HAWALA_LEDGER_MODULE]: hawala,
      }
    )

    const res = createRes()
    await invoke(req, res)

    expect(progression.refundRedemption).toHaveBeenCalledWith("xr_1")
    expect(progression.completeRedemption).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(402)
    expect((res.body as { type?: string }).type).toBe("conversion_failed")
  })

  it("flag on: 409 when spendable XP can't cover the requested conversion", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const hawala = makeHawala()
    const progression = makeProgression({
      beginXpConversion: jest
        .fn()
        .mockRejectedValue(new InsufficientXpError(5000, 500)),
    })

    const req = liveReq(
      { xp: 5000 },
      {
        [ContainerRegistrationKeys.QUERY]: ownerQuery(),
        [PROGRESSION_MODULE]: progression,
        [HAWALA_LEDGER_MODULE]: hawala,
      }
    )

    const res = createRes()
    await invoke(req, res)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual(
      expect.objectContaining({ type: "insufficient_xp", required: 5000, available: 500 })
    )
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })

  it("flag on: 400 when the balance can't cover a single whole block", async () => {
    process.env[CREATOR_CREDITS_FLAG] = "1"
    const hawala = makeHawala()
    const progression = makeProgression({
      getSpendableXp: jest.fn().mockResolvedValue(500),
    })

    const req = liveReq(
      {},
      {
        [ContainerRegistrationKeys.QUERY]: ownerQuery(),
        [PROGRESSION_MODULE]: progression,
        [HAWALA_LEDGER_MODULE]: hawala,
      }
    )

    const res = createRes()
    await invoke(req, res)

    expect(res.statusCode).toBe(400)
    expect(progression.beginXpConversion).not.toHaveBeenCalled()
  })
})
