import { canonicalJson } from "./content-hash"
import {
  ISO_DATE_PATTERN,
  JURISDICTION_PROGRAMS,
  RULE_KEY_PATTERN,
  RULE_KINDS,
  type RuleCitationInput,
  type RuleKind,
} from "./types"
import { isUsJurisdictionCode } from "./us-jurisdictions"

/**
 * What a proposed rule version must carry before it is written. Pure: it
 * reads only its argument, so the fixture's shape test and the service's
 * write path hold a draft to the same rules.
 *
 * The rule that matters most is the first one a reader would skip: **a rule
 * with no citation is not a rule.** Every version names at least one source
 * document and where in it to look, and every kind except `not_stated`
 * carries the source's own words beside the display text, so a paraphrase can
 * always be checked against what it paraphrases.
 */

export type RuleDraftInput = {
  jurisdiction_code: string
  program: string
  rule_key: string
  kind: RuleKind
  value?: unknown
  display_text: string
  citations: RuleCitationInput[]
  effective_from?: string | null
  effective_note?: string | null
}

const filled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

/** A real calendar date in `YYYY-MM-DD`: 2026-02-30 has the shape and is not one. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Every reason this draft cannot be written, in plain words. Empty means it can. */
export function ruleDraftProblems(draft: RuleDraftInput): string[] {
  const problems: string[] = []

  if (!isUsJurisdictionCode(draft.jurisdiction_code)) {
    problems.push("jurisdiction_code must be an ISO 3166-2 code for a US state or DC, such as US-SC")
  }
  if (!(JURISDICTION_PROGRAMS as readonly string[]).includes(draft.program)) {
    problems.push(`program must be one of: ${JURISDICTION_PROGRAMS.join(", ")}`)
  }
  if (typeof draft.rule_key !== "string" || !RULE_KEY_PATTERN.test(draft.rule_key)) {
    problems.push("rule_key must be lowercase words joined by dots, such as label.statement")
  }
  const kindKnown = (RULE_KINDS as readonly string[]).includes(draft.kind)
  if (!kindKnown) problems.push(`kind must be one of: ${RULE_KINDS.join(", ")}`)
  if (!filled(draft.display_text)) problems.push("display_text is required")

  if (draft.value !== undefined && draft.value !== null) {
    if (typeof draft.value !== "object" || Array.isArray(draft.value)) {
      problems.push("value must be a JSON object, or left out")
    } else {
      try {
        canonicalJson(draft.value)
      } catch {
        problems.push("value must be plain JSON: no functions, bigints or non-finite numbers")
      }
    }
  }

  if (!Array.isArray(draft.citations) || draft.citations.length === 0) {
    problems.push("a rule needs at least one citation: the source document and where in it to look")
  } else {
    draft.citations.forEach((citation, index) => {
      const at = `citations[${index}]`
      if (!citation || typeof citation !== "object") {
        problems.push(`${at} must be an object with source_id, locator and quote`)
        return
      }
      if (!filled(citation.source_id)) problems.push(`${at}.source_id is required`)
      if (!filled(citation.locator)) problems.push(`${at}.locator is required: say where in the document to look`)
      const hasQuote = filled(citation.quote)
      if (kindKnown && draft.kind === "not_stated") {
        if (citation.quote !== undefined && citation.quote !== null) {
          problems.push(
            `${at}.quote must be left out for a not_stated rule: it cites a document that was read and says nothing on the topic`
          )
        }
      } else if (kindKnown && !hasQuote) {
        problems.push(`${at}.quote is required: the source's own words, verbatim`)
      }
    })
  }

  if (draft.effective_from !== undefined && draft.effective_from !== null && !isIsoDate(draft.effective_from)) {
    problems.push("effective_from must be a calendar date as YYYY-MM-DD, or left out when the source states none")
  }
  if (draft.effective_note !== undefined && draft.effective_note !== null && typeof draft.effective_note !== "string") {
    problems.push("effective_note must be text")
  }

  return problems
}
