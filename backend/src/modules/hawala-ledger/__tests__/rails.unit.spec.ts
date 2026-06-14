/**
 * Rail registry tests.
 *
 * The registry is the single source of truth for what rails exist and
 * what's allowed on each. These tests assert the structural facts the
 * rest of the module depends on: every rail has a coherent set of
 * properties, the asset-graph manifest enum and the ledger rail codes
 * round-trip, and the convenience sets (CASH_RAILS, CLOSED_LOOP_RAILS)
 * match the per-rail flags.
 *
 * The drift this protects against: a rail gets added to one
 * place (e.g. a new currency code in the ledger) without the
 * registry knowing, leaving guards and selectors blind to it.
 */

import {
  RAIL_REGISTRY,
  RAIL_CODES,
  CASH_RAILS,
  CLOSED_LOOP_RAILS,
  RAIL_CODE_BY_MANIFEST_RAIL,
  getRail,
  type ManifestRail,
} from "../rails"

describe("rail registry shape", () => {
  it("covers all six rails", () => {
    expect(RAIL_CODES).toEqual(
      expect.arrayContaining(["CCR", "USDC", "USD", "KARMA", "HRS", "GIFT"])
    )
    expect(RAIL_CODES).toHaveLength(6)
  })

  it("each rail's code field matches its registry key", () => {
    for (const code of RAIL_CODES) {
      expect(RAIL_REGISTRY[code].code).toBe(code)
    }
  })

  it("each rail has a non-empty display_name and unit", () => {
    for (const code of RAIL_CODES) {
      expect(RAIL_REGISTRY[code].display_name.length).toBeGreaterThan(0)
      expect(RAIL_REGISTRY[code].unit.length).toBeGreaterThan(0)
    }
  })
})

describe("rail invariants", () => {
  it("only USD and USDC are cash-convertible", () => {
    expect([...CASH_RAILS].sort()).toEqual(["USD", "USDC"])
  })

  it("closed-loop rails are the non-cash ones (CCR, KARMA, HRS, GIFT)", () => {
    expect([...CLOSED_LOOP_RAILS].sort()).toEqual([
      "CCR",
      "GIFT",
      "HRS",
      "KARMA",
    ])
  })

  it("no rail is both cash-convertible and closed-loop", () => {
    for (const code of RAIL_CODES) {
      const def = RAIL_REGISTRY[code]
      expect(def.cash_convertible && def.closed_loop).toBe(false)
    }
  })

  it("only CCR requires a purchase context (Posture A is CCR-specific)", () => {
    const purchaseRails = RAIL_CODES.filter(
      (c) => RAIL_REGISTRY[c].requires_purchase_context
    )
    expect(purchaseRails).toEqual(["CCR"])
  })

  it("KARMA is the only non-user-to-user rail (it accrues, doesn't transfer)", () => {
    const nonTransferable = RAIL_CODES.filter(
      (c) => !RAIL_REGISTRY[c].user_to_user_transferable
    )
    expect(nonTransferable).toEqual(["KARMA"])
  })

  it("KARMA and GIFT have no ledger account_type (they don't carry balances)", () => {
    expect(RAIL_REGISTRY.KARMA.account_type).toBeNull()
    expect(RAIL_REGISTRY.GIFT.account_type).toBeNull()
  })

  it("HRS account_type is TIME_BANK", () => {
    expect(RAIL_REGISTRY.HRS.account_type).toBe("TIME_BANK")
  })

  it("HRS and CCR are closed-loop and user-to-user transferable (the two interesting closed-loop rails)", () => {
    expect(RAIL_REGISTRY.HRS.closed_loop).toBe(true)
    expect(RAIL_REGISTRY.HRS.user_to_user_transferable).toBe(true)
    expect(RAIL_REGISTRY.CCR.closed_loop).toBe(true)
    expect(RAIL_REGISTRY.CCR.user_to_user_transferable).toBe(true)
  })
})

describe("manifest rail ↔ ledger rail translation", () => {
  it("round-trips between manifest enum and ledger code", () => {
    const manifestRails: ManifestRail[] = [
      "ccr",
      "usdc",
      "usd",
      "karma",
      "hours",
      "gift",
    ]
    for (const m of manifestRails) {
      const code = RAIL_CODE_BY_MANIFEST_RAIL(m)
      expect(RAIL_REGISTRY[code].manifest_code).toBe(m)
    }
  })

  it("every registry rail has a unique manifest_code", () => {
    const seen = new Set<string>()
    for (const code of RAIL_CODES) {
      const m = RAIL_REGISTRY[code].manifest_code
      expect(seen.has(m)).toBe(false)
      seen.add(m)
    }
    expect(seen.size).toBe(RAIL_CODES.length)
  })
})

describe("getRail", () => {
  it("returns the definition for a known code", () => {
    expect(getRail("CCR").code).toBe("CCR")
    expect(getRail("HRS").code).toBe("HRS")
  })

  it("throws on unknown codes", () => {
    expect(() => getRail("BITCOIN")).toThrow(/Unknown settlement rail/)
  })
})
