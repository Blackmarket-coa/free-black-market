import { PredictionMode } from "./models"

export type PolicyDecision = {
  allowed: boolean
  reason?: string
  policy_version: string
}

export type PolicyRuleConfig = {
  blockedModesByJurisdiction: Record<string, PredictionMode[]>
  policyVersion: string
}

/**
 * Modes permitted when a jurisdiction has no mapping.
 *
 * `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_COMPLIANCE_POLICY_MATRIX.md` states
 * the governing rule outright: "if jurisdiction mapping is unknown or stale,
 * default to **Non-Cash only** and block prize/cash pathways until
 * legal/compliance sign-off." Its `ROW-NONCASH` profile — "rest-of-world
 * default where legal analysis is incomplete or restrictive" — is that rule as
 * a profile: `allowed_modes: [non_cash]`.
 *
 * The previous implementation did the opposite. It looked the jurisdiction up
 * by exact key and treated a miss as permission, so every code the operator had
 * not enumerated — including `US-CA`, and including the matrix's own
 * `US-RESTRICTED` — allowed regulated-cash markets. See
 * docs/TRANSMUTATION_STRATEGY.md §5.6.
 */
export const UNMAPPED_JURISDICTION_ALLOWED_MODES: readonly PredictionMode[] = [
  PredictionMode.NON_CASH,
]

const defaultConfig: PolicyRuleConfig = {
  blockedModesByJurisdiction: {
    US: [PredictionMode.REGULATED_CASH],
  },
  policyVersion: process.env.VENDOR_HYPE_POLICY_VERSION || "phase_b_v1",
}

/**
 * Broadening sequence for a jurisdiction code.
 *
 * ISO 3166-2 subdivisions are `<country>-<subdivision>` (`US-CA`), and the
 * matrix's own profile codes are hyphenated the same way (`US-RESTRICTED`), so
 * a subdivision must inherit whatever its parent blocks. `US-CA` yields
 * `["US-CA", "US"]`; an exact profile match still wins because it comes first.
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
    this.config = {
      ...defaultConfig,
      ...config,
      blockedModesByJurisdiction: {
        ...defaultConfig.blockedModesByJurisdiction,
        ...(config?.blockedModesByJurisdiction || {}),
      },
    }
  }

  evaluateMode(mode: PredictionMode, jurisdictionCode: string): PolicyDecision {
    const chain = jurisdictionLookupChain(jurisdictionCode)

    // A mapped jurisdiction — or any parent of one — decides.
    for (const candidate of chain) {
      const blockedModes = this.config.blockedModesByJurisdiction[candidate]
      if (!blockedModes) {
        continue
      }
      if (blockedModes.includes(mode)) {
        return {
          allowed: false,
          reason: `${mode} markets are disabled for ${candidate} jurisdiction until licensing is complete`,
          policy_version: this.config.policyVersion,
        }
      }
      return { allowed: true, policy_version: this.config.policyVersion }
    }

    // Unmapped (or absent) jurisdiction: non-cash only.
    if (UNMAPPED_JURISDICTION_ALLOWED_MODES.includes(mode)) {
      return { allowed: true, policy_version: this.config.policyVersion }
    }

    const label = chain[0] || "an unspecified jurisdiction"
    return {
      allowed: false,
      reason:
        `${mode} markets are disabled for ${label}: no jurisdiction policy is mapped, ` +
        `and unmapped jurisdictions default to non-cash only until legal/compliance sign-off`,
      policy_version: this.config.policyVersion,
    }
  }
}
