/**
 * What a vault document currently proves, as the panel shows it.
 *
 * `GET /vendor/vault` has returned `effective_status` ("unverified" |
 * "verified" | "expired") and `days_until_expiry` since 2026-09-03; until
 * 2026-09-06 the table ignored both and rendered the stored `verified` flag,
 * so a lapsed insurance certificate still read "Verified" here while every
 * quest predicate had already stopped counting it. The stored flag is a fact
 * about a past check; the status is what the document is worth today.
 */

export type EffectiveDocumentStatus = "unverified" | "verified" | "expired"

export interface VaultStatusSource {
  verified: boolean
  expires_at?: string | null
  effective_status?: EffectiveDocumentStatus | null
  days_until_expiry?: number | null
}

export type VaultStatusBadge = {
  label: string
  color: "green" | "orange" | "red" | "grey"
}

/** Verified documents whose coverage closes within this many days get a warning. */
export const EXPIRY_WARNING_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Prefer the API's derived fields; fall back to deriving from the row so an
 * older response shape still renders honestly rather than as "Verified".
 */
export function resolveVaultStatus(
  doc: VaultStatusSource,
  now: Date = new Date()
): { status: EffectiveDocumentStatus; daysUntilExpiry: number | null } {
  const expires = doc.expires_at ? new Date(doc.expires_at) : null
  const validExpiry = expires && !Number.isNaN(expires.getTime()) ? expires : null

  const daysUntilExpiry =
    typeof doc.days_until_expiry === "number"
      ? doc.days_until_expiry
      : validExpiry
        ? Math.floor((validExpiry.getTime() - now.getTime()) / DAY_MS)
        : null

  let status: EffectiveDocumentStatus
  if (doc.effective_status) {
    status = doc.effective_status
  } else if (!doc.verified) {
    status = "unverified"
  } else if (validExpiry && now.getTime() > validExpiry.getTime()) {
    status = "expired"
  } else {
    status = "verified"
  }

  return { status, daysUntilExpiry }
}

export function describeVaultStatus(
  doc: VaultStatusSource,
  now: Date = new Date()
): VaultStatusBadge {
  const { status, daysUntilExpiry } = resolveVaultStatus(doc, now)

  if (status === "expired") return { label: "Expired", color: "red" }
  if (status === "unverified") return { label: "Unverified", color: "grey" }

  if (daysUntilExpiry !== null && daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
    const label =
      daysUntilExpiry <= 0
        ? "Verified · expires today"
        : `Verified · expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}`
    return { label, color: "orange" }
  }

  return { label: "Verified", color: "green" }
}
