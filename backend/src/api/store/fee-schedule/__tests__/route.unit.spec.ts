import { GET } from "../route"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import {
  DEFAULT_PLAN_CODE,
  PLATFORM_DEFAULT_FEE_PERCENT,
  VENDOR_PLAN_CATALOG,
} from "../../../../modules/vendor-plan/catalog"

/**
 * The public commission schedule. The flag decides whether the 0% donation
 * rule is published at all; whether it is published as a plan is never a
 * question — the plan list is read off the catalog and the rule is a separate
 * field, so these pin both halves.
 */

const ENV = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const POOLS_ENV = PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1

type Body = {
  default_plan_code: string
  default_fee_percent: number
  plans: Array<{ code: string; platform_fee_percent: number }>
  transaction_kinds?: Record<string, number>
}

const createRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown as Body,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload as Body
      return res
    },
  }
  return res
}

const call = async () => {
  const res = createRes()
  await GET({} as never, res as never)
  return res
}

afterEach(() => {
  delete process.env[ENV]
  delete process.env[POOLS_ENV]
})

describe("GET /store/fee-schedule", () => {
  it("publishes the catalog's self-serve plans and the platform default", async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body.default_plan_code).toBe(DEFAULT_PLAN_CODE)
    expect(res.body.default_fee_percent).toBe(PLATFORM_DEFAULT_FEE_PERCENT)
    expect(res.body.plans.map((p) => p.code)).toEqual(
      VENDOR_PLAN_CATALOG.filter((p) => p.platform_fee_percent !== null).map(
        (p) => p.code
      )
    )
  })

  it("has no transaction_kinds field while FF_NONPROFIT_PARITY_V1 is off", async () => {
    // Default-off: a deploy with no env set publishes exactly what it did
    // before the rule existed. Absent, not empty — a client must not have to
    // tell `{}` from "not published".
    const res = await call()
    expect(res.body).not.toHaveProperty("transaction_kinds")
  })

  it("stays off for anything but the literal string true", async () => {
    process.env[ENV] = "1"
    expect((await call()).body).not.toHaveProperty("transaction_kinds")
    process.env[ENV] = "TRUE"
    expect((await call()).body).not.toHaveProperty("transaction_kinds")
  })

  it("publishes exactly donation and donation_pledge at 0 when the flag is on", async () => {
    process.env[ENV] = "true"
    const res = await call()
    expect(res.body.transaction_kinds).toEqual({
      donation: 0,
      donation_pledge: 0,
    })
    // Not `pledge` (collective-campaign and demand-pool pledges keep their
    // fee paths) and not `tip` (tips are handled by the fee base, not a rule).
    expect(res.body.transaction_kinds).not.toHaveProperty("pledge")
    expect(res.body.transaction_kinds).not.toHaveProperty("tip")
    expect(res.body.transaction_kinds).not.toHaveProperty("sale")
    // The carried-pool contribution rule is not advertised while the pool
    // routes themselves are dark (FF_INVESTMENT_POOLS_V1 off; L26).
    expect(res.body.transaction_kinds).not.toHaveProperty("pool_contribution")
  })

  it("publishes pool_contribution at 0 only when FF_INVESTMENT_POOLS_V1 is on as well", async () => {
    process.env[POOLS_ENV] = "true"
    // Pools alone: no transaction_kinds field at all (the parity flag owns it).
    expect((await call()).body).not.toHaveProperty("transaction_kinds")

    process.env[ENV] = "true"
    const res = await call()
    expect(res.body.transaction_kinds).toEqual({
      donation: 0,
      donation_pledge: 0,
      pool_contribution: 0,
    })
  })

  it("never lets the rule appear as a plan, flag on or off", async () => {
    for (const value of [undefined, "true"]) {
      if (value === undefined) delete process.env[ENV]
      else process.env[ENV] = value
      const res = await call()
      expect(res.body.plans.some((p) => p.platform_fee_percent === 0)).toBe(false)
      expect(res.body.plans.some((p) => p.platform_fee_percent === null)).toBe(false)
      // The sale default is untouched by the rule.
      expect(res.body.default_fee_percent).toBe(3)
    }
  })
})
