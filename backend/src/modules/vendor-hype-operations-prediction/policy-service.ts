import { createHash } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"
import { PredictionMode } from "./models"
import { createLogger } from "../../shared/logger"

const log = createLogger("vendor-hype/policy-service")

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

export const MATRIX_POLICY_LABEL = `matrix-${MATRIX_POLICY_VERSION}@${MATRIX_EFFECTIVE_DATE}`

export const JURISDICTION_PROFILES = {
  "US-RESTRICTED": [PredictionMode.NON_CASH],
  "US-SWEEPSTAKES-ELIGIBLE": [PredictionMode.NON_CASH, PredictionMode.SWEEPSTAKES],
  "US-REGULATED-CASH": [PredictionMode.NON_CASH, PredictionMode.REGULATED_CASH],
  "EEA-NONCASH": [PredictionMode.NON_CASH],
  "EEA-CASH-LICENSED": [PredictionMode.NON_CASH, PredictionMode.REGULATED_CASH],
  "ROW-NONCASH": [PredictionMode.NON_CASH],
} as const satisfies Readonly<Record<string, readonly PredictionMode[]>>

export type ProfileCode = keyof typeof JURISDICTION_PROFILES

/**
 * Whether `value` names one of the matrix's profiles. An own-key test, not
 * `JURISDICTION_PROFILES[value]`: that read found `constructor`, `toString`
 * and the other `Object.prototype` names, so a mapping to one of them passed
 * validation and then threw a TypeError on every decision for its
 * jurisdiction.
 */
export const isProfileCode = (value: unknown): value is ProfileCode =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(JURISDICTION_PROFILES, value)

const modesOf = (profile: ProfileCode): readonly PredictionMode[] => JURISDICTION_PROFILES[profile]

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
export const DEFAULT_JURISDICTION_PROFILE: Readonly<Record<string, ProfileCode>> = {
  US: "US-RESTRICTED",
}

/**
 * Modes permitted when a jurisdiction has no mapping: the matrix's
 * `ROW-NONCASH` profile. The document states the rule outright: "if
 * jurisdiction mapping is unknown or stale, default to **Non-Cash only** and
 * block prize/cash pathways until legal/compliance sign-off."
 */
export const UNMAPPED_JURISDICTION_PROFILE: ProfileCode = "ROW-NONCASH"
export const UNMAPPED_JURISDICTION_ALLOWED_MODES: readonly PredictionMode[] =
  modesOf(UNMAPPED_JURISDICTION_PROFILE)

export type PolicyDecision = {
  allowed: boolean
  reason?: string
  /** The rules that decided: see {@link derivePolicyVersion}. */
  policy_version: string
  mode: PredictionMode
  /** The code asked about, trimmed and upper-cased ("" when there was none). */
  jurisdiction_code: string
  /** The code the profile was found under, or null when nothing matched and the unmapped default decided. */
  matched: string | null
  profile: ProfileCode
  allowed_modes: readonly PredictionMode[]
}

export type PolicyRuleConfig = {
  /** Jurisdiction code (country, subdivision or profile code) -> profile code. */
  jurisdictionProfiles: Record<string, string>
  /**
   * An operator's tag, appended to the derived version as `+label:<tag>`. It
   * can never replace the version: see {@link derivePolicyVersion}.
   */
  policyLabel: string
}

/**
 * The effective rules as one canonical string: every mapped code with its
 * profile and that profile's modes, sorted by code, then the profile and
 * modes an unmapped code gets. The same mapping gives the same string
 * whatever order its env JSON was written in; changing any mapped code, the
 * profile it maps to, or what a profile permits changes it. (Two mappings
 * that decide alike but are written differently, such as one that also maps
 * `US-CA` to the `US-RESTRICTED` it would inherit anyway, hash differently.
 * That errs toward a new version, never toward a shared one.)
 */
export function canonicalPolicyRules(mapping: Readonly<Record<string, ProfileCode>>): string {
  const mapped = Object.keys(mapping)
    .sort()
    .map((code) => [code, mapping[code], [...modesOf(mapping[code])].sort()])
  return JSON.stringify({
    mapped,
    unmapped: [UNMAPPED_JURISDICTION_PROFILE, [...UNMAPPED_JURISDICTION_ALLOWED_MODES].sort()],
  })
}

