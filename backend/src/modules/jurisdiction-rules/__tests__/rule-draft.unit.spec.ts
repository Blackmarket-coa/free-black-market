import { isIsoDate, ruleDraftProblems, type RuleDraftInput } from "../rule-draft"
import { RULE_KINDS } from "../types"

const draft = (change: Partial<RuleDraftInput> = {}): RuleDraftInput => ({
  jurisdiction_code: "US-SC",
  program: "home_based_food",
  rule_key: "label.product_name",
  kind: "requirement",
  value: { label_field: "product_name" },
  display_text: "The label must show the standard name of the product.",
  citations: [{ source_id: "jsrc_1", locator: "Labeling, item 2", quote: "The standard name of the product." }],
  effective_from: null,
  effective_note: null,
  ...change,
})

describe("ruleDraftProblems", () => {
  it("finds nothing wrong with a cited, quoted draft", () => {
    expect(ruleDraftProblems(draft())).toEqual([])
  })

  it("refuses a rule with no citation", () => {
    for (const citations of [[], undefined, null, "jsrc_1"] as unknown as RuleDraftInput["citations"][]) {
      const problems = ruleDraftProblems(draft({ citations }))
      expect(problems).toEqual([expect.stringContaining("at least one citation")])
    }
  })

  it.each(RULE_KINDS.filter((kind) => kind !== "not_stated"))(
    "requires the source's own words on every citation of a %s rule",
    (kind) => {
      for (const quote of [undefined, null, "", "   "]) {
        const problems = ruleDraftProblems(draft({ kind, citations: [{ source_id: "jsrc_1", locator: "p. 1", quote }] }))
        expect(problems).toEqual([expect.stringContaining("citations[0].quote is required")])
      }
    }
  )

  it("names the citation that lacks a quote when others have one", () => {
    const problems = ruleDraftProblems(
      draft({
        citations: [
          { source_id: "jsrc_1", locator: "p. 1", quote: "Words." },
          { source_id: "jsrc_2", locator: "p. 2" },
        ],
      })
    )
    expect(problems).toEqual([expect.stringContaining("citations[1].quote is required")])
  })

  it("lets a not_stated rule cite documents without a quote, and refuses one with a quote", () => {
    const silent = draft({
      kind: "not_stated",
      citations: [
        { source_id: "jsrc_1", locator: "Whole document, read in full" },
        { source_id: "jsrc_2", locator: "Whole document, read in full", quote: null },
      ],
    })
    expect(ruleDraftProblems(silent)).toEqual([])

    const quoted = draft({ kind: "not_stated", citations: [{ source_id: "jsrc_1", locator: "p. 1", quote: "Some words." }] })
    expect(ruleDraftProblems(quoted)).toEqual([expect.stringContaining("must be left out for a not_stated rule")])
  })

  it("still requires a not_stated rule to cite something", () => {
    expect(ruleDraftProblems(draft({ kind: "not_stated", citations: [] }))).toEqual([
      expect.stringContaining("at least one citation"),
    ])
  })

  it("requires a source and a locator on every citation", () => {
    const problems = ruleDraftProblems(
      draft({ citations: [{ source_id: " ", locator: "", quote: "Words." }] as RuleDraftInput["citations"] })
    )
    expect(problems).toEqual([
      expect.stringContaining("citations[0].source_id is required"),
      expect.stringContaining("citations[0].locator is required"),
    ])
  })

  it.each([
    ["a jurisdiction that is not a US state code", { jurisdiction_code: "SC" }, "jurisdiction_code"],
    ["a territory", { jurisdiction_code: "US-PR" }, "jurisdiction_code"],
    ["an unknown program", { program: "cannabis" }, "program"],
    ["a rule key with no dot", { rule_key: "statement" }, "rule_key"],
    ["a rule key in capitals", { rule_key: "Label.Statement" }, "rule_key"],
    ["an unknown kind", { kind: "advice" as RuleDraftInput["kind"] }, "kind"],
    ["blank display text", { display_text: "   " }, "display_text"],
    ["a value that is a list", { value: ["a"] }, "value"],
    ["a value that is a string", { value: "text" }, "value"],
    ["a value JSON cannot carry", { value: { n: Number.NaN } }, "value"],
    ["an effective date that is not a date", { effective_from: "May 2026" }, "effective_from"],
    ["an effective date that is not on the calendar", { effective_from: "2026-02-30" }, "effective_from"],
    ["an effective date with a time", { effective_from: "2026-05-01T00:00:00Z" }, "effective_from"],
  ] as Array<[string, Partial<RuleDraftInput>, string]>)("refuses %s", (_name, change, field) => {
    const problems = ruleDraftProblems(draft(change))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(field)
  })

  it("accepts an effective date, and no value at all", () => {
    expect(ruleDraftProblems(draft({ effective_from: "2026-05-01" }))).toEqual([])
    expect(ruleDraftProblems(draft({ value: undefined }))).toEqual([])
    expect(ruleDraftProblems(draft({ value: null }))).toEqual([])
  })
})

describe("isIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-05-01")).toBe(true)
    expect(isIsoDate("2024-02-29")).toBe(true)
    expect(isIsoDate("2026-02-29")).toBe(false)
    expect(isIsoDate("2026-13-01")).toBe(false)
    expect(isIsoDate("5/1/26")).toBe(false)
    expect(isIsoDate("2026-5-1")).toBe(false)
    expect(isIsoDate(null)).toBe(false)
    expect(isIsoDate(new Date())).toBe(false)
  })
})
