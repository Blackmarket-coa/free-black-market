/**
 * Startup-guide catalog types (§12 Business Launch System).
 *
 * Code is the source of truth for the guides — same convention as the playbook
 * recipes (`modules/playbook/recipes`). A guide describes how to stand up a
 * specific micro-business: estimated startup cost, equipment, production
 * suggestions, and the links that connect it to the rest of the platform
 * (product archetypes, an opportunity subject, related categories).
 */

export type StartupGuideId =
  | "seedling"
  | "compost"
  | "soap"
  | "gardening"

export type StartupGuide = {
  id: StartupGuideId
  slug: string
  title: string
  /** Marketplace category this business produces into. Used to link opportunities. */
  category: string
  summary: string
  /** Estimated all-in startup cost in cents (USD). Feeds the §5 startup-cost signal. */
  estimated_startup_cost_cents: number
  /** Difficulty for the storefront filter. */
  difficulty: "Beginner" | "Intermediate" | "Advanced"
  required_equipment: string[]
  production_suggestions: string[]
  /** product-archetype ids this business typically lists under. */
  related_archetypes: string[]
  /** The opportunity subject key (category) this guide maps to. */
  related_opportunity_key: string
}
