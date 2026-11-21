import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { MAJOR_ALLERGENS } from "../../cottage-food/models/label"
import { ruleDraftProblems } from "../rule-draft"
import {
  HOME_BASED_FOOD,
  US_SC,
  US_SC_HOME_BASED_FOOD_RULES,
  US_SC_LABEL_STATEMENT,
  US_SC_REQUIRED_RULE_KEYS,
  US_SC_SOURCES,
} from "../seeds/us-sc-home-based-food"
import { RULE_KINDS } from "../types"

/**
 * The South Carolina fixture, held to the shape the plan gives it and to the
 * archived documents it cites.
 *
 * What this cannot check is that each quote is in its PDF: reading a PDF's
 * text needs a parser this workspace does not carry. That was checked by hand
 * when the fixture was written (2026-11-21, every quote found verbatim in the
 * text layer of its archived file); what is pinned here is everything around
 * it, including that the file cited is byte-for-byte the file archived.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../../..")

/** The plan's sixteen rules, in its order, with the kind it gives each. */
const PLANNED: Array<[string, string]> = [
  ["permit.retail_food_permit", "fact"],
  ["label.producer_identity", "requirement"],
  ["label.product_name", "requirement"],
  ["label.ingredients", "requirement"],
  ["label.statement", "requirement"],
  ["claims.health", "prohibition"],
  ["allergens.declaration", "requirement"],
  ["allergens.tree_nut_type", "requirement"],
  ["foods.allowed", "permission"],
  ["foods.not_allowed", "prohibition"],
  ["sales.area", "requirement"],
  ["sales.channels", "permission"],
  ["tcs.permit_path", "fact"],
  ["sales.annual_cap", "not_stated"],
  ["food_handler.certificate", "not_stated"],
  ["sales.online_delivery", "not_stated"],
]

const rule = (key: string) => {
  const found = US_SC_HOME_BASED_FOOD_RULES.find((r) => r.rule_key === key)
  if (!found) throw new Error(`no fixture rule ${key}`)
  return found
}

