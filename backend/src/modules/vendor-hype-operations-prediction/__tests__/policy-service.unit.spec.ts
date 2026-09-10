import {
  PredictionPolicyService,
  jurisdictionLookupChain,
  UNMAPPED_JURISDICTION_ALLOWED_MODES,
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
      blockedModesByJurisdiction: {
        "US-NV": [],
      },
    })
    expect(licensed.evaluateMode(PredictionMode.REGULATED_CASH, "US-NV").allowed).toBe(true)
    // Its neighbour still inherits the country-level block.
    expect(licensed.evaluateMode(PredictionMode.REGULATED_CASH, "US-CA").allowed).toBe(false)
  })
})

describe("position limit", () => {
  it("defaults to the matrix's max_positions_per_market_per_user of 1", () => {
    expect(MAX_POSITIONS_PER_MARKET_PER_USER).toBe(1)
  })
})
