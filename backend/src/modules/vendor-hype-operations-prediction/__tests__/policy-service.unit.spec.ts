import { MedusaError } from "@medusajs/framework/utils"
import {
  PredictionPolicyService,
  jurisdictionLookupChain,
  UNMAPPED_JURISDICTION_ALLOWED_MODES,
  JURISDICTION_PROFILES,
  MATRIX_EFFECTIVE_DATE,
  MATRIX_POLICY_LABEL,
  MATRIX_POLICY_VERSION,
  PREDICTION_MODE_NOT_PERMITTED,
  PredictionPolicyRefusal,
  canonicalPolicyRules,
  derivePolicyVersion,
  isPredictionPolicyRefusal,
  predictionPolicyDeniedResponse,
  profilesFromEnv,
} from "../policy-service"
import { PredictionMode } from "../models"
import VendorHypeOperationsPredictionService, { MAX_POSITIONS_PER_MARKET_PER_USER } from "../service"

/**
 * The version every decision records under the code defaults alone (no env
 * mapping, no label). Pinned so that a change to the profiles or the default
 * mapping shows up here, next to the matrix version it should come with.
 */
const DEFAULT_POLICY_VERSION = "matrix-1.0.0@2026-01-01+map:c78f8f076443"

const POLICY_ENV = ["VENDOR_HYPE_JURISDICTION_PROFILES", "VENDOR_HYPE_POLICY_VERSION"] as const

/** Run `fn` with exactly these policy env vars set, restoring the rest after. */
const withPolicyEnv = <T>(env: Partial<Record<(typeof POLICY_ENV)[number], string>>, fn: () => T): T => {
  const saved = POLICY_ENV.map((key) => [key, process.env[key]] as const)
  for (const key of POLICY_ENV) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

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
    expect(policy.evaluateMode(PredictionMode.NON_CASH, "US").policy_version.startsWith(
      `matrix-${MATRIX_POLICY_VERSION}@${MATRIX_EFFECTIVE_DATE}+map:`
    )).toBe(true)
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

  it("drops an entry naming an Object.prototype member, which used to pass and then crash every decision", () => {
    expect(
      profilesFromEnv('{"US-NV":"constructor","US-NJ":"toString","US-NY":"hasOwnProperty","US-PA":"__proto__"}')
    ).toEqual({})
    expect(() => new PredictionPolicyService({ jurisdictionProfiles: { "US-NV": "constructor" } })).toThrow(
      /unknown profile/
    )
  })
})

/**
 * SD-76 follow-up. The recorded version was the matrix label alone, or
 * whatever VENDOR_HYPE_POLICY_VERSION said, so it did not identify the rules:
 * a deployment mapping US-NV to US-REGULATED-CASH and one that did not
 * recorded the same string for opposite decisions.
 */
