/**
 * EIN normalisation.
 *
 * The IRS bulk files carry EINs as zero-padded nine-character strings
 * ("000019818", "001347537"). Everything that reaches us from elsewhere is
 * messier: "12-3456789" from a determination letter, "123456789" typed in,
 * 1347537 after a spreadsheet stripped the leading zeros. All of those must
 * land on the same nine characters or the lookup silently misses an org that
 * is in the file. Stored and compared as TEXT, never as an integer, for the
 * same reason.
 */

/** Nine zero-padded digits, or null when the input cannot be an EIN. */
export function normalizeEin(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const raw = typeof input === "number" ? String(input) : input
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Accept the conventional "12-3456789", and tolerate stray whitespace.
  const digits = trimmed.replace(/[-\s]/g, "")
  if (!/^\d{1,9}$/.test(digits)) return null
  const padded = digits.padStart(9, "0")
  if (padded === "000000000") return null
  return padded
}

/** "12-3456789" for display. Input must already be normalised. */
export function formatEin(ein: string): string {
  return `${ein.slice(0, 2)}-${ein.slice(2)}`
}