describe("US-SC home-based food fixture", () => {
  it("has exactly the sixteen planned rules, in order, each of the planned kind", () => {
    expect(US_SC_HOME_BASED_FOOD_RULES.map((r) => [r.rule_key, r.kind])).toEqual(PLANNED)
    expect(new Set(US_SC_HOME_BASED_FOOD_RULES.map((r) => r.rule_key)).size).toBe(16)
    for (const r of US_SC_HOME_BASED_FOOD_RULES) expect(RULE_KINDS).toContain(r.kind)
  })

  it("requires all sixteen for coverage", () => {
    expect(US_SC_REQUIRED_RULE_KEYS).toEqual(PLANNED.map(([key]) => key))
    expect(US_SC).toBe("US-SC")
    expect(HOME_BASED_FOOD).toBe("home_based_food")
  })

  describe("sources", () => {
    it("are the two archived SCDA documents, with the hashes of the files as archived", () => {
      expect(US_SC_SOURCES.map((s) => s.key)).toEqual(["fact_sheet", "faq"])
      for (const source of US_SC_SOURCES) {
        expect(source.jurisdiction_code).toBe("US-SC")
        expect(source.archive_ref).toMatch(/^docs\/sources\/us-sc\/[a-z0-9-]+\.pdf$/)
        const file = path.join(REPO_ROOT, source.archive_ref)
        // The archive is part of the repository; a missing file is a failure, not a skip.
        expect(existsSync(file)).toBe(true)
        expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(source.content_sha256)
      }
    })

    it("carry the same hashes the archive's own README records", () => {
      const readme = readFileSync(path.join(REPO_ROOT, "docs/sources/us-sc/README.md"), "utf8")
      for (const source of US_SC_SOURCES) {
        expect(readme).toContain(source.content_sha256)
        expect(readme).toContain(path.basename(source.archive_ref))
      }
    })

    it("give the fact sheet its form number and printed date, and the FAQ neither", () => {
      const [factSheet, faq] = US_SC_SOURCES
      expect(factSheet.document_id).toBe("CPD Form #2210")
      expect(factSheet.document_date).toBe("2026-05-01")
      // Nothing is printed on the FAQ. A date inferred from a file name is a
      // note, not a document date.
      expect(faq.document_id).toBeNull()
      expect(faq.document_date).toBeNull()
      expect(faq.document_date_note).toMatch(/No date or form number is printed/)
      expect(faq.url).toBe("https://agriculture.sc.gov/wp-content/uploads/2025/07/RF_SellingFoodFromHomeFAQ2025.pdf")
    })

    it("say on the FAQ's own record that its page 2 exemption list is a different path", () => {
      expect(US_SC_SOURCES[1].notes).toMatch(/different legal path/)
      expect(US_SC_SOURCES[1].notes).toMatch(/not recorded as home-based food rules/)
    })
  })

  describe("every rule", () => {
    it("cites at least one source, and passes the same checks a draft must pass on write", () => {
      const sourceIds = { fact_sheet: "jsrc_fact_sheet", faq: "jsrc_faq" }
      for (const r of US_SC_HOME_BASED_FOOD_RULES) {
        expect(r.citations.length).toBeGreaterThan(0)
        for (const c of r.citations) expect(Object.keys(sourceIds)).toContain(c.source)
        const problems = ruleDraftProblems({
          jurisdiction_code: US_SC,
          program: HOME_BASED_FOOD,
          rule_key: r.rule_key,
          kind: r.kind,
          value: r.value,
          display_text: r.display_text,
          citations: r.citations.map((c) => ({ source_id: sourceIds[c.source], locator: c.locator, quote: c.quote ?? null })),
          effective_from: r.effective_from,
          effective_note: r.effective_note,
        })
        expect({ rule: r.rule_key, problems }).toEqual({ rule: r.rule_key, problems: [] })
      }
    })

    it("carries the source's own words on every citation, unless it is a not_stated rule", () => {
      for (const r of US_SC_HOME_BASED_FOOD_RULES) {
        for (const c of r.citations) {
          expect(c.locator.trim().length).toBeGreaterThan(0)
          if (r.kind === "not_stated") {
            expect(c.quote).toBeUndefined()
          } else {
            expect(typeof c.quote).toBe("string")
            expect((c.quote as string).trim().length).toBeGreaterThan(0)
            // Verbatim, with the PDF's line breaks joined by single spaces.
            expect(c.quote).toBe((c.quote as string).replace(/\s+/g, " ").trim())
          }
        }
      }
    })

    it("is a draft with no reviewer: the fixture has no review, history or hash field at all", () => {
      const allowed = ["rule_key", "kind", "value", "display_text", "citations", "effective_from", "effective_note"]
      for (const r of US_SC_HOME_BASED_FOOD_RULES) {
        expect(Object.keys(r).sort()).toEqual([...allowed].sort())
      }
    })

    it("has no effective date, because neither document states one", () => {
      for (const r of US_SC_HOME_BASED_FOOD_RULES) expect(r.effective_from).toBeNull()
    })
  })

  describe("the label statement", () => {
    it("is stored with the typographic apostrophe the fact sheet prints, never a straight one", () => {
      expect(US_SC_LABEL_STATEMENT).toBe(
        "PROCESSED AND PREPARED BY A HOME-BASED FOOD PRODUCTION OPERATION THAT IS NOT SUBJECT TO SOUTH CAROLINA’S FOOD SAFETY REGULATIONS."
      )
      expect(US_SC_LABEL_STATEMENT).not.toContain("'")
      expect(US_SC_LABEL_STATEMENT).toBe(US_SC_LABEL_STATEMENT.toUpperCase())
    })

    it("is the same string in the rule's value, its display text, its quote and the retail sign", () => {
      const statement = rule("label.statement")
      expect(statement.value).toMatchObject({ text: US_SC_LABEL_STATEMENT, all_capitals: true, contrasting_color: true })
      expect(statement.display_text.endsWith(US_SC_LABEL_STATEMENT)).toBe(true)
      expect(statement.citations.some((c) => c.quote?.endsWith(US_SC_LABEL_STATEMENT))).toBe(true)
      expect(rule("sales.channels").value).toMatchObject({ retail_sign_text: US_SC_LABEL_STATEMENT })
    })
  })

  describe("the traps in the sources", () => {
    it("marks both food lists as partial and says what an unnamed food means", () => {
      const allowed = rule("foods.allowed")
      const notAllowed = rule("foods.not_allowed")
      expect(allowed.value).toMatchObject({ list_is_partial: true })
      expect(notAllowed.value).toMatchObject({ list_is_partial: true })
      expect((allowed.value.items as unknown[]).length).toBe(7)
      expect(allowed.display_text).toMatch(/list is partial/)
      expect(allowed.display_text).toMatch(/not covered by our sources; that does not mean it is not allowed/)
      expect(notAllowed.display_text).toMatch(/partial too/)
      // Both cite the footnote that says so.
      for (const r of [allowed, notAllowed]) {
        expect(r.citations.map((c) => c.quote)).toContain(
          "*See the Home-based Food Production Law Guidance for a more complete list of products."
        )
      }
    })

    it("seeds nothing from the FAQ's page 2 list of Retail Food Establishment permit exemptions", () => {
      const everything = JSON.stringify(US_SC_HOME_BASED_FOOD_RULES).toLowerCase()
      for (const exempted of [
        "exempted from requiring",
        "popcorn",
        "cotton candy",
        "candy apples",
        "shaved ice",
        "snow cone",
        "soft drinks",
        "lemonade",
        "coffee",
        "nachos",
        "pork skins",
        "pretzels",
        "jams",
        "jellies",
        "preserves",
        "dried fruits",
        "seasonings",
        "vinegar",
        "french fries",
        "salt-boiled",
        "grilled corn",
        "waffle",
        "pancake",
        "funnel cake",
        "mini-donut",
      ]) {
        expect(everything).not.toContain(exempted)
      }
      // What is cited from the FAQ is page 1, or page 2's separate question on meals and TCS foods.
      const faqLocators = US_SC_HOME_BASED_FOOD_RULES.flatMap((r) =>
        r.citations.filter((c) => c.source === "faq" && c.quote !== undefined).map((c) => c.locator)
      )
      expect(faqLocators.length).toBeGreaterThan(0)
      for (const locator of faqLocators) {
        expect(locator).toMatch(/^Page 1, |^Page 2, (third question|answer to the third question)$/)
      }
    })

    it("does not say the Home-based Food ID is optional, or how to get one", () => {
      const identity = rule("label.producer_identity")
      expect(identity.display_text).not.toMatch(/optional/i)
      expect(identity.display_text).toMatch(/do not say how that ID number is obtained/)
      expect(identity.value).toMatchObject({ id_issuance_stated: false })
    })

    it("records the three things neither document addresses as not_stated rules citing both documents", () => {
      const silent = US_SC_HOME_BASED_FOOD_RULES.filter((r) => r.kind === "not_stated")
      expect(silent.map((r) => r.rule_key)).toEqual([
        "sales.annual_cap",
        "food_handler.certificate",
        "sales.online_delivery",
      ])
      for (const r of silent) {
        expect(r.citations.map((c) => c.source).sort()).toEqual(["fact_sheet", "faq"])
        expect(r.display_text).toMatch(/^Not addressed by our sources: neither document /)
      }
      expect(rule("sales.online_delivery").display_text).toMatch(/online orders, shipping or delivery within South Carolina/)
    })
  })

  it("names the fact sheet's nine major allergens by the keys the cottage-food label uses", () => {
    const allergens = rule("allergens.declaration").value.major_allergens as Array<{
      key: string
      label: string
      not_allowed_as_cottage_food?: boolean
    }>
    expect(allergens.map((a) => a.label)).toEqual([
      "Wheat",
      "Soy",
      "Milk",
      "Egg",
      "Finfish",
      "Crustacean Shellfish",
      "Peanuts",
      "Tree Nuts",
      "Sesame",
    ])
    expect(allergens.map((a) => a.key).sort()).toEqual([...MAJOR_ALLERGENS].sort())
    expect(allergens.filter((a) => a.not_allowed_as_cottage_food).map((a) => a.key)).toEqual(["fish", "crustacean_shellfish"])
  })
})
