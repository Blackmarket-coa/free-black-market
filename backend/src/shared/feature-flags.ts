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
  // deletion — plus until-canceled subscriptions, only when the customer
  // affirmatively approves auto-renewal at purchase for a product marked
  // `subscription_until_canceled` (otherwise exactly one period, never
  // renewed; operator answer 2026-10-05, "renew upon approval").
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
  // Black Mask F8: the $10/month all-access vendor plan (0% platform fee,
  // every vendor.* feature, 30-day trial). On, the self-serve ladder becomes
  // free + all_access; starter/pro/scale stay DEFINED so any assignment still
  // resolves its features and limits, but are no longer offered, listed on
  // /store/fee-schedule, or selectable through POST /vendor/plan/change. Off,
  // every surface offers exactly the free/starter/pro/scale ladder it did
  // before. Default off. Do not set before the fee-first split (F6) is live:
  // at 0% the platform still absorbs card processing on every sale.
  ALL_ACCESS_PLAN_V1: "FF_ALL_ACCESS_PLAN_V1",
  // Black Mask F6: the fee-first split (operator answer 2026-10-05 item 6,
  // "processing fee comes out of total then is split"). On, the card-
  // processing ESTIMATE (payout_config payment_processing_percent / _fixed,
  // 2.9% + 30c by default) is taken on the whole amount FBM's own Stripe
  // account charges for the order, deducted first, and the platform fee is
  // taken on what is left (`payout-breakdown/fee-first.ts`). The ledger gets a
  // processing leg ESCROW -> the dedicated card-processing account (a
  // PLATFORM_FEE-type system account owned by `processing`, never SETTLEMENT
  // nor the shared PLATFORM_FEE balance the plugin/referral disbursers draw
  // on); on a refund that leg is not reversed and the vendor's balancing leg
  // absorbs it. /store/fee-schedule publishes `processing` and the storefront
  // stops saying FBM absorbs processing. Off, every amount, ledger leg and
  // public sentence is exactly what it was. Default off; no vendors are live,
  // so the cut-over is the moment this is set. The rate never moves: this
  // changes the BASE the flat 3% is taken on, not the 3%.
  // Refund shortfall (decided 2026-10-06, operator answer item 20): the
  // refund always posts and records the gap as a vendor-shortfall leg, and
  // that receivable is recovered automatically from the vendor's next
  // earnings, and before any payout (`hawala-ledger/card-processing.ts`).
  // Recovery is NOT gated on this flag, so rolling it back never strands a
  // receivable. Card orders reach the ledger only with CARD_ORDER_LEDGER_V1
  // (SD-36) also set; without it the processing, shortfall and recovery legs
  // only run for wallet-funded orders.
  // CUT-OVER ORDER: deploy the storefront with NEXT_PUBLIC_FF_FEE_FIRST_SPLIT_V1
  // first (a fresh build has no cached /store/fee-schedule, and the twin
  // forces the fee-first wording even over a cached response without
  // `processing`), THEN set this. Roll back in the reverse order. Otherwise
  // pages may say "we absorb processing" for up to the 1h fetch cache while
  // settlement is fee-first.
  FEE_FIRST_SPLIT_V1: "FF_FEE_FIRST_SPLIT_V1",
  // The customer wallet (hawala-ledger USER_WALLET): GET/POST
  // /store/hawala/wallet, /deposit (Stripe ACH pull into the wallet),
  // /withdraw (ACH push out of it), /bank-accounts and /bank-accounts/link
  // (Financial Connections linking), and /transactions. A customer-held,
  // ACH-funded balance is the balance-holding outside a purchase→payout context
  // that Posture A rules out (docs/POSTURE_A_COMPLIANCE.md), and that doc's
  // InvestmentPool bullet has claimed since 2026-09-09 that `/store/hawala/
  // deposit` sat behind a flag when it did not; this flag closes that claim.
  // Default off (operator answer 2026-10-06): with it off every one of those
  // routes answers 404 feature_disabled BEFORE auth or a rate limiter runs, so
  // a signed-out and a signed-in caller get the same answer. The pools listing,
  // investments and carried-pool contributions keep their own flags
  // (INVESTMENT_POOLS_V1, NONPROFIT_PARITY_V1) and are not gated here. The
  // storefront twin is NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1; set both together.
  CUSTOMER_WALLET_V1: "FF_CUSTOMER_WALLET_V1",
  // Card orders reach the hawala ledger (SD-36 / SD-39, operator answer
  // 2026-10-06). Off (default): unchanged — the legacy settlement read throws
  // on every order (SD-39), so nothing posts. On: an order paid through FBM's
  // own Stripe account is read correctly (lib/card-order-settlement.ts) and
  // settles once THAT order's money is captured — at placement if it already
  // is, on `payment.captured`, or in the reconciler job — with the purchase
  // leg debiting the card-clearing account (hawala-ledger/card-clearing.ts);
  // each order's refunds post as deltas back to clearing. No customer wallet
  // is created or touched. A Stripe Connect direct charge posts nothing (the
  // money is the partner's). Orders paid any other way keep the old path.
  // Backend only; no storefront twin. FIRST ENABLE back-settles every card
  // order placed in the last 7 days whose money was captured (the
  // reconciler's settle window); older card orders stay unsettled. Rollback
  // and re-enable are safe the same way: anything captured within the window
  // and missed is settled; refunds are checked for 180 days.
  CARD_ORDER_LEDGER_V1: "FF_CARD_ORDER_LEDGER_V1",
  // Vendors are paid from the hawala ledger (SD-41, operator decision
  // 2026-10-06 "FBM ledger drives Connect"; lib/ledger-connect-payouts.ts).
  // Off (default): unchanged — @mercurjs/b2c-core's nightly `daily-payouts`
  // job runs as before (FBM's same-named job hands straight to it), paying
  // each order to the seller's Stripe Connect account from Mercur's own
  // figures. On: FBM's job replaces it. Each night, for every seller with an
  // ACTIVE Mercur payout account on a US / USD Stripe account and no payout
  // hold, it books orders Mercur already paid out of the ledger (so nothing
  // is paid twice), requests a payout of what the ledger says is payable
  // (after card processing and refunds owed are recovered), and sends every
  // PROCESSING payout request — the vendor panel's too — as a Connect
  // transfer through Mercur's payout module, at most once each. A refused
  // transfer puts the money back on the ledger. Backend only; no twin.
  // CUT-OVER: set CARD_ORDER_LEDGER_V1 first (otherwise card orders never
  // reach SELLER_EARNINGS and nobody is paid), then this. ROLLBACK is a
  // one-way door once a ledger transfer has gone out: with this off again,
  // Mercur's job would pay every order without its own payout record, the
  // ones the ledger already paid included, so FBM's job refuses to hand to
  // Mercur's while any ledger-sent payout exists, and logs why.
  LEDGER_CONNECT_PAYOUTS_V1: "FF_LEDGER_CONNECT_PAYOUTS_V1",
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
