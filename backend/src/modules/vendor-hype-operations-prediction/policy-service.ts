import { PredictionMode } from "./models"
import { createLogger } from "../../shared/logger"

const log = createLogger("vendor-hype/policy-service")

export type PolicyDecision = {
  allowed: boolean
  reason?: string
  policy_version: string
}

/**
 * The jurisdiction profiles of
 * `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_COMPLIANCE_POLICY_MATRIX.md` §1, as
 * that document's machine-readable table writes them. A mapped jurisdiction
 * permits **only** its `allowed_modes`; anything not listed is refused.
 *
 * This used to be a block list (`blockedModesByJurisdiction`) mapping only
 * `US` to `[regulated_cash]`. A mode a mapped jurisdiction did not name was
 * therefore allowed, so sweepstakes markets were open for `US`, every US
 * subdivision, and even the literal `US-RESTRICTED`, whose own profile blocks
 * sweepstakes. The matrix is an allow list; so is this.
 */
export const MATRIX_POLICY_VERSION = "1.0.0"
export const MATRIX_EFFECTIVE_DATE = "2026-01-01"

export const JURISDICTION_PROFILES: Readonly<Record<string, readonly PredictionMode[]>> = {
  "US-RESTRICTED": [PredictionMode.NON_CASH],
  "US-SWEEPSTAKES-ELIGIBLE": [PredictionMode.NON_CASH, PredictionMode.SWEEPSTAKES],
  "US-REGULATED-CASH": [PredictionMode.NON_CASH, PredictionMode.REGULATED_CASH],
  "EEA-NONCASH": [PredictionMode.NON_CASH],
  "EEA-CASH-LICENSED": [PredictionMode.NON_CASH, PredictionMode.REGULATED_CASH],
  "ROW-NONCASH": [PredictionMode.NON_CASH],
}

/**
 * Countries mapped to a profile. The US and every subdivision (through
 * `jurisdictionLookupChain`) are `US-RESTRICTED` until counsel approves a
 * state for sweepstakes or the platform is authorised for cash: no state is
 * mapped to a wider profile here, because none has been approved. An
 * operator maps one with `VENDOR_HYPE_JURISDICTION_PROFILES`, not code.
 *
 * A profile code is a class of jurisdictions, not a jurisdiction, and a
 * market's `jurisdiction_code` is supplied by whoever creates the market. So
 * a profile code sent as a jurisdiction does not select that profile: it is
 * looked up like any other code, and `US-REGULATED-CASH` falls back through
 * its parent `US` to `US-RESTRICTED`.
 */
export const DEFAULT_JURISDICTION_PROFILE: Readonly<Record<string, keyof typeof JURISDICTION_PROFILES>> = {
  US: "US-RESTRICTED",
}

/**
 * Modes permitted when a jurisdiction has no mapping: the matrix's
 * `ROW-NONCASH` profile. The document states the rule outright: "if
 * jurisdiction mapping is unknown or stale, default to **Non-Cash only** and
 * block prize/cash pathways until legal/compliance sign-off."
 */
export const UNMAPPED_JURISDICTION_ALLOWED_MODES: readonly PredictionMode[] =
  JURISDICTION_PROFILES["ROW-NONCASH"]

export type PolicyRuleConfig = {
  /** Jurisdiction code (country, subdivision or profile code) -> profile code. */
  jurisdictionProfiles: Record<string, string>
  policyVersion: string
}

/**
 * The operator's mapping from `VENDOR_HYPE_JURISDICTION_PROFILES`, a JSON
 * object of jurisdiction code -> profile code (for example
 * `{"US-NV":"US-REGULATED-CASH"}`), applied on top of the defaults. It fails
 * closed: unparseable JSON is ignored whole and an entry naming an unknown
 * profile is dropped, each logged at error level, so a typo can only narrow
 * what is permitted, never widen it, and cannot stop the server booting.
 */
