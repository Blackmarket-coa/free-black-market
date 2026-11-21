/**
 * The fifty states and the District of Columbia, by ISO 3166-2 code.
 *
 * Jurisdiction codes are ISO 3166-2 everywhere in the Plates pilot
 * (`docs/PLATES_SC_PILOT_PLAN.md` section 2), the same codes the vendor panel
 * already uses for its state picker (`vendor-panel/src/lib/data/country-states.ts`).
 * Territories are left out on purpose: the panel lists them, but no rule
 * program here has been read for one.
 */
export const US_JURISDICTIONS = [
  { code: "US-AL", postal: "AL", name: "Alabama" },
  { code: "US-AK", postal: "AK", name: "Alaska" },
  { code: "US-AZ", postal: "AZ", name: "Arizona" },
  { code: "US-AR", postal: "AR", name: "Arkansas" },
  { code: "US-CA", postal: "CA", name: "California" },
  { code: "US-CO", postal: "CO", name: "Colorado" },
  { code: "US-CT", postal: "CT", name: "Connecticut" },
  { code: "US-DE", postal: "DE", name: "Delaware" },
  { code: "US-DC", postal: "DC", name: "District of Columbia" },
  { code: "US-FL", postal: "FL", name: "Florida" },
  { code: "US-GA", postal: "GA", name: "Georgia" },
  { code: "US-HI", postal: "HI", name: "Hawaii" },
  { code: "US-ID", postal: "ID", name: "Idaho" },
  { code: "US-IL", postal: "IL", name: "Illinois" },
  { code: "US-IN", postal: "IN", name: "Indiana" },
  { code: "US-IA", postal: "IA", name: "Iowa" },
  { code: "US-KS", postal: "KS", name: "Kansas" },
  { code: "US-KY", postal: "KY", name: "Kentucky" },
  { code: "US-LA", postal: "LA", name: "Louisiana" },
  { code: "US-ME", postal: "ME", name: "Maine" },
  { code: "US-MD", postal: "MD", name: "Maryland" },
  { code: "US-MA", postal: "MA", name: "Massachusetts" },
  { code: "US-MI", postal: "MI", name: "Michigan" },
  { code: "US-MN", postal: "MN", name: "Minnesota" },
  { code: "US-MS", postal: "MS", name: "Mississippi" },
  { code: "US-MO", postal: "MO", name: "Missouri" },
  { code: "US-MT", postal: "MT", name: "Montana" },
  { code: "US-NE", postal: "NE", name: "Nebraska" },
  { code: "US-NV", postal: "NV", name: "Nevada" },
  { code: "US-NH", postal: "NH", name: "New Hampshire" },
  { code: "US-NJ", postal: "NJ", name: "New Jersey" },
  { code: "US-NM", postal: "NM", name: "New Mexico" },
  { code: "US-NY", postal: "NY", name: "New York" },
  { code: "US-NC", postal: "NC", name: "North Carolina" },
  { code: "US-ND", postal: "ND", name: "North Dakota" },
  { code: "US-OH", postal: "OH", name: "Ohio" },
  { code: "US-OK", postal: "OK", name: "Oklahoma" },
  { code: "US-OR", postal: "OR", name: "Oregon" },
  { code: "US-PA", postal: "PA", name: "Pennsylvania" },
  { code: "US-RI", postal: "RI", name: "Rhode Island" },
  { code: "US-SC", postal: "SC", name: "South Carolina" },
  { code: "US-SD", postal: "SD", name: "South Dakota" },
  { code: "US-TN", postal: "TN", name: "Tennessee" },
  { code: "US-TX", postal: "TX", name: "Texas" },
  { code: "US-UT", postal: "UT", name: "Utah" },
  { code: "US-VT", postal: "VT", name: "Vermont" },
  { code: "US-VA", postal: "VA", name: "Virginia" },
  { code: "US-WA", postal: "WA", name: "Washington" },
  { code: "US-WV", postal: "WV", name: "West Virginia" },
  { code: "US-WI", postal: "WI", name: "Wisconsin" },
  { code: "US-WY", postal: "WY", name: "Wyoming" },
] as const

export type UsJurisdictionCode = (typeof US_JURISDICTIONS)[number]["code"]

const BY_CODE = new Map<string, (typeof US_JURISDICTIONS)[number]>(US_JURISDICTIONS.map((j) => [j.code, j]))
const BY_POSTAL = new Map<string, UsJurisdictionCode>(US_JURISDICTIONS.map((j) => [j.postal, j.code]))

/** Lowercase, punctuation to spaces, single spaces: "S. Carolina," and "s carolina" compare equal. */
const squash = (value: string) =>
  value
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const BY_NAME = new Map<string, UsJurisdictionCode>([
  ...US_JURISDICTIONS.map((j): [string, UsJurisdictionCode] => [squash(j.name), j.code]),
  // The panel's own label for the District, and the ways people write it.
  ["washington dc", "US-DC"],
  ["washington d c", "US-DC"],
])

/**
 * The ISO 3166-2 code for a US state as a person or a form wrote it, or null.
 *
 * Reads the ISO code in any case (`us-sc`), the two-letter postal code with or
 * without periods and spaces (`SC`, `S.C.`, `s c`), and the full name in any
 * case and spacing (`South Carolina`). Anything else is null, never a guess: a
 * county, a city, a misspelling and an abbreviation that is not the postal
 * code (`S. Car.`, `Calif.`) are all "not a state this reads", and the caller
 * shows that as not covered.
 */
export function normalizeUsJurisdiction(input: unknown): UsJurisdictionCode | null {
  if (typeof input !== "string") return null
  const text = squash(input)
  if (!text) return null

  const byName = BY_NAME.get(text)
  if (byName) return byName

  // "us-sc", "us sc", "sc", "s c" -> "SC"
  const letters = text.replace(/^us[\s-]+(?=[a-z]\s?[a-z]$)/, "").replace(/\s/g, "")
  if (/^[a-z]{2}$/.test(letters)) return BY_POSTAL.get(letters.toUpperCase()) ?? null

  return null
}

/** The state's name for a code this module knows, or null. */
export function usJurisdictionName(code: string): string | null {
  return BY_CODE.get(code)?.name ?? null
}

export function isUsJurisdictionCode(code: unknown): code is UsJurisdictionCode {
  return typeof code === "string" && BY_CODE.has(code)
}
