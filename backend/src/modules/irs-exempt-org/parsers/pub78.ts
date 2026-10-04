import type { Readable } from "node:stream"
import { normalizeEin } from "../ein"
import { readLines } from "./lines"

/**
 * Pub 78 Data (`data-download-pub78.txt`, inside `data-download-pub78.zip`).
 *
 * Confirmed against the live file dated 2026-09-10 (1,419,989 rows, EIN
 * unique). Pipe-delimited ASCII, CRLF, two blank leading lines, one blank
 * trailing line. Six fields, no header:
 *
 *   EIN | Name | City | State | Country | Deductibility Status
 *
 * Deductibility Status is one or more codes separated by commas with no
 * space — "PC", "PF", "EO,LODGE", "EO,GROUP,LODGE", "FORGN,PF" — so it is kept
 * as a list, not a single value. Pub 5891 §"Pub. 78 Data" describes the
 * dataset; it does not enumerate columns, so the order above is what the
 * file itself shows.
 */
export type Pub78Row = {
  ein: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  deductibility_codes: string[]
}

export const PUB78_FIELD_COUNT = 6

/** One row, or null for a blank/unparseable line. */
export function parsePub78Line(line: string): Pub78Row | null {
  const trimmed = line.replace(/\r$/, "")
  if (!trimmed.trim()) return null
  const parts = trimmed.split("|")
  if (parts.length !== PUB78_FIELD_COUNT) return null
  const ein = normalizeEin(parts[0])
  if (!ein) return null
  const codes = parts[5]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
  return {
    ein,
    name: parts[1].trim(),
    city: parts[2].trim() || null,
    state: parts[3].trim() || null,
    country: parts[4].trim() || null,
    deductibility_codes: codes,
  }
}

export async function* parsePub78Stream(stream: Readable): AsyncGenerator<Pub78Row> {
  for await (const line of readLines(stream)) {
    const row = parsePub78Line(line)
    if (row) yield row
  }
}
