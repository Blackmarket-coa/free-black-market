/**
 * Partner directory — refer-out only.
 *
 * FBM does not lend, broker, or intermediate. A directory entry is a page a
 * vendor can act on today, with nothing of theirs leaving FBM to reach it
 * (`docs/POSTURE_A_COMPLIANCE.md` rule 6; `docs/CDFI_COOP_ROADMAP.md` §3.2).
 */

export const PARTNER_KINDS = [
  "cdfi",
  "credit_union",
  "community_bank",
  "microlender",
  "crowdfunder",
  "legal",
  "back_office",
  // Certifiers, inspection programs and the agencies behind them — the
  // compliance quest's gatekeepers (§3.6). A vendor is certified by these,
  // never by FBM.
  "certifier",
  // Reserved for the fiscal-sponsorship pathway (§3.3); seeded from the
  // fiscal-sponsor registry's display fields when that quest ships.
  "fiscal_sponsor",
] as const
export type PartnerKind = (typeof PARTNER_KINDS)[number]

export const PARTNER_SERVES = ["sole_proprietor", "cooperative", "nonprofit", "farm"] as const
export type PartnerServes = (typeof PARTNER_SERVES)[number]

export type PartnerEntry = {
  /** Stable registry key; also the id the storefront and quests refer to. */
  key: string
  name: string
  /** The page the vendor acts on. Always https. */
  url: string
  /** One line, shown beside the name. */
  tagline: string
  kind: PartnerKind
  /** Two-letter USPS state codes, or "national". */
  states: "national" | readonly string[]
  serves: readonly PartnerServes[]
  /** Free text: what the partner actually offers. */
  products: string
  /**
   * Set when the site answered automated requests with a block (403/503) at
   * curation time, so the URL could not be machine-verified. A reviewer
   * clicks it once; the drift test only checks shape for these entries.
   */
  unverified_reason?: string
}

export type PartnerFilters = {
  kind?: PartnerKind | readonly PartnerKind[]
  /** Two-letter USPS state code; national entries always match. */
  state?: string
  serves?: PartnerServes
}

export function isPartnerKind(value: unknown): value is PartnerKind {
  return typeof value === "string" && (PARTNER_KINDS as readonly string[]).includes(value)
}

export function isPartnerServes(value: unknown): value is PartnerServes {
  return typeof value === "string" && (PARTNER_SERVES as readonly string[]).includes(value)
}
