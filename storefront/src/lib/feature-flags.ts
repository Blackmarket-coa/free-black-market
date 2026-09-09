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
}