describe("policy_version identifies the rules that decided", () => {
  it("is the matrix label plus a hash of the effective mapping", () => {
    const version = withPolicyEnv({}, () => new PredictionPolicyService().policyVersion)
    expect(version).toBe(DEFAULT_POLICY_VERSION)
    // What the hash is of, so it can be recomputed from the logged mapping
    // (sha256 of this string, first 12 hex characters, is c78f8f076443).
    expect(canonicalPolicyRules({ US: "US-RESTRICTED" })).toBe(
      '{"mapped":[["US","US-RESTRICTED",["non_cash"]]],"unmapped":["ROW-NONCASH",["non_cash"]]}'
    )
    // Compared as a prefix plus a hex suffix, not a regex built from the
    // label, so no character in the label needs escaping.
    const prefix = `${MATRIX_POLICY_LABEL}+map:`
    expect(version.startsWith(prefix)).toBe(true)
    expect(version.slice(prefix.length)).toMatch(/^[0-9a-f]{12}$/)
  })

  it("changes with the mapping, and only with what the mapping says", () => {
    const base = withPolicyEnv({}, () => new PredictionPolicyService().policyVersion)
    const nv = new PredictionPolicyService({ jurisdictionProfiles: { "US-NV": "US-REGULATED-CASH" } })
    expect(nv.policyVersion).not.toBe(base)
    // Same entries, other order: same rules, same version.
    expect(derivePolicyVersion({ US: "US-RESTRICTED", "US-NV": "US-REGULATED-CASH" })).toBe(
      derivePolicyVersion({ "US-NV": "US-REGULATED-CASH", US: "US-RESTRICTED" })
    )
    expect(derivePolicyVersion({ US: "US-RESTRICTED", "US-NV": "US-REGULATED-CASH" })).toBe(nv.policyVersion)
  })

  it("lets VENDOR_HYPE_POLICY_VERSION append a label, never replace the version", () => {
    const labelled = withPolicyEnv({ VENDOR_HYPE_POLICY_VERSION: "counsel-2026-11" }, () => new PredictionPolicyService())
    expect(labelled.policyVersion).toBe(`${DEFAULT_POLICY_VERSION}+label:counsel-2026-11`)
    expect(labelled.evaluateMode(PredictionMode.NON_CASH, "US").policy_version).toBe(labelled.policyVersion)

    // A value that could pass for another part of the version is ignored.
    for (const bad of ["anything goes", "x+map:000000000000", "matrix-9.9.9@2099-01-01"]) {
      const ignored = withPolicyEnv({ VENDOR_HYPE_POLICY_VERSION: bad }, () => new PredictionPolicyService())
      expect(ignored.policyVersion).toBe(DEFAULT_POLICY_VERSION)
    }
  })

  it("says which profile decided and under which code, for replay", () => {
    const policy = withPolicyEnv({}, () => new PredictionPolicyService())
    expect(policy.evaluateMode(PredictionMode.SWEEPSTAKES, "us-ca")).toEqual({
      allowed: false,
      reason: "sweepstakes markets are not permitted for US (profile US-RESTRICTED)",
      policy_version: DEFAULT_POLICY_VERSION,
      mode: PredictionMode.SWEEPSTAKES,
      jurisdiction_code: "US-CA",
      matched: "US",
      profile: "US-RESTRICTED",
      allowed_modes: [PredictionMode.NON_CASH],
    })
    expect(policy.evaluateMode(PredictionMode.NON_CASH, "ZZ")).toEqual(
      expect.objectContaining({ allowed: true, matched: null, profile: "ROW-NONCASH", jurisdiction_code: "ZZ" })
    )
  })

  it("logs the effective mapping and the version when it is built", () => {
    const lines: string[] = []
    const spy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      jest.isolateModules(() => {
        const saved = process.env.LOG_LEVEL
        process.env.LOG_LEVEL = "info"
        try {
          const isolated = require("../policy-service") as typeof import("../policy-service")
          const built = withPolicyEnv(
            { VENDOR_HYPE_JURISDICTION_PROFILES: '{"US-NV":"US-REGULATED-CASH"}' },
            () => new isolated.PredictionPolicyService()
          )
          const line = lines.find((l) => l.includes("Prediction policy in force"))
          expect(line).toBeDefined()
          expect(line).toContain(built.policyVersion)
          expect(line).toContain('"US-NV":"US-REGULATED-CASH"')
          expect(line).toContain('"US":"US-RESTRICTED"')
        } finally {
          if (saved === undefined) delete process.env.LOG_LEVEL
          else process.env.LOG_LEVEL = saved
        }
      })
    } finally {
      spy.mockRestore()
    }
  })
})

/**
 * The operator's mapping has to reach the service the module actually uses,
 * not just profilesFromEnv. Dropping the env read from the constructor, or
 * letting the code default win over it, used to fail no test.
 */
