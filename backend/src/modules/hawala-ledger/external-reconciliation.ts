/**
 * External reconciliation engine — pure logic.
 *
 * Matches external money records (Stripe payouts/charges, bank statement
 * lines, Stellar payments) against ledger entries. This module is
 * deliberately free of I/O: the service layer fetches records, derives a
 * SQL prefilter from `deriveCandidateBounds`, and hands candidate entries
 * to `reconcileRecords`, which evaluates rules exactly and claims matches.
 *
 * Semantics (ported from the Blnk Finance reference with its known traps
 * fixed — see docs/REPO_CONSOLIDATION_REVIEW.md §5):
 * - AND across the criteria within a rule; OR across rules — the first
 *   rule whose every criterion passes claims the match.
 * - All amount math is integer cents. Tolerances are inclusive bounds.
 * - Unknown criterion kinds are a validation error at write time, never a
 *   silent rule failure at match time.
 * - One ledger entry is claimed at most once per run.
 * - matched + unmatched always equals the input count.
 */

export type MatchingCriterion =
  | { kind: "amount"; tolerance_cents?: number; tolerance_bps?: number }
  | { kind: "reference"; mode: "exact" | "normalized" }
  | { kind: "date"; window_seconds: number }
  | { kind: "currency" }

export interface MatchingRuleInput {
  id: string
  criteria: MatchingCriterion[]
}

/** The slice of an external record the engine needs. */
export interface ExternalRecordInput {
  id: string
  external_id: string
  amount_cents: number
  currency_code: string
  reference: string | null
  occurred_at: Date | string
}

/**
 * A candidate ledger entry, pre-converted by the caller: `amount_cents`
 * is the entry's NUMERIC dollar amount times 100, rounded — the engine
 * never sees floats.
 */
export interface EntryCandidate {
  id: string
  amount_cents: number
  currency_code: string
  reference_id: string | null
  idempotency_key: string | null
  correlation_id?: string | null
  created_at: Date | string
}

export interface MatchResult {
  external_record_id: string
  ledger_entry_id: string
  matched_by_rule_id: string
  /** external minus internal, signed cents — the audited tolerance drift. */
  amount_delta_cents: number
}

export interface ReconcileOutcome {
  matches: MatchResult[]
  unmatched_external_ids: string[]
}

const CRITERION_KINDS = ["amount", "reference", "date", "currency"] as const

/**
 * Validate a rule's criteria payload (e.g. from the DB JSON column or an
 * admin request). Throws with a precise message on any malformed
 * criterion — this is what keeps "unknown field silently fails the rule"
 * out of the system.
 */
export function validateCriteria(input: unknown): MatchingCriterion[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Matching rule needs a non-empty criteria array")
  }
  return input.map((raw, i) => {
    const c = raw as Record<string, unknown>
    const kind = c?.kind
    if (typeof kind !== "string" || !CRITERION_KINDS.includes(kind as any)) {
      throw new Error(
        `criteria[${i}]: unknown kind ${JSON.stringify(kind)} (expected one of ${CRITERION_KINDS.join(", ")})`
      )
    }
    switch (kind) {
      case "amount": {
        const cents = c.tolerance_cents
        const bps = c.tolerance_bps
        if (cents !== undefined && (!Number.isInteger(cents) || (cents as number) < 0)) {
          throw new Error(`criteria[${i}]: tolerance_cents must be a non-negative integer`)
        }
        if (bps !== undefined && (!Number.isInteger(bps) || (bps as number) < 0 || (bps as number) > 10000)) {
          throw new Error(`criteria[${i}]: tolerance_bps must be an integer in 0..10000`)
        }
        return {
          kind: "amount",
          ...(cents !== undefined ? { tolerance_cents: cents as number } : {}),
          ...(bps !== undefined ? { tolerance_bps: bps as number } : {}),
        }
      }
      case "reference": {
        const mode = c.mode
        if (mode !== "exact" && mode !== "normalized") {
          throw new Error(`criteria[${i}]: reference mode must be "exact" or "normalized"`)
        }
        return { kind: "reference", mode }
      }
      case "date": {
        const w = c.window_seconds
        if (!Number.isInteger(w) || (w as number) < 0) {
          throw new Error(`criteria[${i}]: window_seconds must be a non-negative integer`)
        }
        return { kind: "date", window_seconds: w as number }
      }
      case "currency":
        return { kind: "currency" }
      default:
        // Unreachable — the kind check above already threw.
        throw new Error(`criteria[${i}]: unknown kind`)
    }
  })
}

