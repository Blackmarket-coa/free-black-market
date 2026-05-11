/**
 * Fiscal-sponsor registry.
 *
 * FBM does not maintain the donor-recipient relationship directly — a
 * 501(c)(3) fiscal sponsor receives donations of record, issues donor
 * receipts, and handles state charity registration. This module is the
 * single source of truth for which sponsors FBM knows how to route to,
 * which one is the active default, and what display copy to surface to
 * donors.
 *
 * The active sponsor is selected via env (FBM_FISCAL_SPONSOR_PROVIDER).
 * A registry entry encodes:
 *   - display fields safe to surface to the storefront
 *     (`name`, `url`, `tagline`)
 *   - the agreement status (`live` true once the signed fiscal
 *     sponsorship agreement and test transfer are in place)
 *   - the LedgerAccount id the disbursement job credits (only set
 *     once the sponsor is live; until then, donations accrue in
 *     pending state on FBM's books)
 *
 * Selection rationale and the AMP-as-default recommendation live in
 * `docs/FISCAL_SPONSOR_DECISION.md`.
 */

export type FiscalSponsorKey =
  | "allied_media_projects"
  | "neo_philanthropy"
  | "tides_foundation"
  | "selc_local"

export type FiscalSponsor = {
  /** Stable registry key — also the value of FBM_FISCAL_SPONSOR_PROVIDER. */
  key: FiscalSponsorKey
  /** Display name for the storefront donation widget. */
  name: string
  /** Optional public URL (sponsor's about page, 501c3 status). */
  url: string | null
  /** One-line tagline shown alongside the name. */
  tagline: string
  /**
   * The signed fiscal sponsorship agreement + test transfer are in
   * place. False entries are recorded so we can pre-stage candidates
   * and switch via env without a deploy.
   */
  live: boolean
  /**
   * LedgerAccount id the donation-batch-disbursement job credits.
   * Null until the agreement is in place. Read at runtime; never
   * surfaced to the storefront.
   */
  ledger_account_id: string | null
}

export const FISCAL_SPONSORS: Record<FiscalSponsorKey, FiscalSponsor> = {
  allied_media_projects: {
    key: "allied_media_projects",
    name: "Allied Media Projects",
    url: "https://alliedmedia.org",
    tagline:
      "Detroit-rooted fiscal sponsor for movement and solidarity-economy projects.",
    live: false,
    ledger_account_id: null,
  },
  neo_philanthropy: {
    key: "neo_philanthropy",
    name: "NEO Philanthropy",
    url: "https://neophilanthropy.org",
    tagline: "National fiscal sponsor for social-change initiatives.",
    live: false,
    ledger_account_id: null,
  },
  tides_foundation: {
    key: "tides_foundation",
    name: "Tides Foundation",
    url: "https://tides.org",
    tagline: "Broad-spectrum 501(c)(3) fiscal sponsor at scale.",
    live: false,
    ledger_account_id: null,
  },
  selc_local: {
    key: "selc_local",
    name: "SELC-recommended local sponsor",
    url: "https://www.theselc.org",
    tagline:
      "Local fiscal sponsor recommended by the Sustainable Economies Law Center; specific entity selected per launch region.",
    live: false,
    ledger_account_id: null,
  },
}

export const FISCAL_SPONSOR_KEYS: readonly FiscalSponsorKey[] = [
  "allied_media_projects",
  "neo_philanthropy",
  "tides_foundation",
  "selc_local",
] as const

/**
 * Per `docs/FISCAL_SPONSOR_DECISION.md`, AMP is the default
 * recommendation. Override via env for staging / future transitions.
 */
export const DEFAULT_FISCAL_SPONSOR: FiscalSponsorKey = "allied_media_projects"

export function isFiscalSponsorKey(value: unknown): value is FiscalSponsorKey {
  return (
    typeof value === "string" &&
    (FISCAL_SPONSOR_KEYS as readonly string[]).includes(value)
  )
}

/**
 * Resolve the active sponsor entry by reading
 * FBM_FISCAL_SPONSOR_PROVIDER and falling back to the default. Pass an
 * explicit `env` arg (or the FBM_FISCAL_SPONSOR_LIVE / _LEDGER vars) to
 * override; useful in tests.
 */
export function resolveActiveFiscalSponsor(
  env: NodeJS.ProcessEnv = process.env
): FiscalSponsor {
  const requested = env.FBM_FISCAL_SPONSOR_PROVIDER
  const key = isFiscalSponsorKey(requested) ? requested : DEFAULT_FISCAL_SPONSOR
  const base = FISCAL_SPONSORS[key]

  // Env overrides for the operational fields. These come from deploy
  // config (so flipping a sponsor "live" doesn't require a code
  // change). Display fields stay in the registry.
  const liveOverride =
    env.FBM_FISCAL_SPONSOR_LIVE === "true"
      ? true
      : env.FBM_FISCAL_SPONSOR_LIVE === "false"
        ? false
        : null

  const ledgerOverride =
    typeof env.FBM_FISCAL_SPONSOR_LEDGER_ACCOUNT_ID === "string" &&
    env.FBM_FISCAL_SPONSOR_LEDGER_ACCOUNT_ID.length > 0
      ? env.FBM_FISCAL_SPONSOR_LEDGER_ACCOUNT_ID
      : null

  return {
    ...base,
    live: liveOverride !== null ? liveOverride : base.live,
    ledger_account_id: ledgerOverride ?? base.ledger_account_id,
  }
}

/**
 * The shape that `donation_settings.fiscal_sponsor_*` columns should be
 * seeded with. `fiscal_sponsor_account_id` is intentionally only set
 * when live — pre-live, the column stays null and the disbursement
 * job no-ops.
 */
export function deriveDonationSettingsFields(
  sponsor: FiscalSponsor
): {
  fiscal_sponsor_name: string
  fiscal_sponsor_url: string | null
  fiscal_sponsor_account_id: string | null
} {
  return {
    fiscal_sponsor_name: sponsor.name,
    fiscal_sponsor_url: sponsor.url,
    fiscal_sponsor_account_id: sponsor.live ? sponsor.ledger_account_id : null,
  }
}