describe("VENDOR_HYPE_JURISDICTION_PROFILES reaches the module service", () => {
  const isolatedService = (env: Partial<Record<(typeof POLICY_ENV)[number], string>>) => {
    let service: VendorHypeOperationsPredictionService | undefined
    withPolicyEnv(env, () => {
      jest.isolateModules(() => {
        const Service = (require("../service") as typeof import("../service")).default
        // The real module service, built as the container builds it (its
        // constructor reads only optional container keys), so the policy it
        // holds is the one its field initialiser makes from the env.
        service = new Service({} as never)
      })
    })
    if (!service) throw new Error("service was not built")
    return service
  }

  it("admits regulated cash in US-NV under a mapping, and still not in US-CA", () => {
    const service = isolatedService({ VENDOR_HYPE_JURISDICTION_PROFILES: '{"US-NV":"US-REGULATED-CASH"}' })
    const nv = service.getPolicyDecision(PredictionMode.REGULATED_CASH, "US-NV")
    expect(nv).toEqual(expect.objectContaining({ allowed: true, matched: "US-NV", profile: "US-REGULATED-CASH" }))
    expect(service.getPolicyDecision(PredictionMode.REGULATED_CASH, "US-CA").allowed).toBe(false)
    // A cash-licensed state still gets no sweepstakes.
    expect(service.getPolicyDecision(PredictionMode.SWEEPSTAKES, "US-NV").allowed).toBe(false)
    expect(nv.policy_version).not.toBe(DEFAULT_POLICY_VERSION)
  })

  it("refuses regulated cash in US-NV without one", () => {
    const service = isolatedService({})
    const nv = service.getPolicyDecision(PredictionMode.REGULATED_CASH, "US-NV")
    expect(nv).toEqual(expect.objectContaining({ allowed: false, matched: "US", profile: "US-RESTRICTED" }))
    expect(nv.policy_version).toBe(DEFAULT_POLICY_VERSION)
  })

  it("applies the env mapping over the code defaults, as documented", () => {
    // `US` is mapped by the code default too; the operator's entry wins. (So
    // an env entry for a country changes every subdivision that inherits it,
    // which is why the effective mapping is logged when the policy is built.)
    const service = isolatedService({ VENDOR_HYPE_JURISDICTION_PROFILES: '{"US":"US-SWEEPSTAKES-ELIGIBLE"}' })
    expect(service.getPolicyDecision(PredictionMode.SWEEPSTAKES, "US-CA")).toEqual(
      expect.objectContaining({ allowed: true, matched: "US", profile: "US-SWEEPSTAKES-ELIGIBLE" })
    )
  })
})

describe("a policy refusal is a coded 403, not a 500", () => {
  const refused = withPolicyEnv({}, () =>
    new PredictionPolicyService().evaluateMode(PredictionMode.SWEEPSTAKES, "US-CA")
  )

  it("is a FORBIDDEN MedusaError carrying the code, the reason and the version", () => {
    const error = new PredictionPolicyRefusal(refused)
    expect(MedusaError.isMedusaError(error)).toBe(true)
    expect(error.type).toBe(MedusaError.Types.FORBIDDEN)
    expect(error.code).toBe(PREDICTION_MODE_NOT_PERMITTED)
    expect(error.message).toBe(refused.reason)
    expect(error.policy_version).toBe(refused.policy_version)
    expect(isPredictionPolicyRefusal(error)).toBe(true)
  })

  it("is recognised by its code after serialisation, and nothing else is", () => {
    const serialised = JSON.parse(JSON.stringify({ ...new PredictionPolicyRefusal(refused), message: refused.reason }))
    expect(isPredictionPolicyRefusal(serialised)).toBe(true)
    expect(isPredictionPolicyRefusal(new Error(refused.reason))).toBe(false)
    expect(isPredictionPolicyRefusal(new MedusaError(MedusaError.Types.NOT_ALLOWED, "x"))).toBe(false)
    expect(isPredictionPolicyRefusal(null)).toBe(false)
  })

  it("answers 403 policy_denied with the reason", () => {
    expect(predictionPolicyDeniedResponse(new PredictionPolicyRefusal(refused))).toEqual({
      status: 403,
      body: {
        type: "policy_denied",
        code: PREDICTION_MODE_NOT_PERMITTED,
        message: "sweepstakes markets are not permitted for US (profile US-RESTRICTED)",
        policy_version: refused.policy_version,
      },
    })
  })
})

describe("position limit", () => {
  it("defaults to the matrix's max_positions_per_market_per_user of 1", () => {
    expect(MAX_POSITIONS_PER_MARKET_PER_USER).toBe(1)
  })
})
