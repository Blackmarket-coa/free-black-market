import { describe, expect, it } from "vitest"
import { SELLING_TYPE_DEFAULTS } from "./launch-wizard"

/**
 * The wizard's selling-type table.
 *
 * It used to carry an `archetype_code` per entry that nothing read. The
 * mapping now lives on the backend (`modules/tenancy/selling-type-archetype.ts`)
 * and the onboarding GET response returns the resolved code; what is left here
 * is copy, and these tests hold it to that. Same spirit as
 * `vendor-type-context.spec.ts`, whose own note records a literal list that
 * "silently stopped covering any newly added archetype".
 */
describe("SELLING_TYPE_DEFAULTS", () => {
  it("offers a condition-graded option for repaired and salvaged goods", () => {
    // Without this a salvage seller has no honest choice in the wizard and
    // lands on general physical goods, which carries no condition grade.
    expect(SELLING_TYPE_DEFAULTS.reclaimed).toBeDefined()
    expect(SELLING_TYPE_DEFAULTS.reclaimed.delivery_hint).toMatch(/condition/i)
  })

  it("carries no archetype code — that mapping is the backend's", () => {
    for (const entry of Object.values(SELLING_TYPE_DEFAULTS)) {
      expect(entry).not.toHaveProperty("archetype_code")
    }
  })

  it("gives every selling type non-empty copy", () => {
    for (const [key, entry] of Object.entries(SELLING_TYPE_DEFAULTS)) {
      expect(entry.label, key).toBeTruthy()
      expect(entry.delivery_label, key).toBeTruthy()
      expect(entry.delivery_hint, key).toBeTruthy()
    }
  })

  it("gives every selling type a distinct label", () => {
    const labels = Object.values(SELLING_TYPE_DEFAULTS).map((e) => e.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
