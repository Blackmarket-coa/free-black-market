import { createHash } from "node:crypto"
import {
  CONTENT_HASH_SCHEME,
  canonicalJson,
  canonicalRuleContent,
  ruleContentOf,
  ruleContentSha256,
} from "../content-hash"
import type { RuleContent } from "../types"

const SOURCE_SHA = "b19c9924721c9219b54f6c859e4733b97e8ad86caa7b29c13df0d8647fe7712c"

const base = (): RuleContent => ({
  jurisdiction_code: "US-SC",
  program: "home_based_food",
  rule_key: "label.statement",
  version: 1,
  kind: "requirement",
  value: { label_field: "statement", all_capitals: true },
  display_text: "The label must carry this statement.",
  citations: [{ source_id: "jsrc_1", source_sha256: SOURCE_SHA, locator: "Labeling, item 4", quote: "A statement" }],
  effective_from: null,
  effective_note: "Neither source states when this took effect.",
})

describe("canonicalJson", () => {
  it("sorts object keys at every depth and writes no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}')
  })

  it("is the same text whatever order the keys were written in", () => {
    const one = { kind: "fact", value: { b: 2, a: 1 }, list: [{ y: 1, x: 2 }] }
    const two = { list: [{ x: 2, y: 1 }], value: { a: 1, b: 2 }, kind: "fact" }
    expect(canonicalJson(one)).toBe(canonicalJson(two))
  })

  it("keeps array order: a reordered list is different content", () => {
    expect(canonicalJson(["a", "b"])).not.toBe(canonicalJson(["b", "a"]))
  })

  it("leaves out undefined properties, as JSON does, and keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}')
  })

  it("writes strings exactly, without straightening or normalising them", () => {
    expect(canonicalJson("CAROLINA’S")).toBe('"CAROLINA’S"')
    expect(canonicalJson("CAROLINA’S")).not.toBe(canonicalJson("CAROLINA'S"))
    // Composed and decomposed forms of the same letter stay distinct too.
    expect(canonicalJson("café")).not.toBe(canonicalJson("café"))
    expect(canonicalJson(" padded ")).toBe('" padded "')
  })

  it("refuses a value JSON cannot carry instead of writing null for it", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError)
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError)
    expect(() => canonicalJson([undefined])).toThrow(TypeError)
    expect(() => canonicalJson({ a: BigInt(1) })).toThrow(TypeError)
    expect(() => canonicalJson({ a: () => 1 })).toThrow(TypeError)
  })
})

describe("ruleContentSha256", () => {
  it("is the SHA-256 of the canonical content, as lowercase hex", () => {
    const expected = createHash("sha256").update(canonicalRuleContent(base()), "utf8").digest("hex")
    expect(ruleContentSha256(base())).toBe(expected)
    expect(ruleContentSha256(base())).toMatch(/^[0-9a-f]{64}$/)
  })

  it("covers the scheme number, so a change of canonical form cannot pass as the same hash", () => {
    expect(JSON.parse(canonicalRuleContent(base())).scheme).toBe(CONTENT_HASH_SCHEME)
  })

  it("does not depend on key order in the content, its value or its citations", () => {
    const reordered = {
      effective_note: base().effective_note,
      effective_from: null,
      citations: [{ quote: "A statement", locator: "Labeling, item 4", source_sha256: SOURCE_SHA, source_id: "jsrc_1" }],
      display_text: base().display_text,
      value: { all_capitals: true, label_field: "statement" },
      kind: "requirement",
      version: 1,
      rule_key: "label.statement",
      program: "home_based_food",
      jurisdiction_code: "US-SC",
    } as RuleContent
    expect(ruleContentSha256(reordered)).toBe(ruleContentSha256(base()))
  })

  it("treats an absent optional and a null one as the same content", () => {
    const sparse = { ...base(), value: undefined, effective_from: undefined, effective_note: undefined } as unknown as RuleContent
    const nulls = { ...base(), value: null, effective_from: null, effective_note: null }
    expect(ruleContentSha256(sparse)).toBe(ruleContentSha256(nulls))
  })

  it.each([
    ["jurisdiction_code", { jurisdiction_code: "US-NC" }],
    ["program", { program: "other_program" }],
    ["rule_key", { rule_key: "label.ingredients" }],
    ["version", { version: 2 }],
    ["kind", { kind: "permission" }],
    ["value", { value: { label_field: "statement", all_capitals: false } }],
    ["display_text", { display_text: "The label must carry this statement. " }],
    ["effective_from", { effective_from: "2026-05-01" }],
    ["effective_note", { effective_note: null }],
  ] as Array<[string, Partial<RuleContent>]>)("changes when %s changes", (_field, change) => {
    expect(ruleContentSha256({ ...base(), ...change })).not.toBe(ruleContentSha256(base()))
  })

  it("changes when any part of a citation changes, or their order does", () => {
    const [citation] = base().citations
    const withCitations = (citations: RuleContent["citations"]) => ruleContentSha256({ ...base(), citations })
    const original = ruleContentSha256(base())
    expect(withCitations([{ ...citation, quote: "A statement." }])).not.toBe(original)
    expect(withCitations([{ ...citation, quote: null }])).not.toBe(original)
    expect(withCitations([{ ...citation, locator: "Labeling, item 3" }])).not.toBe(original)
    expect(withCitations([{ ...citation, source_id: "jsrc_2" }])).not.toBe(original)
    expect(withCitations([{ ...citation, source_sha256: "0".repeat(64) }])).not.toBe(original)
    expect(withCitations([])).not.toBe(original)

    const second = { ...citation, locator: "Labeling, item 1", quote: "Name and address" }
    expect(withCitations([citation, second])).not.toBe(withCitations([second, citation]))
  })

  it("tells the typographic apostrophe from the straight one", () => {
    const curly = { ...base(), display_text: "SOUTH CAROLINA’S FOOD SAFETY REGULATIONS." }
    const straight = { ...base(), display_text: "SOUTH CAROLINA'S FOOD SAFETY REGULATIONS." }
    expect(ruleContentSha256(curly)).not.toBe(ruleContentSha256(straight))
  })

  it("recomputes the same hash from a stored row, whatever else the row carries", () => {
    const row = {
      ...base(),
      // As Postgres hands it back: version may arrive as a string, JSONB keys reordered.
      version: "1" as unknown as number,
      value: { all_capitals: true, label_field: "statement" },
      id: "jrule_1",
      content_sha256: "ignored",
      review_status: "reviewed",
      reviewed_by_user_id: "user_1",
      created_at: new Date(),
    }
    expect(ruleContentSha256(ruleContentOf(row))).toBe(ruleContentSha256(base()))
  })
})
