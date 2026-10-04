import type { Readable } from "node:stream"
import { normalizeEin } from "../ein"
import { readLines } from "./lines"

/**
 * Automatic Revocation of Exemption List (`data-download-revocation.txt`,
 * inside `data-download-revocation.zip`).
 *
 * Confirmed against the live file dated 2026-09-30 (1,247,069 rows; 19,275
 * EINs appear more than once because an org can be revoked, reinstated and
 * revoked again — each event is its own row). Pipe-delimited ASCII, CRLF, two
 * blank leading lines, one blank trailing line. Twelve fields, no header:
 *
 *   EIN | Legal Name | Doing Business As Name | Organization Address | City |
 *   State | ZIP Code | Country | Exemption Type | Revocation Date |
 *   Revocation Posting Date | Exemption Reinstatement Date
 *
 * Dates are `DD-MON-YYYY` ("15-MAY-2013"). Pub 5891 §"Automatic Revocation of
 * Exemption List" defines the three dates: Revocation Date is the effective
 * date (the third missed filing deadline), Posting Date is when the IRS
 * published the org to the list, and a Reinstatement Date means the org has
 * since had its status reinstated — "just because an organization appears in
 * this dataset doesn't mean that the organization is currently revoked".
 *
 * The street address (field 4) is parsed past and never kept; the ZIP is
 * dropped too. City/state and the organisation's own names are org-level.
 */
export type RevocationRow = {
  ein: string
  legal_name: string
  dba_name: string | null
  city: string | null
  state: string | null
  country: string | null
  /** Two-character 501(c) subsection code ("03"), or "00" when unknown. */
  exemption_type: string | null
  revocation_date: Date
  posting_date: Date
  reinstatement_date: Date | null
}

export const REVOCATION_FIELD_COUNT = 12

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
}

/** `DD-MON-YYYY` → UTC midnight, or null when absent/malformed. */
export function parseIrsDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(value.trim().toUpperCase())
  if (!m) return null
  const month = MONTHS[m[2]]
  if (month === undefined) return null
  const day = Number(m[1])
  const year = Number(m[3])
  const date = new Date(Date.UTC(year, month, day))
  // Reject 31-FEB style values that Date.UTC would silently roll over.
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return null
  return date
}

/** One row, or null for a blank/unparseable line. */
export function parseRevocationLine(line: string): RevocationRow | null {
  const trimmed = line.replace(/\r$/, "")
  if (!trimmed.trim()) return null
  const parts = trimmed.split("|")
  if (parts.length !== REVOCATION_FIELD_COUNT) return null
  const ein = normalizeEin(parts[0])
  if (!ein) return null
  const revocation_date = parseIrsDate(parts[9])
  const posting_date = parseIrsDate(parts[10])
  // A revocation without its two defining dates is not a revocation we can
  // reason about; skipping it is safer than inventing a date.
  if (!revocation_date || !posting_date) return null
  return {
    ein,
    legal_name: parts[1].trim(),
    dba_name: parts[2].trim() || null,
    city: parts[4].trim() || null,
    state: parts[5].trim() || null,
    country: parts[7].trim() || null,
    exemption_type: parts[8].trim() || null,
    revocation_date,
    posting_date,
    reinstatement_date: parseIrsDate(parts[11]),
  }
}

export async function* parseRevocationStream(stream: Readable): AsyncGenerator<RevocationRow> {
  for await (const line of readLines(stream)) {
    const row = parseRevocationLine(line)
    if (row) yield row
  }
}
