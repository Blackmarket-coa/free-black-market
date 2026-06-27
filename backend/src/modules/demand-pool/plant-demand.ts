/**
 * Plant Network — Pre-production demand for species without a listing (Section 4).
 *
 * Delegates to the existing `demand-pool` module — no new table. A "species
 * demand" is a DemandPost with `category:"plant_species"` and `product_id:null`;
 * each buyer interest is a DemandParticipant. When demand crosses the post's
 * target_quantity the Hub can activate production, which creates a pre-order
 * product and notifies every expressor (email + Blackout).
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { DEMAND_POOL_MODULE } from "./index"
import { DemandPostStatus, DemandPostVisibility } from "./models/demand-post"
import { emitBlackoutEvent } from "../../lib/blackout-emit"

/** Units of committed demand that flag a species as ready to propagate. */
export const PRODUCTION_THRESHOLD = 50

const HUB_CREATOR_ID = "plant-network-hub"

export interface PlantDemandExpression {
  species_name: string
  buyer_email: string
  buyer_id?: string
  desired_qty: number
  desired_pot_size?: string
  max_price?: number
  zone: number
}

export interface SpeciesDemandSummary {
  species_name: string
  demand_post_id: string
  total_expressions: number
  total_units_requested: number
  avg_max_price: number
  top_zones: number[]
  production_threshold_met: boolean
}

const speciesKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-")

const isEmail = (v: string) => /.+@.+\..+/.test(v)

type DemandService = {
  listDemandPosts: (filters: Record<string, unknown>) => Promise<any[]>
  createDemandPost: (input: Record<string, unknown>) => Promise<any>
  publishDemandPost: (id: string) => Promise<any>
  updateDemandPosts: (data: Record<string, unknown>) => Promise<any>
  transitionDemandStatus: (id: string, status: string) => Promise<any>
  joinDemandPool: (input: Record<string, unknown>) => Promise<any>
  listDemandParticipants: (filters: Record<string, unknown>) => Promise<any[]>
}

export class PlantDemandService {
  private readonly container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private get demand(): DemandService {
    return this.container.resolve(DEMAND_POOL_MODULE) as unknown as DemandService
  }

  private async findSpeciesPost(species: string): Promise<any | null> {
    const key = speciesKey(species)
    const posts = await this.demand.listDemandPosts({ category: "plant_species" })
    return (
      posts.find(
        (p) => ((p.metadata as Record<string, unknown> | null)?.species_key as string) === key
      ) ?? null
    )
  }

  private async getOrCreateSpeciesPost(species: string): Promise<any> {
    const existing = await this.findSpeciesPost(species)
    if (existing) return existing
    const post = await this.demand.createDemandPost({
      creator_id: HUB_CREATOR_ID,
      creator_type: "SELLER",
      category: "plant_species",
      title: `Species demand: ${species}`,
      description: `Aggregated buyer demand for ${species} before propagation.`,
      target_quantity: PRODUCTION_THRESHOLD,
      min_quantity: 1,
      unit_of_measure: "plants",
      visibility: DemandPostVisibility.PUBLIC,
      specs: { species_name: species, zone_counts: {}, max_prices: [] },
      metadata: { species_key: speciesKey(species) },
    })
    // DRAFT → OPEN so buyers can join.
    return this.demand.publishDemandPost(post.id)
  }

  /**
   * Record a buyer's interest in a species. Creates the species demand post on
   * first interest, then joins the buyer to it.
   */
  async recordExpression(input: PlantDemandExpression): Promise<{ demand_post_id: string }> {
    const post = await this.getOrCreateSpeciesPost(input.species_name)

    // Roll the buyer's zone + price ceiling into the post specs for reporting.
    const specs = (post.specs ?? {}) as {
      zone_counts?: Record<string, number>
      max_prices?: number[]
    }
    const zoneCounts = { ...(specs.zone_counts ?? {}) }
    zoneCounts[String(input.zone)] = (zoneCounts[String(input.zone)] ?? 0) + 1
    const maxPrices = [...(specs.max_prices ?? [])]
    if (typeof input.max_price === "number") maxPrices.push(input.max_price)
    await this.demand.updateDemandPosts({
      id: post.id,
      specs: { ...specs, species_name: input.species_name, zone_counts: zoneCounts, max_prices: maxPrices },
    })

    const customerId = input.buyer_id ?? input.buyer_email
    try {
      await this.demand.joinDemandPool({
        demand_post_id: post.id,
        customer_id: customerId,
        quantity_committed: input.desired_qty,
        price_willing_to_pay: input.max_price,
      })
    } catch (err) {
      // "Already participating" is a no-op for idempotent re-expression.
      if (!(err instanceof Error) || !/already participating/i.test(err.message)) throw err
    }

    return { demand_post_id: post.id }
  }

