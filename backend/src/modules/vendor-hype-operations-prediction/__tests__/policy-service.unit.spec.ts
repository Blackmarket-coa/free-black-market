import {
  PredictionPolicyService,
  jurisdictionLookupChain,
  UNMAPPED_JURISDICTION_ALLOWED_MODES,
  JURISDICTION_PROFILES,
  MATRIX_EFFECTIVE_DATE,
  MATRIX_POLICY_VERSION,
  profilesFromEnv,
} from "../policy-service"
import { PredictionMode } from "../models"
import { MAX_POSITIONS_PER_MARKET_PER_USER } from "../service"

/**
 * The compliance matrix states the rule this service exists to keep: "if
 * jurisdiction mapping is unknown or stale, default to **Non-Cash only** and
 * block prize/cash pathways until legal/compliance sign-off."
 *
 * The original implementation looked the jurisdiction up by exact key and read
 * a miss as permission, so `US-CA` — and the matrix's own `US-RESTRICTED` —
 * allowed regulated-cash markets. See docs/TRANSMUTATION_STRATEGY.md §5.6.
 */
describe("jurisdictionLookupChain", () => {
  it("broadens a subdivision toward its country", () => {
    expect(jurisdictionLookupChain("US-CA")).toEqual(["US-CA", "US"])
    expect(jurisdictionLookupChain("us-ca")).toEqual(["US-CA", "US"])
  })

  it("returns the country alone when there is no subdivision", () => {
    expect(jurisdictionLookupChain(" us ")).toEqual(["US"])
  })

  it("returns nothing for an absent code", () => {
    expect(jurisdictionLookupChain("")).toEqual([])
    expect(jurisdictionLookupChain("   ")).toEqual([])
  })
})

describe("PredictionPolicyService.evaluateMode", () => {
  const policy = new PredictionPolicyService()

  it("blocks regulated cash in the US, as before", () => {
    const decision = policy.evaluateMode(PredictionMode.REGULATED_CASH, "US")
    expect(decision.allowed).toBe(false)
  })

  it("blocks regulated cash for a US subdivision through its parent", () => {
    const decision = policy.evaluateMode(PredictionMode.REGULATED_CASH, "US-CA")
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain("US")
  })

  it("still allows non-cash in the US and its subdivisions", () => {
    expect(policy.evaluateMode(PredictionMode.NON_CASH, "US").allowed).toBe(true)
    expect(policy.evaluateMode(PredictionMode.NON_CASH, "US-CA").allowed).toBe(true)
  })

  it("allows only non-cash where no jurisdiction is mapped", () => {
    for (const mode of Object.values(PredictionMode)) {
      const decision = policy.evaluateMode(mode, "ZZ")
      expect(decision.allowed).toBe(
        UNMAPPED_JURISDICTION_ALLOWED_MODES.includes(mode)
      )
    }
  })

  it("allows only non-cash when the jurisdiction is missing entirely", () => {
    expect(policy.evaluateMode(PredictionMode.NON_CASH, "").allowed).toBe(true)
    expect(policy.evaluateMode(PredictionMode.SWEEPSTAKES, "").allowed).toBe(false)
    expect(policy.evaluateMode(PredictionMode.REGULATED_CASH, "").allowed).toBe(false)
  })

  it("lets an exact subdivision mapping override its parent", () => {
    const licensed = new PredictionPolicyService({
      jurisdictionProfiles: { "US-NV": "US-REGULATED-CASH" },
    })
    expect(licensed.evaluateMode(PredictionMode.REGULATED_CASH, "US-NV").allowed).toBe(true)
    // A cash-licensed state still gets no sweepstakes (its profile blocks them).
    expect(licensed.evaluateMode(PredictionMode.SWEEPSTAKES, "US-NV").allowed).toBe(false)
    // Its neighbour still inherits the country-level profile.
    expect(licensed.evaluateMode(PredictionMode.REGULATED_CASH, "US-CA").allowed).toBe(false)
  })
})

