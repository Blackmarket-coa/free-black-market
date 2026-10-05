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
  FUND_ACCOUNTING_V1: "FF_FUND_ACCOUNTING_V1",
  AID_NETWORK_V1: "FF_AID_NETWORK_V1",
  DOCUMENT_VAULT_V1: "FF_DOCUMENT_VAULT_V1",
  NURSERY_VERTICAL_V1: "FF_NURSERY_VERTICAL_V1",
  // Vendor cash advances (hawala-ledger `VendorAdvance`), quiescent under
  // Posture A pending legal review — docs/POSTURE_A_COMPLIANCE.md § "Existing
  // models documented as quiescent". Default off: the `/vendor/hawala/advances`
  // routes and the vendor-panel "Get Advance" section stay dark until an
  // operator flips it deliberately.
  VENDOR_ADVANCES_V1: "FF_VENDOR_ADVANCES_V1",
  // Producer investment pools (hawala-ledger `InvestmentPool` / `Investment`),
  // quiescent under Posture A unless and until an offering is structured under
  // a securities exemption — docs/POSTURE_A_COMPLIANCE.md § "Existing models
  // documented as quiescent". The `/vendor/hawala/pools`, `/admin/hawala/pools`,
  // `/store/hawala/pools` and `/store/hawala/investments` routes were live
  // behind auth alone until 2026-09-09; same disposition, and the same default
  // as VENDOR_ADVANCES_V1, for the same reason.
  INVESTMENT_POOLS_V1: "FF_INVESTMENT_POOLS_V1",
  // The shared seller reminder rail (`shared/seller-reminders.ts`). Default
  // off, following the reasoning `FBM_AR_DUNNING_LIVE` records on the dunning
  // sweep: a reminder ladder that advances while nothing can be delivered
  // burns stages the vendor can never receive. Off, the rail reports what it
  // would send and records nothing, so every reminder stays sendable.
  SELLER_REMINDERS_V1: "FF_SELLER_REMINDERS_V1",
  // BMC Survival Programs, Phase 1 (docs/BMC_SURVIVAL_PROGRAMS.md §2-3):
  // nonprofit parity -- persisted partner-org records, IRS-file org
  // verification, the 0% transaction-kind fee rule on donations, and the
  // direct-charge donation path. Default off. The operator may not set this to
  // "true" for live money until counsel has cleared legal checkpoints L11
  // (representing a third party's tax status), L24 (custody shape) and L25
  // (commercial co-venturer status) in docs/legal/checkpoints.md. The flag
  // surfaces those checkpoints; it does not resolve them.
  NONPROFIT_PARITY_V1: "FF_NONPROFIT_PARITY_V1",
  // Shared-goal Coalitions on collective-campaign (Phase 1 item 3): a goal,
  // milestones, per-org roles and contributions, a public progress page and a
  // joint impact report. Money on this path is the NONPROFIT_PARITY_V1 direct
  // split, never the campaign escrow. Default off; L25 applies to any public
  // coalition fundraising page.
  SHARED_GOAL_COALITION_V1: "FF_SHARED_GOAL_COALITION_V1",
  // Consumer subscription lifecycle (docs/BLACK_MASK_LAUNCH_PLAN.md §5 F4):
  // a customer cancel or exhausted payment retries starts a grace period
  // (`past_due`), then `read_only` with a read/export entitlement — never
  // deletion — plus until-canceled subscriptions for products that opt in.
  // The grace length is a setting (SUBSCRIPTION_GRACE_PERIOD_DAYS, per-product
  // `subscription_grace_period_days`), never a constant; with this flag on and
  // no length configured, each transition keeps today's behaviour and logs.
  // Default off. Consumer auto-renewal disclosure / online-cancellation rules
  // are a legal checkpoint the operator must clear before a paid launch; the
  // flag surfaces that, it does not resolve it.
  CONSUMER_SUBSCRIPTIONS_V1: "FF_CONSUMER_SUBSCRIPTIONS_V1",
  // Black Mask provisioning webhook channel (F3,
  // docs/BLACK_MASK_PROVISIONING_CONTRACT.md): a signed outbound notice to the
  // Black Mask provisioning service when a vault order is placed, renewed,
  // cancelled, fails payment or enters grace / read-only. Default off; with it
  // off nothing is enqueued, nothing is sent, and /admin/black-mask/* is 404.
  // It also needs BLACK_MASK_PROVISIONING_URL / _WEBHOOK_SECRET /
  // _WEBHOOK_KEY_ID / _SELLER_ID; any one unset keeps the channel a no-op.
  // Legal checkpoint L28 (the vault licence) gates the paid launch this flag
  // serves; the flag surfaces it and does not resolve it.
  BLACK_MASK_PROVISIONING_V1: "FF_BLACK_MASK_PROVISIONING_V1",
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
