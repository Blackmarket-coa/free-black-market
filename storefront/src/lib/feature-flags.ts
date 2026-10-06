const enabled = (value: string | undefined, fallback = false) => {
  if (value === undefined) {
    return fallback
  }

  return value === "true"
}

export const isUnifiedListingEnabled = () =>
  process.env.NEXT_PUBLIC_STOREFRONT_UNIFIED_LISTING !== "false"

export const phase1ModuleFlags = {
  pos: enabled(process.env.NEXT_PUBLIC_FF_POS_V1),
  weightPricing: enabled(process.env.NEXT_PUBLIC_FF_WEIGHT_PRICING_V1),
  pickPack: enabled(process.env.NEXT_PUBLIC_FF_PICK_PACK_V1),
  invoicing: enabled(process.env.NEXT_PUBLIC_FF_INVOICING_V1),
  channelSync: enabled(process.env.NEXT_PUBLIC_FF_CHANNEL_SYNC_V1),
  // Mirrors the API's FF_INVESTMENT_POOLS_V1. hawala-ledger InvestmentPool is
  // quiescent under Posture A unless an offering is structured under a
  // securities exemption (docs/POSTURE_A_COMPLIANCE.md). The /invest page is a
  // public offer of return-bearing positions, and an offer is the exposure
  // whether or not anyone funds a pool — so the page and every link to it stay
  // dark with the API. See docs/TRANSMUTATION_STRATEGY.md §7.2.
  investmentPools: enabled(process.env.NEXT_PUBLIC_FF_INVESTMENT_POOLS_V1),
  // Mirrors the API's FF_NONPROFIT_PARITY_V1 (docs/BMC_SURVIVAL_PROGRAMS.md
  // Phase 1). Gates the pilot-partner org rows and their IRS-file
  // verification badges on /partners: showing a third party's tax status is
  // legal checkpoint L11, and the donation path behind it is L24/L25
  // (docs/legal/checkpoints.md). Set only together with the API's flag.
  nonprofitParity: enabled(process.env.NEXT_PUBLIC_FF_NONPROFIT_PARITY_V1),
  // Mirrors the API's FF_SHARED_GOAL_COALITION_V1: shared-goal Coalition
  // campaign pages. Commercial co-venturer territory (L25); dark with the API.
  sharedGoalCoalition: enabled(process.env.NEXT_PUBLIC_FF_SHARED_GOAL_COALITION_V1),
  // Mirrors the API's FF_CONSUMER_SUBSCRIPTIONS_V1 (Black Mask F2/F4): the
  // subscribe flow for products marked subscribable, the affirmative
  // auto-renew approval, and /user/subscriptions. Consumer auto-renewal
  // disclosure and online cancellation are a legal checkpoint the operator
  // clears first; set only together with the API's flag.
  consumerSubscriptions: enabled(process.env.NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1),
  // Mirrors the API's FF_FEE_FIRST_SPLIT_V1 (Black Mask F6). Every page reads
  // the processing model from /store/fee-schedule's `processing` field; this
  // twin decides only when that field is missing — the request failed, or the
  // response was cached before the API's flag was set (`getFeeSchedule`) — so
  // neither an outage nor a stale cache can render "we absorb processing"
  // while fee-first is live. Deploy with this set BEFORE setting the API's
  // flag, and roll back in the reverse order.
  feeFirstSplit: enabled(process.env.NEXT_PUBLIC_FF_FEE_FIRST_SPLIT_V1),
  // Mirrors the API's FF_CUSTOMER_WALLET_V1: the customer wallet (balance,
  // ACH deposit and withdrawal, bank-account linking, transactions) — /wallet,
  // /user/coalition-credits, their nav entries and every wallet call through
  // the hawala server action. A customer-held, ACH-funded balance is what
  // Posture A rules out (docs/POSTURE_A_COMPLIANCE.md). Default off (operator
  // answer 2026-10-06); set only together with the API's flag.
  customerWallet: enabled(process.env.NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1),
}