describe("allow-list semantics: a mapped jurisdiction permits only its profile's modes", () => {
  const policy = new PredictionPolicyService()

  it.each(["US", "US-CA", "US-NY", "us-tx"])("refuses sweepstakes for %s by default (US-RESTRICTED)", (code) => {
    const decision = policy.evaluateMode(PredictionMode.SWEEPSTAKES, code)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain("US-RESTRICTED")
  })

  it.each([
    ["US-RESTRICTED", PredictionMode.SWEEPSTAKES],
    ["US-REGULATED-CASH", PredictionMode.REGULATED_CASH],
    ["US-SWEEPSTAKES-ELIGIBLE", PredictionMode.SWEEPSTAKES],
    ["EEA-CASH-LICENSED", PredictionMode.REGULATED_CASH],
  ])(
    "does not let a market creator pick a profile by sending its code as the jurisdiction (%s, %s)",
    (code, mode) => {
      // A profile is a class of jurisdictions, and the creator supplies the
      // code. US-* profile codes fall back to US; the EEA one is unmapped.
      expect(policy.evaluateMode(mode, code).allowed).toBe(false)
      expect(policy.evaluateMode(PredictionMode.NON_CASH, code).allowed).toBe(true)
    }
  )

  it("encodes the matrix's six profiles exactly", () => {
    expect(JURISDICTION_PROFILES).toEqual({
      "US-RESTRICTED": [PredictionMode.NON_CASH],
      "US-SWEEPSTAKES-ELIGIBLE": [PredictionMode.NON_CASH, PredictionMode.SWEEPSTAKES],
      "US-REGULATED-CASH": [PredictionMode.NON_CASH, PredictionMode.REGULATED_CASH],
      "EEA-NONCASH": [PredictionMode.NON_CASH],
      "EEA-CASH-LICENSED": [PredictionMode.NON_CASH, PredictionMode.REGULATED_CASH],
      "ROW-NONCASH": [PredictionMode.NON_CASH],
    })
  })

  it("records the matrix's policy version and effective date on every decision", () => {
    expect(policy.evaluateMode(PredictionMode.NON_CASH, "US").policy_version).toBe(
      `matrix-${MATRIX_POLICY_VERSION}@${MATRIX_EFFECTIVE_DATE}`
    )
    expect(MATRIX_POLICY_VERSION).toBe("1.0.0")
    expect(MATRIX_EFFECTIVE_DATE).toBe("2026-01-01")
  })

  it("refuses to be configured with a profile the matrix does not have", () => {
    expect(() => new PredictionPolicyService({ jurisdictionProfiles: { "US-NV": "US-ANYTHING" } })).toThrow(
      /unknown profile/
    )
  })
})

describe("profilesFromEnv: the operator's mapping fails closed", () => {
  it("reads a JSON object of code -> profile, upper-casing codes", () => {
    expect(profilesFromEnv('{"us-nv":"US-REGULATED-CASH","FR":"EEA-NONCASH"}')).toEqual({
      "US-NV": "US-REGULATED-CASH",
      FR: "EEA-NONCASH",
    })
  })

  it("ignores unparseable JSON and non-objects whole", () => {
    expect(profilesFromEnv("{not json")).toEqual({})
    expect(profilesFromEnv('["US-NV"]')).toEqual({})
    expect(profilesFromEnv("")).toEqual({})
    expect(profilesFromEnv(undefined)).toEqual({})
  })

  it("drops an entry with an unknown profile, and one that remaps a profile code", () => {
    expect(
      profilesFromEnv('{"US-NV":"US-CASINO","US-RESTRICTED":"US-REGULATED-CASH","US-NJ":"US-REGULATED-CASH"}')
    ).toEqual({ "US-NJ": "US-REGULATED-CASH" })
  })
})

describe("position limit", () => {
  it("defaults to the matrix's max_positions_per_market_per_user of 1", () => {
    expect(MAX_POSITIONS_PER_MARKET_PER_USER).toBe(1)
  })
})