/** First 12 hex characters of the SHA-256 of {@link canonicalPolicyRules}. */
export const policyRulesHash = (mapping: Readonly<Record<string, ProfileCode>>): string =>
  createHash("sha256").update(canonicalPolicyRules(mapping)).digest("hex").slice(0, 12)

/** What an operator label may contain, so it cannot pass for another `+part`. */
const POLICY_LABEL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/**
 * The version recorded on every decision, and so on every market:
 * `matrix-<version>@<effective date>+map:<hash of the effective rules>`, with
 * `+label:<tag>` appended when an operator set one.
 *
 * It used to be `VENDOR_HYPE_POLICY_VERSION`, or else the matrix label alone.
 * So the same label covered decisions made under different
 * `VENDOR_HYPE_JURISDICTION_PROFILES` mappings (one deployment refusing
 * regulated cash in US-NV, another admitting it), and any string in the env
 * var replaced it without changing a rule. The matrix lists policy_version
 * among the fields a decision is replayed from (§1, §5.2), so the version has
 * to change exactly when the rules do.
 */
export function derivePolicyVersion(
  mapping: Readonly<Record<string, ProfileCode>>,
  label?: string
): string {
  const version = `${MATRIX_POLICY_LABEL}+map:${policyRulesHash(mapping)}`
  return label ? `${version}+label:${label}` : version
}

/** The operator's label if it is usable; anything else is dropped and logged. */
export function policyLabelFrom(raw: string | undefined): string | undefined {
  const label = (raw ?? "").trim()
  if (!label) return undefined
  if (!POLICY_LABEL_PATTERN.test(label)) {
    log.error(
      `VENDOR_HYPE_POLICY_VERSION: ignoring ${JSON.stringify(label)}; a label is 1-64 of A-Z a-z 0-9 . _ - and is appended to the derived policy version, never used in place of it`
    )
    return undefined
  }
  return label
}

/**
 * The operator's mapping from `VENDOR_HYPE_JURISDICTION_PROFILES`, a JSON
 * object of jurisdiction code -> profile code (for example
 * `{"US-NV":"US-REGULATED-CASH"}`), applied on top of the defaults. It fails
 * closed: unparseable JSON is ignored whole and an entry naming an unknown
 * profile is dropped, each logged at error level, so an invalid entry can
 * only narrow what is permitted and cannot stop the server booting. A valid
 * entry under the wrong key still widens that key (`US` for `US-NV` widens
 * every state), which is why the service logs the whole effective mapping
 * when it is built.
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
    if (isProfileCode(profile) && key && !isProfileCode(key)) {
      out[key] = profile
    } else {
      log.error(`VENDOR_HYPE_JURISDICTION_PROFILES: ignoring ${JSON.stringify(code)} -> ${JSON.stringify(profile)}`)
    }
  }
  return out
}

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
  private readonly jurisdictionProfiles: Readonly<Record<string, ProfileCode>>
  readonly policyVersion: string

  /**
   * Built from the code defaults, then `VENDOR_HYPE_JURISDICTION_PROFILES`,
   * then `config` (tests). The env is read here, at construction, so the
   * module service's instance carries the deployment's mapping.
   */
  constructor(config?: Partial<PolicyRuleConfig>) {
    const mapped: Record<string, string> = {
      ...DEFAULT_JURISDICTION_PROFILE,
      ...profilesFromEnv(process.env.VENDOR_HYPE_JURISDICTION_PROFILES),
      ...(config?.jurisdictionProfiles || {}),
    }
    const profiles: Record<string, ProfileCode> = {}
    for (const [code, profile] of Object.entries(mapped)) {
      if (!isProfileCode(profile)) {
        throw new Error(
          `Prediction policy maps ${code} to unknown profile ${profile}; ` +
            `known profiles: ${Object.keys(JURISDICTION_PROFILES).join(", ")}`
        )
      }
      profiles[code] = profile
    }
    this.jurisdictionProfiles = profiles
    this.policyVersion = derivePolicyVersion(
      profiles,
      policyLabelFrom(config?.policyLabel ?? process.env.VENDOR_HYPE_POLICY_VERSION)
    )
    // Once per instance (the module builds one at boot): the version alone is
    // a hash, and this line is what it is a hash of.
    log.info("Prediction policy in force", {
      policy_version: this.policyVersion,
      jurisdiction_profiles: profiles,
      unmapped_profile: UNMAPPED_JURISDICTION_PROFILE,
    })
  }

  /** The profile that decides for a code, and the code it was found under. */
  resolveProfile(jurisdictionCode: string): { profile: ProfileCode; matched: string } | null {
    for (const candidate of jurisdictionLookupChain(jurisdictionCode)) {
      if (Object.prototype.hasOwnProperty.call(this.jurisdictionProfiles, candidate)) {
        return { profile: this.jurisdictionProfiles[candidate], matched: candidate }
      }
    }
    return null
  }

  evaluateMode(mode: PredictionMode, jurisdictionCode: string): PolicyDecision {
    const resolved = this.resolveProfile(jurisdictionCode)
    const profile = resolved?.profile ?? UNMAPPED_JURISDICTION_PROFILE
    const allowedModes = modesOf(profile)
    const decided = {
      policy_version: this.policyVersion,
      mode,
      jurisdiction_code: jurisdictionLookupChain(jurisdictionCode)[0] ?? "",
      matched: resolved?.matched ?? null,
      profile,
      allowed_modes: allowedModes,
    }

    if (allowedModes.includes(mode)) {
      return { allowed: true, ...decided }
    }

    const label = resolved
      ? `${resolved.matched} (profile ${resolved.profile})`
      : `${decided.jurisdiction_code || "an unspecified jurisdiction"}: no jurisdiction policy is mapped, and unmapped jurisdictions default to non-cash only until legal/compliance sign-off`
    return {
      allowed: false,
      reason: `${mode} markets are not permitted for ${label}`,
      ...decided,
    }
  }
}

