import { POST } from "../markets/[id]/positions/route"
import {
  PredictionMode,
  VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE,
} from "../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../modules/vendor-hype-operations-prediction/service"

/**
 * POST /store/vendor-hype/markets/:id/positions.
 *
 * This spec used to sit next to the route as `route.unit.spec.ts`, where the
 * unit job's testMatch (`src/**\/__tests__/**\/*.unit.spec.ts`) never picked it
 * up, so it had not run in CI. Its first case also asserted the defect: it
 * proved a 403 when the *body* said `age_verified: false`, i.e. that the
 * caller's own claim decided eligibility.
 */
type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res: TestRes = {
    statusCode: 200,
    body: {},
    status: (code: number) => {
      res.statusCode = code
      return res
    },
    json: (payload: unknown) => {
      res.body = (payload ?? {}) as Record<string, unknown>
      return res
    },
  }
  return res
}

// Resolve only the real registration key: a mock that answers any key would
// let a route resolving the wrong one pass.
const scopeWith = (service: Record<string, unknown>) => ({
  resolve: (key: string) => {
    if (key !== VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE) {
      throw new Error(`unexpected container key ${key}`)
    }
    return service
  },
})

const makeReq = (opts: {
  body?: Record<string, unknown>
  headers?: Record<string, string>
  actorType?: string
  service: Record<string, unknown>
}) => ({
  params: { id: "m_1" },
  body: { outcome_option_key: "YES", stake_amount: 10, disclosure_acknowledged: true, ...opts.body },
  headers: opts.headers ?? {},
  auth_context: { actor_id: "cust_1", actor_type: opts.actorType ?? "customer" },
  scope: scopeWith(opts.service),
})

describe("store vendor hype market positions route", () => {
  it("refuses a caller whose body claims age_verified and not self_excluded (no server-side age record exists)", async () => {
    const placePredictionPosition = jest.fn()
    const service = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", mode: PredictionMode.NON_CASH }]),
      // The real implementation, not a stub: the fail-closed default is the
      // thing under test.
      isSupporterAgeVerified: VendorHypeOperationsPredictionService.prototype.isSupporterAgeVerified,
      placePredictionPosition,
    }
    const res = createRes()

    await POST(
      makeReq({
        body: { age_verified: true, self_excluded: false, idempotency_key: "idem_1" },
        service,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe("PREDICTION_AGE_VERIFICATION_REQUIRED")
    expect(placePredictionPosition).not.toHaveBeenCalled()
  })

  it("asks the server for the supporter's age verification at the market's mode", async () => {
    const isSupporterAgeVerified = jest.fn().mockResolvedValue(false)
    const service = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", mode: PredictionMode.REGULATED_CASH }]),
      isSupporterAgeVerified,
      placePredictionPosition: jest.fn(),
    }
    const res = createRes()

    await POST(makeReq({ body: { idempotency_key: "idem_1" }, service }) as never, res as never)

    expect(isSupporterAgeVerified).toHaveBeenCalledWith("cust_1", PredictionMode.REGULATED_CASH)
    expect(res.statusCode).toBe(403)
  })

  it("refuses a non-customer actor", async () => {
    const placePredictionPosition = jest.fn()
    const res = createRes()

    await POST(
      makeReq({ actorType: "seller", service: { placePredictionPosition } }) as never,
      res as never
    )

    expect(res.statusCode).toBe(403)
    expect(placePredictionPosition).not.toHaveBeenCalled()
  })

  it("returns 400 if idempotency key is missing", async () => {
    const service = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", mode: PredictionMode.SWEEPSTAKES }]),
      isSupporterAgeVerified: jest.fn().mockResolvedValue(true),
      placePredictionPosition: jest.fn(),
    }
    const res = createRes()

    await POST(makeReq({ service }) as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(String(res.body.error)).toContain("idempotency_key")
  })

  it("places the position once the server holds an age verification, without recording the client's claims", async () => {
    const placePredictionPosition = jest.fn().mockResolvedValue({ id: "pos_1" })
    const service = {
      listPredictionMarkets: jest.fn().mockResolvedValue([{ id: "m_1", mode: PredictionMode.NON_CASH }]),
      isSupporterAgeVerified: jest.fn().mockResolvedValue(true),
      placePredictionPosition,
    }
    const res = createRes()

    await POST(
      makeReq({
        body: { age_verified: true, self_excluded: false },
        headers: { "idempotency-key": "idem_hdr" },
        service,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(201)
    expect(placePredictionPosition).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: "idem_hdr", supporter_id: "cust_1" })
    )
    const metadata = placePredictionPosition.mock.calls[0][0].metadata as Record<string, unknown>
    expect(metadata).not.toHaveProperty("age_verified")
    expect(metadata).not.toHaveProperty("self_excluded")
  })
})
