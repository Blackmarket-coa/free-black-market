/**
 * Phase 0 feature-flag registry.
 *
 * Flags default to false and are enabled via environment variables.
 */

export const PHASE0_FEATURE_FLAGS = {
  POS_V1: "FF_POS_V1",
  WEIGHT_PRICING_V1: "FF_WEIGHT_PRICING_V1",
  PICK_PACK_V1: "FF_PICK_PACK_V1",
  INVOICING_V1: "FF_INVOICING_V1",
  CHANNEL_SYNC_V1: "FF_CHANNEL_SYNC_V1",
  MERCHANT_SUPPORT_V1: "FF_MERCHANT_SUPPORT_V1",
  FRAUD_MONITORING_V1: "FF_FRAUD_MONITORING_V1",
  MANAGED_ONBOARDING_V1: "FF_MANAGED_ONBOARDING_V1",
  TRAINING_RESOURCES_V1: "FF_TRAINING_RESOURCES_V1",
  PROMO_CAMPAIGNS_V1: "FF_PROMO_CAMPAIGNS_V1",
  // Vendor Quest engine + its opt-in substrate/vertical modules. Each is
  // independently adoptable; enabling one never forces another.
  VENDOR_QUESTS_V1: "FF_VENDOR_QUESTS_V1",
  PRODUCTION_LEDGER_V1: "FF_PRODUCTION_LEDGER_V1",
  PRODUCTION_COSTING_V1: "FF_PRODUCTION_COSTING_V1",
  DOCUMENT_VAULT_V1: "FF_DOCUMENT_VAULT_V1",
  NURSERY_VERTICAL_V1: "FF_NURSERY_VERTICAL_V1",
} as const

export type Phase0FeatureFlag = keyof typeof PHASE0_FEATURE_FLAGS

function envEnabled(name: string): boolean {
  return process.env[name] === "true"
}

export const featureFlagState = {
  isEnabled(flag: Phase0FeatureFlag): boolean {
    return envEnabled(PHASE0_FEATURE_FLAGS[flag])
  },
  snapshot(): Record<Phase0FeatureFlag, boolean> {
    return Object.fromEntries(
      Object.keys(PHASE0_FEATURE_FLAGS).map((flag) => [
        flag,
        envEnabled(PHASE0_FEATURE_FLAGS[flag as Phase0FeatureFlag]),
      ])
    ) as Record<Phase0FeatureFlag, boolean>
  },
}
