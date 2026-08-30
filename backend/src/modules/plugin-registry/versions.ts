import { compareSemverPrecedence } from "./compat"

/**
 * Pure decision logic for the `plugin_version` history (W3). Kept free of
 * I/O (the compat.ts/hooks.ts idiom) so ordering and idempotency rules are
 * containerless-testable; the service supplies the rows.
 */

export type VersionRowLike = {
  version: string
  code_sha256?: string | null
  yanked_at?: Date | string | null
}

/**
 * Highest-precedence non-yanked row (full SemVer §11, prerelease-aware).
 * Rows with unparseable versions sort below every parseable one; ties keep
 * the first-seen row. Null when nothing resolvable remains.
 */
export function pickLatest<T extends VersionRowLike>(
  rows: readonly T[],
  opts: { includeYanked?: boolean } = {}
): T | null {
  let best: T | null = null
  for (const row of rows) {
    if (!opts.includeYanked && row.yanked_at) {
      continue
    }
    if (!best) {
      best = row
      continue
    }
    const cmp = compareSemverPrecedence(row.version, best.version)
    if (cmp === 1) {
      best = row
    } else if (cmp === null) {
      // One side unparseable: prefer whichever parses; keep best on ties.
      const rowParses = compareSemverPrecedence(row.version, row.version) === 0
      const bestParses = compareSemverPrecedence(best.version, best.version) === 0
      if (rowParses && !bestParses) {
        best = row
      }
    }
  }
  return best
}

export type RecordVersionDecision = "create" | "already-recorded" | "conflict"

/**
 * Versions are immutable: no existing row → create; an existing row with the
 * SAME artifact hash → idempotent retry (already-recorded); a different hash
 * under the same version → conflict (republish must bump the version).
 */
export function decideRecordVersion(
  existing: VersionRowLike | null | undefined,
  incoming: { code_sha256?: string | null }
): RecordVersionDecision {
  if (!existing) {
    return "create"
  }
  const a = existing.code_sha256 ?? null
  const b = incoming.code_sha256 ?? null
  return a === b ? "already-recorded" : "conflict"
}
