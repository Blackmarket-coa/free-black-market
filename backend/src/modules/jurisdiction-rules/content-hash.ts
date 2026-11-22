import { createHash } from "node:crypto"
import { RULE_CITATION_SOURCE_FIELDS, type RuleCitation, type RuleCitationSource, type RuleContent } from "./types"

/**
 * The content hash a reviewer signs.
 *
 * A sign-off names a rule version by id and by this hash. The id says which
 * row; the hash says which words. `markReviewed` writes only when both match,
 * so a reviewer cannot approve text other than the text they were shown, and
 * anything that later reads a reviewed rule can recompute the hash and see
 * that the row still says what was approved.
 *
 * The hash is taken over a canonical JSON form, because the content passes
 * through a JSONB column and JSONB keeps neither key order nor spacing: two
 * objects that differ only in key order must hash the same, and nothing else
 * may. Strings are hashed exactly as stored. No trimming, no Unicode
 * normalisation, no straightening of quotes: South Carolina's required label
 * statement is spelled with a typographic apostrophe ("CAROLINA’S"), and
 * a hash that treated it as the same text as "CAROLINA'S" would let one be
 * swapped for the other under an existing sign-off.
 */

/** Bumped if the canonical form ever changes; it is part of what is hashed. */
export const CONTENT_HASH_SCHEME = 1

/**
 * JSON with object keys sorted (by UTF-16 code unit, at every depth), no
 * whitespace, and arrays left in order. A property whose value is `undefined`
 * is left out, as JSON does. A value JSON cannot carry (a non-finite number, a
 * bigint, a function, a symbol, `undefined` inside an array) throws: silently
 * writing `null` for it would make two different contents hash alike.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "boolean":
      return value ? "true" : "false"
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: a non-finite number has no JSON form")
      return JSON.stringify(value)
    case "object":
      break
    default:
      throw new TypeError(`canonicalJson: a ${typeof value} has no JSON form`)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  const record = value as Record<string, unknown>
  const body = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")
  return `{${body}}`
}

/**
 * The source details a reader is shown, each one hashed, with an absent one
 * written as null. Named fields only: a key added to the stored JSON that no
 * reader is shown changes nothing a reader sees, so it does not change the
 * hash either.
 */
const canonicalCitationSource = (source: RuleCitationSource | null | undefined) => {
  if (source == null || typeof source !== "object") return null
  const out: Record<string, unknown> = {}
  for (const field of RULE_CITATION_SOURCE_FIELDS) out[field] = source[field] ?? null
  return out
}

const canonicalCitation = (citation: RuleCitation) => ({
  source_id: citation.source_id,
  source_sha256: citation.source_sha256,
  source: canonicalCitationSource(citation.source),
  locator: citation.locator,
  quote: citation.quote ?? null,
})

/**
 * Exactly the fields the hash covers, with absent optionals written as null so
 * a row read back from the database (null) and a draft built in memory
 * (undefined) are the same content. Citations stay in their written order:
 * reordering them is a change to what the reviewer was shown. Each citation
 * is hashed with the hash of the file its quote is attributed to and with
 * the copy of that document's details (issuer, title, address, document id
 * and date, notes, retrieval date, archive path) that readers are shown, so
 * none of what a reader sees beside a reviewed rule can change under the
 * sign-off.
 */
export function canonicalRuleContent(content: RuleContent): string {
  return canonicalJson({
    scheme: CONTENT_HASH_SCHEME,
    jurisdiction_code: content.jurisdiction_code,
    program: content.program,
    rule_key: content.rule_key,
    version: content.version,
    kind: content.kind,
    value: content.value ?? null,
    display_text: content.display_text,
    citations: content.citations.map(canonicalCitation),
    effective_from: content.effective_from ?? null,
    effective_note: content.effective_note ?? null,
  })
}

/** Lowercase hex SHA-256 of the canonical form, as UTF-8. */
export function ruleContentSha256(content: RuleContent): string {
  return createHash("sha256").update(canonicalRuleContent(content), "utf8").digest("hex")
}

/** The signed fields of a stored row, for recomputing its hash. */
export function ruleContentOf(row: RuleContent): RuleContent {
  return {
    jurisdiction_code: row.jurisdiction_code,
    program: row.program,
    rule_key: row.rule_key,
    version: Number(row.version),
    kind: row.kind,
    value: row.value ?? null,
    display_text: row.display_text,
    citations: Array.isArray(row.citations) ? row.citations : [],
    effective_from: row.effective_from ?? null,
    effective_note: row.effective_note ?? null,
  }
}
