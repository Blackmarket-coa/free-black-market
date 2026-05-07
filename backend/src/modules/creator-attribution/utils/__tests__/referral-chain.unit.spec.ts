import {
  ABSOLUTE_MAX_LEVELS,
  DEFAULT_LEVEL_SPLITS,
  allocateCommission,
  capLevels,
  parseLevelSplitsEnv,
  walkReferrerChain,
} from "../referral-chain"

describe("capLevels", () => {
  it("clamps below 1 to 1", () => {
    expect(capLevels(0)).toBe(1)
    expect(capLevels(-5)).toBe(1)
    expect(capLevels(null)).toBe(1)
    expect(capLevels(undefined)).toBe(1)
  })

  it("clamps above the absolute max", () => {
    expect(capLevels(ABSOLUTE_MAX_LEVELS + 1)).toBe(ABSOLUTE_MAX_LEVELS)
    expect(capLevels(99)).toBe(ABSOLUTE_MAX_LEVELS)
  })

  it("passes through valid values", () => {
    expect(capLevels(1)).toBe(1)
    expect(capLevels(2)).toBe(2)
    expect(capLevels(3)).toBe(3)
  })
})

describe("parseLevelSplitsEnv", () => {
  it("returns defaults when env is unset", () => {
    expect(parseLevelSplitsEnv(undefined)).toBe(DEFAULT_LEVEL_SPLITS)
  })

  it("parses a valid JSON object", () => {
    expect(parseLevelSplitsEnv('{"L1":70,"L2":20,"L3":10}')).toEqual({
      L1: 70,
      L2: 20,
      L3: 10,
    })
  })

  it("falls back to defaults on malformed JSON", () => {
    expect(parseLevelSplitsEnv("not json")).toBe(DEFAULT_LEVEL_SPLITS)
  })

  it("falls back to defaults when values are not numeric", () => {
    expect(parseLevelSplitsEnv('{"L1":"hi"}')).toBe(DEFAULT_LEVEL_SPLITS)
  })
})

describe("allocateCommission", () => {
  it("allocates default 80/15/5 across three levels", () => {
    const out = allocateCommission({
      totalCents: 1000,
      levels: 3,
      splits: DEFAULT_LEVEL_SPLITS,
    })
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000)
    expect(out[0]).toBeGreaterThan(out[1])
    expect(out[1]).toBeGreaterThan(out[2])
  })

  it("gives 100% to L1 when only one level is requested", () => {
    const out = allocateCommission({
      totalCents: 1234,
      levels: 1,
      splits: DEFAULT_LEVEL_SPLITS,
    })
    expect(out).toEqual([1234])
  })

  it("normalizes splits that sum above 100", () => {
    const out = allocateCommission({
      totalCents: 1000,
      levels: 2,
      splits: { L1: 80, L2: 80 },
    })
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it("collapses to L1 when splits are all zero", () => {
    const out = allocateCommission({
      totalCents: 500,
      levels: 3,
      splits: { L1: 0, L2: 0, L3: 0 },
    })
    expect(out).toEqual([500, 0, 0])
  })

  it("never silently drops cents to rounding", () => {
    const out = allocateCommission({
      totalCents: 999,
      levels: 3,
      splits: { L1: 33, L2: 33, L3: 34 },
    })
    expect(out.reduce((a, b) => a + b, 0)).toBe(999)
  })
})

describe("walkReferrerChain", () => {
  it("returns just the primary seller when no referrer is found", async () => {
    const chain = await walkReferrerChain({
      primarySellerId: "sel_1",
      maxLevels: 3,
      lookupReferrer: async () => null,
    })
    expect(chain).toEqual(["sel_1"])
  })

  it("walks up to maxLevels", async () => {
    const parents: Record<string, string | null> = {
      sel_1: "sel_2",
      sel_2: "sel_3",
      sel_3: "sel_4",
      sel_4: null,
    }
    const chain = await walkReferrerChain({
      primarySellerId: "sel_1",
      maxLevels: 3,
      lookupReferrer: async (id) => parents[id] ?? null,
    })
    expect(chain).toEqual(["sel_1", "sel_2", "sel_3"])
  })

  it("stops on cycle detection without infinite loop", async () => {
    const parents: Record<string, string | null> = {
      sel_1: "sel_2",
      sel_2: "sel_1", // cycle
    }
    const chain = await walkReferrerChain({
      primarySellerId: "sel_1",
      maxLevels: 5,
      lookupReferrer: async (id) => parents[id] ?? null,
    })
    expect(chain).toEqual(["sel_1", "sel_2"])
  })

  it("respects the absolute cap even when caller asks for more", async () => {
    const chain = await walkReferrerChain({
      primarySellerId: "sel_1",
      maxLevels: 99,
      lookupReferrer: async (id) => `parent_of_${id}`,
    })
    expect(chain.length).toBe(ABSOLUTE_MAX_LEVELS)
  })
})