export function profilesFromEnv(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.error("VENDOR_HYPE_JURISDICTION_PROFILES is not valid JSON; ignoring it (defaults apply)")
    return {}
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    log.error("VENDOR_HYPE_JURISDICTION_PROFILES must be a JSON object; ignoring it (defaults apply)")
    return {}
  }
  const out: Record<string, string> = {}
  for (const [code, profile] of Object.entries(parsed as Record<string, unknown>)) {
    const key = code.trim().toUpperCase()
    if (typeof profile === "string" && JURISDICTION_PROFILES[profile] && key && !JURISDICTION_PROFILES[key]) {
      out[key] = profile
    } else {
      log.error(`VENDOR_HYPE_JURISDICTION_PROFILES: ignoring ${JSON.stringify(code)} -> ${JSON.stringify(profile)}`)
    }
  }
  return out
}

const defaultConfig = (): PolicyRuleConfig => ({
  jurisdictionProfiles: {
    ...DEFAULT_JURISDICTION_PROFILE,
    ...profilesFromEnv(process.env.VENDOR_HYPE_JURISDICTION_PROFILES),
  },
  policyVersion:
    process.env.VENDOR_HYPE_POLICY_VERSION || `matrix-${MATRIX_POLICY_VERSION}@${MATRIX_EFFECTIVE_DATE}`,
})

/**
 * Broadening sequence for a jurisdiction code.
 *
 * ISO 3166-2 subdivisions are `<country>-<subdivision>` (`US-CA`), and the
 * matrix's own profile codes are hyphenated the same way (`US-RESTRICTED`), so
 * a subdivision inherits its parent's profile. `US-CA` yields
 * `["US-CA", "US"]`; an exact match still wins because it comes first.
 */
export const jurisdictionLookupChain = (jurisdictionCode: string): string[] => {
  const normalized = (jurisdictionCode || "").trim().toUpperCase()
  if (!normalized) {
    return []
  }
  const parts = normalized.split("-").filter(Boolean)
  const chain: string[] = []
  for (let end = parts.length; end > 0; end--) {
    chain.push(parts.slice(0, end).join("-"))
  }
  return chain
}

export class PredictionPolicyService {
  private readonly config: PolicyRuleConfig

  constructor(config?: Partial<PolicyRuleConfig>) {
    const base = defaultConfig()
    const mapped = { ...base.jurisdictionProfiles, ...(config?.jurisdictionProfiles || {}) }
    for (const [code, profile] of Object.entries(mapped)) {
      if (!JURISDICTION_PROFILES[profile]) {
        throw new Error(
          `Prediction policy maps ${code} to unknown profile ${profile}; ` +
            `known profiles: ${Object.keys(JURISDICTION_PROFILES).join(", ")}`
        )
      }
    }
    this.config = {
      policyVersion: config?.policyVersion ?? base.policyVersion,
      jurisdictionProfiles: mapped,
    }
  }

  /** The profile that decides for a code, and the code it was found under. */
  resolveProfile(jurisdictionCode: string): { profile: string; matched: string } | null {
    for (const candidate of jurisdictionLookupChain(jurisdictionCode)) {
      const profile = this.config.jurisdictionProfiles[candidate]
      if (profile) {
        return { profile, matched: candidate }
      }
    }
    return null
  }

  evaluateMode(mode: PredictionMode, jurisdictionCode: string): PolicyDecision {
    const resolved = this.resolveProfile(jurisdictionCode)
    const allowed = resolved ? JURISDICTION_PROFILES[resolved.profile] : UNMAPPED_JURISDICTION_ALLOWED_MODES

    if (allowed.includes(mode)) {
      return { allowed: true, policy_version: this.config.policyVersion }
    }

    const label = resolved
      ? `${resolved.matched} (profile ${resolved.profile})`
      : `${jurisdictionLookupChain(jurisdictionCode)[0] || "an unspecified jurisdiction"}: no jurisdiction policy is mapped, and unmapped jurisdictions default to non-cash only until legal/compliance sign-off`
    return {
      allowed: false,
      reason: `${mode} markets are not permitted for ${label}`,
      policy_version: this.config.policyVersion,
    }
  }
}
