import type { Readable } from "node:stream"
import { normalizeEin } from "../ein"
import { readLines, splitDelimited } from "./lines"

/**
 * Exempt Organizations Business Master File extract (`eo1.csv` … `eo4.csv`,
 * `eo_xx.csv`).
 *
 * Confirmed against the live `eo_xx.csv` dated 2026-09-07. Comma-delimited
 * with one header row; 28 columns:
 *
 *   EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,AFFILIATION,
 *   CLASSIFICATION,RULING,DEDUCTIBILITY,FOUNDATION,ACTIVITY,ORGANIZATION,
 *   STATUS,TAX_PERIOD,ASSET_CD,INCOME_CD,FILING_REQ_CD,PF_FILING_REQ_CD,
 *   ACCT_PD,ASSET_AMT,INCOME_AMT,REVENUE_AMT,NTEE_CD,SORT_NAME
 *
 * The parser is header-driven, so a column being added or reordered upstream
 * does not silently shift values into the wrong field; a file whose header
 * lacks a retained column is refused outright.
 *
 * Retained: EIN, NAME, CITY, STATE, ZIP (first five), SUBSECTION,
 * CLASSIFICATION, RULING, DEDUCTIBILITY, FOUNDATION, STATUS, NTEE_CD,
 * SORT_NAME. **ICO ("in care of", a person's name) and STREET are never read
 * out of the row** — PII minimisation (docs/BMC_SURVIVAL_PROGRAMS.md §5). The
 * financial columns are dropped as unneeded.
 */
export type EoBmfRow = {
  ein: string
  name: string
  city: string | null
  state: string | null
  zip5: string | null
  subsection: string | null
  classification: string | null
  ruling: string | null
  deductibility: string | null
  foundation: string | null
  status: string | null
  ntee_cd: string | null
  sort_name: string | null
}

export const EO_BMF_REQUIRED_COLUMNS = [
  "EIN", "NAME", "CITY", "STATE", "ZIP", "SUBSECTION", "CLASSIFICATION",
  "RULING", "DEDUCTIBILITY", "FOUNDATION", "STATUS", "NTEE_CD", "SORT_NAME",
] as const

type ColumnIndex = Record<(typeof EO_BMF_REQUIRED_COLUMNS)[number], number>

/** Column positions from the header line; throws when a retained column is missing. */
export function parseEoBmfHeader(line: string): ColumnIndex {
  const names = splitDelimited(line.replace(/^\uFEFF/, "").replace(/\r$/, ""), ",").map((n) =>
    n.trim().toUpperCase()
  )
  const index = {} as ColumnIndex
  for (const col of EO_BMF_REQUIRED_COLUMNS) {
    const at = names.indexOf(col)
    if (at < 0) throw new Error(`eo-bmf: header is missing required column ${col}`)
    index[col] = at
  }
  return index
}

const opt = (v: string | undefined): string | null => {
  const t = (v ?? "").trim()
  return t ? t : null
}

/** One data row, or null for a blank/unparseable line. */
export function parseEoBmfLine(line: string, columns: ColumnIndex): EoBmfRow | null {
  const trimmed = line.replace(/\r$/, "")
  if (!trimmed.trim()) return null
  const parts = splitDelimited(trimmed, ",")
  const ein = normalizeEin(parts[columns.EIN])
  if (!ein) return null
  const zip = opt(parts[columns.ZIP])
  return {
    ein,
    name: (parts[columns.NAME] ?? "").trim(),
    city: opt(parts[columns.CITY]),
    state: opt(parts[columns.STATE]),
    zip5: zip ? zip.slice(0, 5) : null,
    subsection: opt(parts[columns.SUBSECTION]),
    classification: opt(parts[columns.CLASSIFICATION]),
    ruling: opt(parts[columns.RULING]),
    deductibility: opt(parts[columns.DEDUCTIBILITY]),
    foundation: opt(parts[columns.FOUNDATION]),
    status: opt(parts[columns.STATUS]),
    ntee_cd: opt(parts[columns.NTEE_CD]),
    sort_name: opt(parts[columns.SORT_NAME]),
  }
}

export async function* parseEoBmfStream(stream: Readable): AsyncGenerator<EoBmfRow> {
  let columns: ColumnIndex | null = null
  for await (const line of readLines(stream)) {
    if (!columns) {
      if (!line.trim()) continue
      columns = parseEoBmfHeader(line)
      continue
    }
    const row = parseEoBmfLine(line, columns)
    if (row) yield row
  }
  if (!columns) throw new Error("eo-bmf: file has no header row")
}
