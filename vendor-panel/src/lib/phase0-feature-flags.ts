const enabled = (value: string | undefined, fallback = false) => {
  if (value === undefined) {
    return fallback
  }

  return value === "true"
}

export const phase1ModuleFlags = {
  pos: enabled(import.meta.env.VITE_FF_POS_V1),
  weightPricing: enabled(import.meta.env.VITE_FF_WEIGHT_PRICING_V1),
  pickPack: enabled(import.meta.env.VITE_FF_PICK_PACK_V1),
  invoicing: enabled(import.meta.env.VITE_FF_INVOICING_V1),
  channelSync: enabled(import.meta.env.VITE_FF_CHANNEL_SYNC_V1),
  // Mirrors the API's FF_VENDOR_ADVANCES_V1: hawala-ledger VendorAdvance is
  // quiescent under Posture A pending legal review, so the "Get Advance"
  // section is hidden unless both sides are switched on.
  vendorAdvances: enabled(import.meta.env.VITE_FF_VENDOR_ADVANCES_V1),
  // Mirrors the API's FF_INVESTMENT_POOLS_V1: hawala-ledger InvestmentPool is
  // quiescent under Posture A unless an offering is structured under a
  // securities exemption, so the "Your Investment Pools" section stays hidden
  // unless both sides are switched on. See docs/TRANSMUTATION_STRATEGY.md §7.2.
  investmentPools: enabled(import.meta.env.VITE_FF_INVESTMENT_POOLS_V1),
  // Mirrors the API's FF_NONPROFIT_PARITY_V1 (docs/BMC_SURVIVAL_PROGRAMS.md
  // Phase 1): pilot-partner org records, IRS-file verification badges and
  // the 0% donation rule. Off until counsel clears legal checkpoints L24/L25
  // (docs/legal/checkpoints.md); set it only together with the API's flag.
  nonprofitParity: enabled(import.meta.env.VITE_FF_NONPROFIT_PARITY_V1),
  // Mirrors the API's FF_SHARED_GOAL_COALITION_V1: shared-goal Coalition
  // campaigns. A coalition fundraising page is commercial co-venturer
  // territory (L25), so it stays dark with the API until counsel clears it.
  sharedGoalCoalition: enabled(import.meta.env.VITE_FF_SHARED_GOAL_COALITION_V1),
}
