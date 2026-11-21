import {
  coverageStatusOf,
  inForce,
  requiredKeysNotReviewed,
  reviewedKeysInForce,
  type RuleVersionState,
} from "../coverage"

const at = new Date("2026-11-21T12:00:00Z")

const version = (rule_key: string, state: Partial<RuleVersionState> = {}): RuleVersionState => ({
  rule_key,
  review_status: "draft",
  superseded_at: null,
  withdrawn_at: null,
  ...state,
})
const reviewed = (key: string, state: Partial<RuleVersionState> = {}) => version(key, { review_status: "reviewed", ...state })

const REQUIRED = ["label.statement", "foods.allowed", "sales.online_delivery"]

describe("coverageStatusOf", () => {
  it("is not_covered when nothing is on file, whatever is required", () => {
    expect(coverageStatusOf([], [])).toBe("not_covered")
    expect(coverageStatusOf(REQUIRED, [])).toBe("not_covered")
  })

  it("is draft while every rule is a draft", () => {
    expect(coverageStatusOf(REQUIRED, REQUIRED.map((k) => version(k)))).toBe("draft")
  })

  it("is covered only when every required key has a reviewed version in force", () => {
    expect(coverageStatusOf(REQUIRED, REQUIRED.map((k) => reviewed(k)))).toBe("covered")
  })

  it("is still draft with one required key unreviewed, whichever one it is", () => {
    for (const missing of REQUIRED) {
      const versions = REQUIRED.map((k) => (k === missing ? version(k) : reviewed(k)))
      expect(coverageStatusOf(REQUIRED, versions)).toBe("draft")
      expect(requiredKeysNotReviewed(REQUIRED, versions)).toEqual([missing])
    }
  })

  it("is draft when a required key has no version at all", () => {
    const versions = [reviewed("label.statement"), reviewed("foods.allowed")]
    expect(coverageStatusOf(REQUIRED, versions)).toBe("draft")
    expect(requiredKeysNotReviewed(REQUIRED, versions)).toEqual(["sales.online_delivery"])
  })

  it("does not count a reviewed version that was superseded or withdrawn", () => {
    const superseded = [...REQUIRED.slice(1).map((k) => reviewed(k)), reviewed(REQUIRED[0], { superseded_at: at })]
    expect(coverageStatusOf(REQUIRED, superseded)).toBe("draft")
    const withdrawn = [...REQUIRED.slice(1).map((k) => reviewed(k)), reviewed(REQUIRED[0], { withdrawn_at: at })]
    expect(coverageStatusOf(REQUIRED, withdrawn)).toBe("draft")
  })

  it("stays covered while a correction to a reviewed rule is pending as a draft", () => {
    const versions = [...REQUIRED.map((k) => reviewed(k)), version("label.statement")]
    expect(coverageStatusOf(REQUIRED, versions)).toBe("covered")
  })

  it("stays covered across a correction: the old reviewed version superseded, the new one in force", () => {
    const versions = [
      reviewed("label.statement", { superseded_at: at }),
      reviewed("label.statement"),
      reviewed("foods.allowed"),
      reviewed("sales.online_delivery"),
    ]
    expect(coverageStatusOf(REQUIRED, versions)).toBe("covered")
  })

  it("is not affected by a rule that coverage does not require", () => {
    expect(coverageStatusOf(REQUIRED, [...REQUIRED.map((k) => reviewed(k)), version("extra.note")])).toBe("covered")
    expect(coverageStatusOf(REQUIRED, [reviewed("extra.note"), ...REQUIRED.map((k) => version(k))])).toBe("draft")
  })

  it("is never covered when nothing is required, even with every rule reviewed", () => {
    expect(coverageStatusOf([], [reviewed("label.statement"), reviewed("foods.allowed")])).toBe("draft")
  })

  it("is withdrawn when rules were on file and none is in force any more", () => {
    const versions = [
      reviewed("label.statement", { withdrawn_at: at }),
      version("foods.allowed", { withdrawn_at: at }),
      version("sales.online_delivery", { superseded_at: at }),
    ]
    expect(coverageStatusOf(REQUIRED, versions)).toBe("withdrawn")
  })

  it("reads a draft back in after everything was withdrawn as draft, not withdrawn", () => {
    const versions = [reviewed("label.statement", { withdrawn_at: at }), version("label.statement")]
    expect(coverageStatusOf(REQUIRED, versions)).toBe("draft")
  })
})

describe("in force", () => {
  it("means neither superseded nor withdrawn, with timestamps as dates or strings", () => {
    expect(inForce(version("a"))).toBe(true)
    expect(inForce(version("a", { superseded_at: at }))).toBe(false)
    expect(inForce(version("a", { withdrawn_at: "2026-11-21T12:00:00.000Z" }))).toBe(false)
  })

  it("collects the keys with a reviewed version in force, and no drafts", () => {
    const keys = reviewedKeysInForce([
      reviewed("a"),
      version("b"),
      reviewed("c", { withdrawn_at: at }),
      reviewed("d", { superseded_at: at }),
      reviewed("d"),
    ])
    expect([...keys].sort()).toEqual(["a", "d"])
  })
})
