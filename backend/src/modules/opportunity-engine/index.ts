import { Module } from "@medusajs/framework/utils"
import OpportunityEngineService from "./service"

export const OPPORTUNITY_ENGINE_MODULE = "opportunity_engine"

export default Module(OPPORTUNITY_ENGINE_MODULE, {
  service: OpportunityEngineService,
})

export * from "./models"

// Explicit re-exports below avoid name collisions with the persisted models
// (the model `OpportunityScore`/`PriceObservation`/`StartupGuide` vs the pure
// helper types of the same name in `_scoring`/`startup-guides`).
export {
  computeOpportunityScore,
  normalizeDemand,
  normalizeCompetition,
  normalizeStartupCost,
  priceTrend,
  band,
  logSaturate,
  OPPORTUNITY_WEIGHTS,
} from "./_scoring"
export type { OpportunitySignals, OpportunityBand, PriceTrend } from "./_scoring"

export {
  STARTUP_GUIDES,
  STARTUP_GUIDE_IDS,
  listStartupGuides,
  getStartupGuide,
  startupCostDollarsForSubject,
} from "./startup-guides"
export type { StartupGuideId } from "./startup-guides"
