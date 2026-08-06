import {
  DEFAULT_SURPLUS_DISPOSITION,
  MUTUAL_AID_ACCOUNT_ENV,
  SURPLUS_REDIRECT_FLAG,
  getMutualAidAccountId,
  isSurplusDisposition,
  isSurplusRedirectLive,
  requireMutualAidAccountId,
  shouldRouteToMutualAid,
} from "../surplus-redirect"

describe("surplus redirect", () => {
  const priorFlag = process.env[SURPLUS_REDIRECT_FLAG]
  const priorAccount = process.env[MUTUAL_AID_ACCOUNT_ENV]

  afterEach(() => {
    if (priorFlag === undefined) delete process.env[SURPLUS_REDIRECT_FLAG]
    else process.env[SURPLUS_REDIRECT_FLAG] = priorFlag
    if (priorAccount === undefined) delete process.env[MUTUAL_AID_ACCOUNT_ENV]
    else process.env[MUTUAL_AID_ACCOUNT_ENV] = priorAccount
  })

  it("defaults to a plain refund", () => {
    // The guardrail in one assertion: redirecting is opt-in, so the value a
    // participant holds until they say otherwise must be REFUND.
    expect(DEFAULT_SURPLUS_DISPOSITION).toBe("REFUND")
  })

  it("recognises only the two dispositions", () => {
    expect(isSurplusDisposition("REFUND")).toBe(true)
    expect(isSurplusDisposition("DONATE")).toBe(true)
    expect(isSurplusDisposition("donate")).toBe(false)
    expect(isSurplusDisposition(undefined)).toBe(false)
  })

  it("is dark unless the flag is exactly 1", () => {
    delete process.env[SURPLUS_REDIRECT_FLAG]
    expect(isSurplusRedirectLive()).toBe(false)

    process.env[SURPLUS_REDIRECT_FLAG] = "true"
    expect(isSurplusRedirectLive()).toBe(false)

    process.env[SURPLUS_REDIRECT_FLAG] = "0"
    expect(isSurplusRedirectLive()).toBe(false)

    process.env[SURPLUS_REDIRECT_FLAG] = "1"
    expect(isSurplusRedirectLive()).toBe(true)
  })

  describe("shouldRouteToMutualAid", () => {
    it("never routes a REFUND disposition, flag or no flag", () => {
      process.env[SURPLUS_REDIRECT_FLAG] = "1"
      expect(shouldRouteToMutualAid("REFUND")).toBe(false)
      expect(shouldRouteToMutualAid(null)).toBe(false)
      expect(shouldRouteToMutualAid(undefined)).toBe(false)
    })

    it("does not route a DONATE intent while the rail is closed", () => {
      delete process.env[SURPLUS_REDIRECT_FLAG]
      // The intent is still recorded elsewhere; it just must not move money.
      // Failing toward "refund the buyer" is the safe direction.
      expect(shouldRouteToMutualAid("DONATE")).toBe(false)
    })

    it("routes only when the buyer opted in AND the rail is open", () => {
      process.env[SURPLUS_REDIRECT_FLAG] = "1"
      expect(shouldRouteToMutualAid("DONATE")).toBe(true)
    })
  })

  describe("destination account", () => {
    it("has no default", () => {
      delete process.env[MUTUAL_AID_ACCOUNT_ENV]
      expect(getMutualAidAccountId()).toBeNull()
    })

    it("treats a blank value as unset", () => {
      process.env[MUTUAL_AID_ACCOUNT_ENV] = "   "
      expect(getMutualAidAccountId()).toBeNull()
    })

    it("refuses to route without a configured destination", () => {
      process.env[SURPLUS_REDIRECT_FLAG] = "1"
      delete process.env[MUTUAL_AID_ACCOUNT_ENV]

      // Paying into a platform-held account instead would be the exact
      // arrangement Posture A exists to avoid, so this must throw rather than
      // fall back to anything.
      expect(() => requireMutualAidAccountId()).toThrow(
        new RegExp(MUTUAL_AID_ACCOUNT_ENV)
      )
    })

    it("returns the configured account when set", () => {
      process.env[MUTUAL_AID_ACCOUNT_ENV] = "acc_mutual_aid"
      expect(requireMutualAidAccountId()).toBe("acc_mutual_aid")
    })
  })
})