/** Lowercase and strip everything but letters and digits. */
export function normalizeReference(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/**
 * The inclusive cents tolerance for an amount criterion against a given
 * internal amount: the larger of the absolute and the basis-point
 * tolerance (both default to 0 = exact).
 */
export function amountToleranceCents(
  criterion: Extract<MatchingCriterion, { kind: "amount" }>,
  internalCents: number
): number {
  const abs = criterion.tolerance_cents ?? 0
  const bps = criterion.tolerance_bps
    ? Math.floor((Math.abs(internalCents) * criterion.tolerance_bps) / 10000)
    : 0
  return Math.max(abs, bps)
}

export function criterionMatches(
  criterion: MatchingCriterion,
  external: ExternalRecordInput,
  entry: EntryCandidate
): boolean {
  switch (criterion.kind) {
    case "amount": {
      // Ledger entry amounts are always positive with direction encoded by
      // debit/credit; external records may be signed (a payout is negative
      // on a Stripe balance report). Compare magnitudes.
      const ext = Math.abs(external.amount_cents)
      const int = Math.abs(entry.amount_cents)
      return Math.abs(ext - int) <= amountToleranceCents(criterion, int)
    }
    case "reference": {
      if (!external.reference) return false
      const candidates = [entry.reference_id, entry.idempotency_key, entry.correlation_id ?? null]
      if (criterion.mode === "exact") {
        return candidates.some((c) => c !== null && c !== undefined && c === external.reference)
      }
      const norm = normalizeReference(external.reference)
      if (norm.length === 0) return false
      return candidates.some(
        (c) => c !== null && c !== undefined && normalizeReference(c) === norm
      )
    }
    case "date": {
      const diffMs = Math.abs(toMs(external.occurred_at) - toMs(entry.created_at))
      return diffMs <= criterion.window_seconds * 1000
    }
    case "currency":
      return external.currency_code.toUpperCase() === entry.currency_code.toUpperCase()
  }
}

export function ruleMatches(
  rule: MatchingRuleInput,
  external: ExternalRecordInput,
  entry: EntryCandidate
): boolean {
  return rule.criteria.every((c) => criterionMatches(c, external, entry))
}

export interface CandidateBounds {
  /** Inclusive absolute-cents range; null when no amount criterion constrains it. */
  min_cents: number | null
  max_cents: number | null
  /** Inclusive entry created_at window; null when no date criterion constrains it. */
  date_from: Date | null
  date_to: Date | null
}

/**
 * Derive the widest SQL prefilter across all rules for one external
 * record — the union of every rule's amount tolerance and date window, so
 * the exact in-memory evaluation only sees plausible candidates. Rules
 * without an amount (or date) criterion leave that dimension unbounded.
 */
export function deriveCandidateBounds(
  rules: MatchingRuleInput[],
  external: ExternalRecordInput
): CandidateBounds {
  const extCents = Math.abs(external.amount_cents)
  const extMs = toMs(external.occurred_at)

  let minCents: number | null = null
  let maxCents: number | null = null
  let dateFrom: number | null = null
  let dateTo: number | null = null
  let everyRuleBoundsAmount = rules.length > 0
  let everyRuleBoundsDate = rules.length > 0

  for (const rule of rules) {
    const amount = rule.criteria.find((c) => c.kind === "amount") as
      | Extract<MatchingCriterion, { kind: "amount" }>
      | undefined
    if (amount) {
      // Tolerance is defined relative to the internal amount, which is
      // unknown at prefilter time; bounding with the external amount is
      // correct to within one cent of rounding, so widen by 1.
      const tol = amountToleranceCents(amount, extCents) + 1
      minCents = minCents === null ? extCents - tol : Math.min(minCents, extCents - tol)
      maxCents = maxCents === null ? extCents + tol : Math.max(maxCents, extCents + tol)
    } else {
      everyRuleBoundsAmount = false
    }

    const date = rule.criteria.find((c) => c.kind === "date") as
      | Extract<MatchingCriterion, { kind: "date" }>
      | undefined
    if (date) {
      const w = date.window_seconds * 1000
      dateFrom = dateFrom === null ? extMs - w : Math.min(dateFrom, extMs - w)
      dateTo = dateTo === null ? extMs + w : Math.max(dateTo, extMs + w)
    } else {
      everyRuleBoundsDate = false
    }
  }

  return {
    min_cents: everyRuleBoundsAmount && minCents !== null ? Math.max(0, minCents) : null,
    max_cents: everyRuleBoundsAmount && maxCents !== null ? maxCents : null,
    date_from: everyRuleBoundsDate && dateFrom !== null ? new Date(dateFrom) : null,
    date_to: everyRuleBoundsDate && dateTo !== null ? new Date(dateTo) : null,
  }
}

/**
 * Match one batch of external records against their candidate entries.
 *
 * `candidatesFor` supplies the (already prefiltered) candidate entries
 * for one external record; the engine sorts them deterministically
 * (created_at, then id), evaluates rules in order, and claims each entry
 * at most once across the whole run. Every input record lands in exactly
 * one of matches / unmatched — the invariant is asserted, not assumed.
 */
export function reconcileRecords(
  externals: ExternalRecordInput[],
  rules: MatchingRuleInput[],
  candidatesFor: (external: ExternalRecordInput) => EntryCandidate[]
): ReconcileOutcome {
  const matches: MatchResult[] = []
  const unmatched: string[] = []
  const claimedEntryIds = new Set<string>()

  for (const external of externals) {
    const candidates = [...candidatesFor(external)].sort((a, b) => {
      const at = toMs(a.created_at)
      const bt = toMs(b.created_at)
      if (at !== bt) return at - bt
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

    let matched: MatchResult | null = null
    for (const rule of rules) {
      for (const entry of candidates) {
        if (claimedEntryIds.has(entry.id)) continue
        if (ruleMatches(rule, external, entry)) {
          matched = {
            external_record_id: external.id,
            ledger_entry_id: entry.id,
            matched_by_rule_id: rule.id,
            amount_delta_cents:
              Math.abs(external.amount_cents) - Math.abs(entry.amount_cents),
          }
          claimedEntryIds.add(entry.id)
          break
        }
      }
      if (matched) break
    }

    if (matched) {
      matches.push(matched)
    } else {
      unmatched.push(external.id)
    }
  }

  if (matches.length + unmatched.length !== externals.length) {
    // Structurally unreachable; kept so a future edit can never silently
    // drop an input record (the Blnk "no group batch processed" bug class).
    throw new Error(
      `Reconciliation invariant violated: ${matches.length} matched + ${unmatched.length} unmatched != ${externals.length} inputs`
    )
  }

  return { matches, unmatched_external_ids: unmatched }
}