/**
 * What a market stores, under `metadata.policy_decision`, about the decision
 * that admitted it: enough to replay it against the matrix without the
 * deployment's env (which profile decided, and under which code).
 */
export type PolicyDecisionRecord = Omit<PolicyDecision, "allowed" | "reason">

export const policyDecisionRecord = (decision: PolicyDecision): PolicyDecisionRecord => ({
  policy_version: decision.policy_version,
  mode: decision.mode,
  jurisdiction_code: decision.jurisdiction_code,
  matched: decision.matched,
  profile: decision.profile,
  allowed_modes: [...decision.allowed_modes],
})

/** The stable code every policy refusal carries, at any checkpoint. */
export const PREDICTION_MODE_NOT_PERMITTED = "PREDICTION_MODE_NOT_PERMITTED"

/**
 * A market's mode is not permitted in its jurisdiction under the policy in
 * force. Typed FORBIDDEN, so even a caller that does not map it gets 403 with
 * the code and the reason from the framework's error handler; the routes
 * answer it as `{ type: "policy_denied", code, message, policy_version }`,
 * the shape the positions route already uses for its own policy refusal.
 *
 * It used to be a plain Error, which the framework answers 500 "An unknown
 * error occurred." (and, in production, reports to Sentry), so the creator
 * never learnt why.
 */
export class PredictionPolicyRefusal extends MedusaError {
  readonly policy_version: string
  readonly decision: PolicyDecision

  constructor(decision: PolicyDecision) {
    super(
      MedusaError.Types.FORBIDDEN,
      decision.reason || `${decision.mode} markets are not permitted by the prediction policy`,
      PREDICTION_MODE_NOT_PERMITTED
    )
    this.decision = decision
    this.policy_version = decision.policy_version
  }
}

/**
 * Whether an error is a policy refusal. Keyed on the code, not the class, as
 * `isCartCompletionIncomplete` is: a serialized error keeps its own
 * properties but not its prototype.
 */
export function isPredictionPolicyRefusal(
  error: unknown
): error is { code: typeof PREDICTION_MODE_NOT_PERMITTED; message?: string; policy_version?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PREDICTION_MODE_NOT_PERMITTED
  )
}

/** The HTTP answer to a policy refusal: 403 and the stable code, with the reason. */
export function predictionPolicyDeniedResponse(error: {
  message?: string
  policy_version?: string
}): {
  status: 403
  body: { type: "policy_denied"; code: typeof PREDICTION_MODE_NOT_PERMITTED; message: string; policy_version?: string }
} {
  return {
    status: 403,
    body: {
      type: "policy_denied",
      code: PREDICTION_MODE_NOT_PERMITTED,
      message: error.message || "This prediction market's mode is not permitted in its jurisdiction.",
      ...(error.policy_version ? { policy_version: error.policy_version } : {}),
    },
  }
}
