import type { IrsSource } from "./sources"

/**
 * The lookup contract, as a pure function over rows the service has already
 * read. Kept separate so the precedence rules can be tested exhaustively
 * without a database, and so they live in exactly one place.
 *
 * Four states, never a boolean (docs/BMC_SURVIVAL_PROGRAMS.md §2 item 1;
 * docs/legal/checkpoints.md L11):
 *
 * - `not_found`      — in none of the three files. This is **not** "not a
 *                      charity": churches and group-ruling subordinates are
 *                      eligible and unlisted. `as_of` is the newest file date
 *                      we hold so the caller can say "not found in the IRS
 *                      files dated X".
 * - `revoked`        — the Automatic Revocation list carries a current
 *                      (un-reinstated) revocation for the EIN.
 * - `pub78_eligible` — listed in Pub 78 as eligible for deductible
 *                      contributions.
 * - `bmf_only`       — in the Business Master File but not in Pub 78 (a
 *                      501(c)(4), say, or an org that never sought a §170
 *                      determination). Says nothing about deductibility.
 *
 * Every state's `as_of` is the `Last-Modified` of the specific file that
 * produced it — the pub78 snapshot for `pub78_eligible`, the revocation
 * snapshot for `revoked`, the BMF snapshot for `bmf_only`. A fact borrowed
 * from another file names that file too: `pub78_eligible.subsection` comes
 * from the BMF, so it travels with `subsection_as_of` (the BMF snapshot's
 * date, null when no BMF file has been ingested) rather than being read
 * under the Pub 78 date (L11: every surfaced fact says which file it came
 * from).
 *
 * Precedence between a current revocation and the other two files is
 * **deliberately asymmetric**, and this is the default S8 / counsel should
 * revisit rather than a derived rule:
 *
 * - vs. Pub 78: the revocation wins only when its posting date is newer
 *   than the Pub 78 file we hold. A Pub 78 file published *after* the
 *   posting that still lists the org is treated as the IRS keeping it listed
 *   knowing of the revocation, and the newer file is deferred to.
 * - vs. the BMF: the revocation wins **unconditionally**, however new the
 *   BMF file is and whatever its `status` code says (a status-01 row in a
 *   newer BMF does not clear a standing revocation). Reasoning: Pub 78 is
 *   the IRS's own eligibility determination and is what a revocation
 *   removes an org from, so a newer Pub 78 listing is direct evidence; the
 *   BMF `status` field is a filing-system code that has been observed to
 *   lag the revocation list, so it is not given the power to override one.
 *   Only a `reinstatement_date` on the newest revocation row clears it
 *   (`currentRevocation`).
 *
 * The behaviour is pinned by `__tests__/lookup.unit.spec.ts`; change the
 * rule there and here together, with the counsel reference.
 */
export type IrsSourcesAsOf = Record<IrsSource, Date | null>

export type IrsLookupResult =
  | {
      state: "not_found"
      ein: string
      as_of: Date | null
      sources_as_of: IrsSourcesAsOf
    }
  | {
      state: "revoked"
      ein: string
      revoked_on: Date
      posted_on: Date
      exemption_type: string | null
      as_of: Date | null
    }
  | {
      state: "pub78_eligible"
      ein: string
      deductibility_codes: string[]
      /** From the BMF, not Pub 78; null when the BMF does not carry the EIN. */
      subsection: string | null
      /** Date of the BMF file `subsection` was read from; null when none is ingested. */
      subsection_as_of: Date | null
      as_of: Date | null
    }
  | {
      state: "bmf_only"
      ein: string
      subsection: string | null
      status: string | null
      as_of: Date | null
    }

export type IrsLookupState = IrsLookupResult["state"]

export type Pub78Record = { deductibility_codes: string }
export type RevocationRecord = {
  revocation_date: Date | string
  posting_date: Date | string
  reinstatement_date: Date | string | null
  exemption_type: string | null
}
export type BmfRecord = { subsection: string | null; status: string | null }

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v))

/**
 * The revocation that currently stands for an EIN, or null.
 *
 * The list holds one row per event, so an org revoked in 2013, reinstated in
 * 2015 and revoked again in 2018 has two rows. The newest posting is the one
 * that speaks for the org's present state; if that row carries a
 * reinstatement date the IRS has reinstated the org and the revocation is
 * history, not status (Pub 5891: "just because an organization appears in
 * this dataset doesn't mean that the organization is currently revoked").
 */
export function currentRevocation<T extends RevocationRecord>(rows: readonly T[]): T | null {
  if (!rows.length) return null
  let newest = rows[0]
  for (const row of rows.slice(1)) {
    const a = asDate(row.posting_date).getTime()
    const b = asDate(newest.posting_date).getTime()
    if (a > b || (a === b && asDate(row.revocation_date) > asDate(newest.revocation_date))) {
      newest = row
    }
  }
  return newest.reinstatement_date ? null : newest
}

export function resolveIrsLookup(input: {
  ein: string
  pub78: Pub78Record | null
  revocations: readonly RevocationRecord[]
  bmf: BmfRecord | null
  asOf: IrsSourcesAsOf
}): IrsLookupResult {
  const { ein, pub78, bmf, asOf } = input
  const revocation = currentRevocation(input.revocations)

  if (revocation) {
    const postedOn = asDate(revocation.posting_date)
    // Revoked wins over a Pub 78 listing only when the revocation was posted
    // after the Pub 78 file we hold was published: that file could not have
    // reflected it. If Pub 78 is newer and still lists the org, the IRS has
    // kept it listed knowing of the revocation and we defer to the newer file.
    // No such comparison is made against the BMF: with no Pub 78 listing a
    // standing revocation wins whatever the BMF says (see the header).
    const pub78Older = !pub78 || !asOf.pub78 || postedOn.getTime() > asOf.pub78.getTime()
    if (pub78Older) {
      return {
        state: "revoked",
        ein,
        revoked_on: asDate(revocation.revocation_date),
        posted_on: postedOn,
        exemption_type: revocation.exemption_type ?? null,
        as_of: asOf.revocation,
      }
    }
  }

  if (pub78) {
    return {
      state: "pub78_eligible",
      ein,
      deductibility_codes: pub78.deductibility_codes
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      subsection: bmf?.subsection ?? null,
      subsection_as_of: asOf.eo_bmf,
      as_of: asOf.pub78,
    }
  }

  if (bmf) {
    return {
      state: "bmf_only",
      ein,
      subsection: bmf.subsection ?? null,
      status: bmf.status ?? null,
      as_of: asOf.eo_bmf,
    }
  }

  const dates = Object.values(asOf).filter((d): d is Date => d instanceof Date)
  const newest = dates.length
    ? dates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
    : null
  return { state: "not_found", ein, as_of: newest, sources_as_of: asOf }
}
