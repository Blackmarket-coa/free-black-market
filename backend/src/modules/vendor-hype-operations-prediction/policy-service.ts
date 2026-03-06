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

const defaultConfig: PolicyRuleConfig = {
  blockedModesByJurisdiction: {
    US: [PredictionMode.REGULATED_CASH],
  },
  policyVersion: process.env.VENDOR_HYPE_POLICY_VERSION || "phase_b_v1",
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
    const normalizedJurisdiction = jurisdictionCode.trim().toUpperCase()
    const blockedModes = this.config.blockedModesByJurisdiction[normalizedJurisdiction] || []

    if (blockedModes.includes(mode)) {
      return {
        allowed: false,
        reason: `${mode} markets are disabled for ${normalizedJurisdiction} jurisdiction until licensing is complete`,
        policy_version: this.config.policyVersion,
      }
    }

    return {
      allowed: true,
      policy_version: this.config.policyVersion,
    }
  }
}
