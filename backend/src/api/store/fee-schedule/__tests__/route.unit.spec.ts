import { GET } from "../route"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import {
  DEFAULT_PLAN_CODE,
  PLATFORM_DEFAULT_FEE_PERCENT,
  getPlanDefinition,
} from "../../../../modules/vendor-plan/catalog"

/**
 * The public commission schedule. The flag decides whether the 0% donation
 * rule is published at all; whether it is published as a plan is never a
 * question — the plan list is read off the catalog and the rule is a separate
 * field, so these pin both halves.
 */

const ENV = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const POOLS_ENV = PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1
const ALL_ACCESS_ENV = PHASE0_FEATURE_FLAGS.ALL_ACCESS_PLAN_V1

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
  delete process.env[ALL_ACCESS_ENV]
})

/** A plan row exactly as the pre-F8 route built it from the catalog. */
const planRow = (code: string) => {
  const p = getPlanDefinition(code)!
  return {
    code: p.code,
    display_name: p.display_name,
    description: p.description,
    price_amount: p.price_amount,
    currency_code: p.currency_code,
    interval: p.interval,
    platform_fee_percent: p.platform_fee_percent,
    is_default: p.code === DEFAULT_PLAN_CODE,
  }
}

/** The flag-on row: the pre-F8 fields plus `trial_days`. */
const planRowFlagOn = (code: string) => ({
  ...planRow(code),
  trial_days: getPlanDefinition(code)!.trial_days,
})

describe("GET /store/fee-schedule", () => {
  it("publishes the catalog's self-serve plans and the platform default", async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body.default_plan_code).toBe(DEFAULT_PLAN_CODE)
    expect(res.body.default_fee_percent).toBe(PLATFORM_DEFAULT_FEE_PERCENT)
    // Flag off: the pre-F8 ladder, in the pre-F8 order. all_access is defined
    // in the catalog but not offered, so it is not published.
    expect(res.body.plans.map((p) => p.code)).toEqual([
      "free",
      "starter",
      "pro",
      "scale",
    ])
  })

  it("pins the whole flag-off response: today's ladder, values, order and keys, nothing added", async () => {
    // Byte-identical to the pre-F8 response: every field pinned to its literal
    // value, and the key set pinned too, so an added field (e.g. trial_days,
    // published only with the flag on) fails here.
    const res = await call()
    expect(res.body).toEqual({
      default_plan_code: "free",
      default_fee_percent: 3,
      plans: [
        { ...planRow("free"), price_amount: 0, interval: "none", platform_fee_percent: 3, is_default: true },
        { ...planRow("starter"), price_amount: 2900, interval: "month", platform_fee_percent: 2.5, is_default: false },
        { ...planRow("pro"), price_amount: 9900, interval: "month", platform_fee_percent: 2, is_default: false },
        { ...planRow("scale"), price_amount: 24900, interval: "month", platform_fee_percent: 1.5, is_default: false },
      ],
    })
    // And the literal values above are what the catalog says, so the pin is
    // on the response, not on a copy of itself.
    expect(res.body.plans).toEqual(["free", "starter", "pro", "scale"].map(planRow))
    for (const p of res.body.plans as unknown as Record<string, unknown>[]) {
      expect(Object.keys(p).sort()).toEqual([
        "code",
        "currency_code",
        "description",
        "display_name",
        "interval",
        "is_default",
        "platform_fee_percent",
        "price_amount",
      ])
    }
    expect(JSON.stringify(res.body)).not.toContain("trial_days")
  })

  it("publishes free 3% and all_access 0% — and no retired tier — with FF_ALL_ACCESS_PLAN_V1 on", async () => {
    process.env[ALL_ACCESS_ENV] = "true"
    const res = await call()
    expect(res.body.plans.map((p) => p.code)).toEqual(["free", "all_access"])
    expect(res.body.plans).toEqual([planRowFlagOn("free"), planRowFlagOn("all_access")])
    expect(res.body.plans[1]).toMatchObject({
      price_amount: 1000,
      interval: "month",
      platform_fee_percent: 0,
      trial_days: 30,
      is_default: false,
    })
    // The free default is untouched.
    expect(res.body.default_fee_percent).toBe(3)
    expect(res.body.default_plan_code).toBe("free")
  })

  it("keeps the all_access plan off the page for anything but the literal string true", async () => {
    for (const value of ["1", "TRUE", "yes"]) {
      process.env[ALL_ACCESS_ENV] = value
      const res = await call()
      expect(res.body.plans.map((p) => p.code)).toEqual([
        "free",
        "starter",
        "pro",
        "scale",
      ])
    }
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

  it("never lets the donation rule appear as a plan, flag on or off", async () => {
    // With FF_ALL_ACCESS_PLAN_V1 off. The all_access 0% plan (a priced plan,
    // published only under its own flag) is covered above.
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
