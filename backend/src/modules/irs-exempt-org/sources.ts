/**
 * The three IRS bulk files this module ingests, and where they live.
 *
 * Hosts are fixed in code and are the only thing `shared/stream-download.ts`
 * will fetch from. They are a data source, not a jurisdiction rule: FBM reads
 * what the IRS publishes and shows its date; it never decides anything about
 * where an org must be.
 *
 * Formats confirmed against the live files on 2026-10-03 (see the parser
 * headers for the column orders observed).
 */
export const IRS_SOURCES = ["pub78", "revocation", "eo_bmf"] as const
export type IrsSource = (typeof IRS_SOURCES)[number]

export const IRS_SOURCE_URLS: Record<IrsSource, readonly string[]> = {
  /** Zip containing `data-download-pub78.txt`, pipe-delimited. Monthly, 2nd Tuesday. */
  pub78: ["https://apps.irs.gov/pub/epostcard/data-download-pub78.zip"],
  /** Zip containing `data-download-revocation.txt`, pipe-delimited. */
  revocation: ["https://apps.irs.gov/pub/epostcard/data-download-revocation.zip"],
  /** Five CSVs, one header row each, with the same 28 columns. */
  eo_bmf: [
    "https://www.irs.gov/pub/irs-soi/eo1.csv",
    "https://www.irs.gov/pub/irs-soi/eo2.csv",
    "https://www.irs.gov/pub/irs-soi/eo3.csv",
    "https://www.irs.gov/pub/irs-soi/eo4.csv",
    "https://www.irs.gov/pub/irs-soi/eo_xx.csv",
  ],
}

export function isIrsSource(value: unknown): value is IrsSource {
  return typeof value === "string" && (IRS_SOURCES as readonly string[]).includes(value)
}
