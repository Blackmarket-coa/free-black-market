/**
 * Startup-guide catalog (§12). Code is the source of truth; seeded into the
 * optional `startup_guide` table at boot via
 * `backend/src/scripts/seed-opportunity-engine.ts` (mirrors seed-playbooks).
 */

import type { StartupGuide, StartupGuideId } from "./types"

const SEEDLING: StartupGuide = {
  id: "seedling",
  slug: "seedling-business",
  title: "Seedling & Starts Business",
  category: "gardening",
  summary:
    "Grow and sell vegetable, herb, and flower starts to local gardeners. Low cost, fast cycle, strong spring demand.",
  estimated_startup_cost_cents: 35_000, // ~$350
  difficulty: "Beginner",
  required_equipment: [
    "Seed-starting trays & humidity domes",
    "Grow lights or a sunny structure",
    "Seed-starting mix",
    "Heat mat",
    "Labels & small pots",
  ],
  production_suggestions: [
    "Start with high-margin culinary herbs and tomato varieties",
    "Stagger sowings for a continuous 6-8 week selling window",
    "Pre-sell trays to coalitions and CSA members",
  ],
  related_archetypes: ["AGRICULTURAL_RAW"],
  related_opportunity_key: "gardening",
}

const COMPOST: StartupGuide = {
  id: "compost",
  slug: "compost-business",
  title: "Compost Business",
  category: "agriculture",
  summary:
    "Turn local food and yard waste into finished compost and sell by the bag or yard. High demand, low competition, low startup cost.",
  estimated_startup_cost_cents: 75_000, // ~$750
  difficulty: "Beginner",
  required_equipment: [
    "Compost bins or windrow space",
    "Thermometer & moisture meter",
    "Screening mesh",
    "Bags or bulk containers",
    "Pitchfork / aerator",
  ],
  production_suggestions: [
    "Collect feedstock from coalition kitchens and gardens",
    "Offer a subscription pickup + finished-compost return",
    "Sell soil blends and worm castings as add-ons",
  ],
  related_archetypes: ["AGRICULTURAL_PROCESSED"],
  related_opportunity_key: "agriculture",
}

const SOAP: StartupGuide = {
  id: "soap",
  slug: "soap-business",
  title: "Handmade Soap Business",
  category: "home-goods",
  summary:
    "Produce cold-process or melt-and-pour soaps and body bars. Differentiated by local ingredients and story.",
  estimated_startup_cost_cents: 50_000, // ~$500
  difficulty: "Intermediate",
  required_equipment: [
    "Stick blender & stainless pots",
    "Molds & cutter",
    "Safety gear (gloves, goggles)",
    "Scale & thermometer",
    "Curing rack",
  ],
  production_suggestions: [
    "Source tallow/oils and botanicals from coalition producers",
    "Batch seasonal scents tied to local harvests",
    "Bundle gift sets for the Black Market marketing packs",
  ],
  related_archetypes: ["NON_PERISHABLE"],
  related_opportunity_key: "home-goods",
}

const GARDENING: StartupGuide = {
  id: "gardening",
  slug: "gardening-business",
  title: "Market Gardening Business",
  category: "agriculture",
  summary:
    "Grow vegetables on a small intensive plot for direct, CSA, and coalition sales. Scales with demand pools.",
  estimated_startup_cost_cents: 250_000, // ~$2,500
  difficulty: "Intermediate",
  required_equipment: [
    "Broadfork & hand tools",
    "Irrigation lines & timer",
    "Row cover & low tunnels",
    "Harvest bins & wash station",
    "Cooler / cold storage",
  ],
  production_suggestions: [
    "Anchor revenue with a CSA subscription listing",
    "Fill open demand-pool needs from local coalitions",
    "Succession-plant fast crops between long-season beds",
  ],
  related_archetypes: ["AGRICULTURAL_RAW", "SUBSCRIPTION"],
  related_opportunity_key: "agriculture",
}

export const STARTUP_GUIDES: Record<StartupGuideId, StartupGuide> = {
  seedling: SEEDLING,
  compost: COMPOST,
  soap: SOAP,
  gardening: GARDENING,
}

export const STARTUP_GUIDE_IDS: StartupGuideId[] = Object.keys(
  STARTUP_GUIDES
) as StartupGuideId[]

export function listStartupGuides(): StartupGuide[] {
  return STARTUP_GUIDE_IDS.map((id) => STARTUP_GUIDES[id])
}

export function getStartupGuide(slug: string): StartupGuide | undefined {
  return listStartupGuides().find((g) => g.slug === slug || g.id === slug)
}

/**
 * Estimated startup cost (dollars) for an opportunity subject/category, derived
 * from the cheapest guide that targets it. Returns null when no guide maps to
 * the subject (the §5 score then treats startup cost as unknown/neutral).
 */
export function startupCostDollarsForSubject(subjectKey: string): number | null {
  const key = (subjectKey || "").trim().toLowerCase()
  const matches = listStartupGuides().filter(
    (g) =>
      g.related_opportunity_key.toLowerCase() === key ||
      g.category.toLowerCase() === key
  )
  if (matches.length === 0) {
    return null
  }
  const cheapest = Math.min(
    ...matches.map((g) => g.estimated_startup_cost_cents)
  )
  return cheapest / 100
}

export * from "./types"