  /** Demand summary per species, sorted by total units desc. */
  async getDemandReport(): Promise<SpeciesDemandSummary[]> {
    const posts = await this.demand.listDemandPosts({ category: "plant_species" })
    const summaries: SpeciesDemandSummary[] = []
    for (const post of posts) {
      const participants = await this.demand.listDemandParticipants({ demand_post_id: post.id })
      const active = participants.filter((p) => p.status !== "WITHDRAWN")
      const totalUnits = active.reduce((s, p) => s + Number(p.quantity_committed ?? 0), 0)
      const specs = (post.specs ?? {}) as {
        species_name?: string
        zone_counts?: Record<string, number>
        max_prices?: number[]
      }
      const prices = specs.max_prices ?? []
      const avgMax = prices.length ? prices.reduce((s, n) => s + n, 0) / prices.length : 0
      const topZones = Object.entries(specs.zone_counts ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([z]) => Number(z))
      summaries.push({
        species_name: specs.species_name ?? post.title,
        demand_post_id: post.id,
        total_expressions: active.length,
        total_units_requested: totalUnits,
        avg_max_price: Math.round(avgMax * 100) / 100,
        top_zones: topZones,
        production_threshold_met: Number(post.committed_quantity ?? 0) >= Number(post.target_quantity ?? PRODUCTION_THRESHOLD),
      })
    }
    return summaries.sort((a, b) => b.total_units_requested - a.total_units_requested)
  }

  /**
   * Activate production for a species: create a draft pre-order product, advance
   * the demand post, and notify every expressor (email + Blackout).
   */
  async activateProductionForSpecies(
    speciesName: string,
    estimatedShipDate: Date,
    price: number
  ): Promise<{ product_id: string | null; notified_buyers: number }> {
    const post = await this.findSpeciesPost(speciesName)
    if (!post) throw new Error(`No demand post found for species "${speciesName}"`)

    // 1. Create the pre-order product (draft; hub finalises pricing/inventory).
    const productService = this.container.resolve(Modules.PRODUCT) as any
    let productId: string | null = null
    const [created] = await productService.createProducts([
      {
        title: `${speciesName} (Pre-order)`,
        description: `Pre-order propagation of ${speciesName}. Estimated ship ${estimatedShipDate.toISOString().slice(0, 10)}.`,
        status: "draft",
        options: [{ title: "Size", values: ["Default"] }],
        variants: [
          {
            title: "Default",
            manage_inventory: false,
            allow_backorder: true,
            options: { Size: "Default" },
            prices: [],
          },
        ],
        metadata: {
          is_live_plant: true,
          preorder: true,
          preorder_price: price,
          ship_window_open: estimatedShipDate.toISOString(),
          demand_post_id: post.id,
          species_name: speciesName,
        },
      },
    ])
    productId = created?.id ?? null

    // 2. Advance the demand post toward production (best-effort transition).
    try {
      await this.demand.transitionDemandStatus(post.id, DemandPostStatus.THRESHOLD_MET)
    } catch {
      // status may already be past this point; non-fatal.
    }

    // 3. Notify expressors.
    const participants = await this.demand.listDemandParticipants({ demand_post_id: post.id })
    const active = participants.filter((p) => p.status !== "WITHDRAWN")
    let notified = 0
    const notification = this.container.resolve(Modules.NOTIFICATION) as any
    for (const p of active) {
      const cid = String(p.customer_id ?? "")
      if (!cid) continue
      try {
        if (isEmail(cid)) {
          await notification.createNotifications({
            to: cid,
            channel: "email",
            template: "plant-demand-activated",
            data: { species_name: speciesName, estimated_ship: estimatedShipDate.toISOString(), price, product_id: productId },
          })
        }
        await emitBlackoutEvent(
          this.container,
          "plant_demand.activated",
          { userId: cid, speciesName, productId },
          { eventId: `plant_demand.activated:${post.id}:${cid}` }
        )
        notified += 1
      } catch {
        // best-effort per buyer
      }
    }

    return { product_id: productId, notified_buyers: notified }
  }
}
