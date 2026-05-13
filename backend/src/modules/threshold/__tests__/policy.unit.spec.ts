import {
  DEFAULT_VISIBILITY_RADIUS_KM,
  isThresholdPostType,
  MAX_VISIBILITY_RADIUS_KM,
  POST_TYPE_LABELS,
  THRESHOLD_POST_TYPES,
  validateThresholdPostCreate,
} from "../policy"

describe("threshold policy: post-type taxonomy", () => {
  it("exposes the seven canonical mutual-aid post types", () => {
    expect(THRESHOLD_POST_TYPES).toEqual([
      "free_store",
      "community_fridge",
      "tool_library",
      "mutual_aid_ask",
      "mutual_aid_fund",
      "skill_share",
      "repair_cafe",
    ])
  })

  it("has a human label per post type", () => {
    for (const t of THRESHOLD_POST_TYPES) {
      expect(POST_TYPE_LABELS[t]).toBeTruthy()
    }
  })

  it.each(THRESHOLD_POST_TYPES)("isThresholdPostType accepts %s", (t) => {
    expect(isThresholdPostType(t)).toBe(true)
  })

  it.each(["FREE_STORE", "ToolLibrary", "", null, 1])(
    "isThresholdPostType rejects %p",
    (v) => {
      expect(isThresholdPostType(v)).toBe(false)
    }
  )
})

describe("threshold policy: validateThresholdPostCreate", () => {
  const baseValid = {
    type: "free_store",
    title: "Brooklyn ave free store",
    posted_by_member_id: "mem_abc",
  }

  it("passes a minimal valid post (defaults applied)", () => {
    const out = validateThresholdPostCreate(baseValid)
    expect(out.title).toBe("Brooklyn ave free store")
    expect(out.description).toBeNull()
    expect(out.latitude).toBeNull()
    expect(out.longitude).toBeNull()
    expect(out.visibility_radius_km).toBe(DEFAULT_VISIBILITY_RADIUS_KM)
  })

  it("THROWS on any price-like field — the gift economy invariant", () => {
    for (const field of [
      "price",
      "price_minor",
      "amount",
      "amount_minor",
      "cost",
      "fee",
      "rate",
      "currency_code",
    ]) {
      expect(() =>
        validateThresholdPostCreate({ ...baseValid, [field]: 100 })
      ).toThrow(/cannot carry|gift economy/i)
    }
  })

  it("allows the price field to be explicitly null/undefined (defensive)", () => {
    expect(() =>
      validateThresholdPostCreate({
        ...baseValid,
        price: null,
        amount_minor: undefined,
      })
    ).not.toThrow()
  })

  it("rejects an unknown post type", () => {
    expect(() =>
      validateThresholdPostCreate({ ...baseValid, type: "yard_sale" })
    ).toThrow(/post type must be one of/)
  })

  it("rejects empty title", () => {
    expect(() =>
      validateThresholdPostCreate({ ...baseValid, title: "" })
    ).toThrow(/title is required/)
    expect(() =>
      validateThresholdPostCreate({ ...baseValid, title: "   " })
    ).toThrow(/title is required/)
  })

  it("rejects mismatched lat/lon", () => {
    expect(() =>
      validateThresholdPostCreate({ ...baseValid, latitude: 40.7 })
    ).toThrow(/together/)
    expect(() =>
      validateThresholdPostCreate({ ...baseValid, longitude: -74 })
    ).toThrow(/together/)
  })

  it("rejects out-of-range latitude / longitude", () => {
    expect(() =>
      validateThresholdPostCreate({
        ...baseValid,
        latitude: 91,
        longitude: 0,
      })
    ).toThrow(/latitude/)
    expect(() =>
      validateThresholdPostCreate({
        ...baseValid,
        latitude: 0,
        longitude: 181,
      })
    ).toThrow(/longitude/)
  })

  it("rejects visibility_radius_km outside [1, MAX]", () => {
    expect(() =>
      validateThresholdPostCreate({ ...baseValid, visibility_radius_km: 0 })
    ).toThrow(/visibility_radius_km/)
    expect(() =>
      validateThresholdPostCreate({
        ...baseValid,
        visibility_radius_km: MAX_VISIBILITY_RADIUS_KM + 1,
      })
    ).toThrow(/visibility_radius_km/)
  })

  it("rounds the radius to an integer", () => {
    const out = validateThresholdPostCreate({
      ...baseValid,
      visibility_radius_km: 3.7,
    })
    expect(out.visibility_radius_km).toBe(4)
  })

  it("requires posted_by_member_id", () => {
    expect(() =>
      validateThresholdPostCreate({ ...baseValid, posted_by_member_id: "" })
    ).toThrow(/posted_by_member_id/)
  })

  it("trims title, description, and posted_by_member_id", () => {
    const out = validateThresholdPostCreate({
      ...baseValid,
      title: "  Trimmed  ",
      description: "  desc  ",
      posted_by_member_id: "  mem_abc  ",
    })
    expect(out.title).toBe("Trimmed")
    expect(out.description).toBe("desc")
    expect(out.posted_by_member_id).toBe("mem_abc")
  })

  it("accepts valid lat/lon coordinates", () => {
    const out = validateThresholdPostCreate({
      ...baseValid,
      latitude: 40.7128,
      longitude: -74.006,
    })
    expect(out.latitude).toBe(40.7128)
    expect(out.longitude).toBe(-74.006)
  })

  it("rejects non-object input", () => {
    expect(() => validateThresholdPostCreate(null)).toThrow()
    expect(() => validateThresholdPostCreate("hi")).toThrow()
    expect(() => validateThresholdPostCreate(42)).toThrow()
  })
})
