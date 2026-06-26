/**
 * Plant Network — Pre-production demand for species without a listing (Section 4).
 *
 * The `demand-pool` module already aggregates buyer demand for EXISTING-ish
 * offerings: DemandPost / DemandParticipant / DemandBounty / SupplierProposal /
 * ProposalVote, with a draft→open→threshold_met→negotiating→deal_approved→
 * order_placed→fulfilled workflow (see `service.ts`, `createDemandPost`).
 *
 * What is MISSING: the rare-species case where buyers express interest in a
 * species that has NO product yet (Baobab, Lychee, Ginseng seedling, Jaboticaba).
 * These stubs add a thin plant layer that should DELEGATE to the existing
 * DemandPost mechanics once a species crosses threshold (a DemandPost/product is
 * then created), rather than maintaining a second demand store.
 */

export interface PlantDemandExpression {
  id: string
  species_name: string // may not have a product yet, e.g. "Jaboticaba"
  buyer_email: string
  buyer_id?: string
  desired_qty: number
  desired_pot_size?: string // "3 gal" | "7 gal" | "15 gal"
  max_price?: number
  zone: number // buyer hardiness zone
  created_at: Date
}

export interface SpeciesDemandSummary {
  species_name: string
  total_expressions: number
  total_units_requested: number
  avg_max_price: number
  top_zones: number[]
  production_threshold_met: boolean
}

export class PlantDemandService {
  /**
   * TODO: Record a demand expression for a species (with or without a product).
   * Store on the existing demand-pool tables where possible; for species without
   * a product, keep a lightweight expression keyed by `species_name`.
   */
  async recordExpression(
    _input: Omit<PlantDemandExpression, "id" | "created_at">
  ): Promise<PlantDemandExpression> {
    throw new Error("TODO: PlantDemandService.recordExpression not implemented")
  }

  /**
   * TODO: Demand summary per species, sorted by total units desc. Drives the Hub's
   * "what to propagate next season" view.
   */
  async getDemandReport(): Promise<SpeciesDemandSummary[]> {
    throw new Error("TODO: PlantDemandService.getDemandReport not implemented")
  }

  /**
   * TODO: When the Hub activates a species, create a pre-order product listing and
   * a backing DemandPost via the existing demand-pool service, then notify every
   * expressor (email + Blackout Matrix). Returns the new product id and count.
   */
  async activateProductionForSpecies(
    _species_name: string,
    _estimated_ship_date: Date,
    _price: number
  ): Promise<{ product_id: string; notified_buyers: number }> {
    throw new Error("TODO: PlantDemandService.activateProductionForSpecies not implemented")
  }
}
