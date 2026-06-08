import { MedusaService } from "@medusajs/framework/utils"
import { PriceObservation, OpportunityScore, StartupGuide } from "./models"
import { OpportunitySubjectType } from "./models/opportunity-score"
import {
  computeOpportunityScore,
  priceTrend,
  type OpportunitySignals,
  type PriceTrend,
} from "./_scoring"

/**
 * Opportunity Engine (§5) + Economic Intelligence (§15) module service.
 *
 * Owns price observations, materialized opportunity scores, and the startup
 * guide registry. Cross-module signal gathering (demand-pool, wishlist,
 * cooperative, product catalog) is done by the recompute job and the API
 * routes via the request scope — the service stays focused on its own models
 * plus the pure scoring lib.
 */
class OpportunityEngineService extends MedusaService({
  PriceObservation,
  OpportunityScore,
  StartupGuide,
}) {
  /** Pure scoring passthrough (kept on the service for ergonomic callers). */
  score(signals: OpportunitySignals) {
    return computeOpportunityScore(signals)
  }

  async recordPriceObservation(input: {
    category: string
    product_id?: string
    region?: string
    state?: string
    unit?: string
    price_cents: number
    currency_code?: string
    source?: string
    observed_at?: Date
  }) {
    const [obs] = await this.createPriceObservations([
      {
        category: input.category,
        product_id: input.product_id ?? null,
        region: input.region || "US",
        state: input.state ?? null,
        unit: input.unit || "each",
        price_cents: input.price_cents,
        currency_code: input.currency_code || "USD",
        source: input.source || "manual",
        observed_at: input.observed_at || new Date(),
      },
    ])
    return obs
  }

  /** Ordered (oldest→newest) price series for a category/region. */
  async getPriceSeries(filters: {
    category: string
    region?: string
    limit?: number
  }) {
    const where: Record<string, unknown> = { category: filters.category }
    if (filters.region) {
      where.region = filters.region
    }
    return this.listPriceObservations(where, {
      order: { observed_at: "ASC" },
      take: filters.limit || 365,
    })
  }

  /** Trend summary for a category/region built from the stored series. */
  async getPriceTrend(filters: {
    category: string
    region?: string
  }): Promise<PriceTrend> {
    const series = await this.getPriceSeries({ ...filters, limit: 365 })
    return priceTrend(
      (series as Array<{ price_cents: number; observed_at: Date }>).map((s) => ({
        price_cents: Number(s.price_cents),
        observed_at: s.observed_at,
      }))
    )
  }

  /**
   * Upsert a materialized opportunity score, unique on
   * (subject_type, subject_key, region).
   */
  async upsertOpportunityScore(input: {
    subject_type?: OpportunitySubjectType
    subject_key: string
    subject_label?: string
    region?: string
    demand_score: number
    competition_score: number
    startup_cost_score: number
    composite: number
    signals?: Record<string, unknown>
  }) {
    const subject_type = input.subject_type || OpportunitySubjectType.CATEGORY
    const region = input.region || "US"
    const [existing] = await this.listOpportunityScores({
      subject_type,
      subject_key: input.subject_key,
      region,
    })

    const payload = {
      subject_type,
      subject_key: input.subject_key,
      subject_label: input.subject_label ?? input.subject_key,
      region,
      demand_score: input.demand_score,
      competition_score: input.competition_score,
      startup_cost_score: input.startup_cost_score,
      composite: input.composite,
      signals: (input.signals ?? null) as Record<string, unknown> | null,
      computed_at: new Date(),
    }

    if (existing) {
      await this.updateOpportunityScores({ id: existing.id, ...payload })
      const [updated] = await this.listOpportunityScores({ id: existing.id })
      return updated
    }
    const [created] = await this.createOpportunityScores([payload])
    return created
  }

  /** Top opportunities by composite score, optionally scoped to a region. */
  async listTopOpportunities(filters?: {
    region?: string
    subject_type?: OpportunitySubjectType
    limit?: number
    offset?: number
  }) {
    const where: Record<string, unknown> = {}
    if (filters?.region) {
      where.region = filters.region
    }
    if (filters?.subject_type) {
      where.subject_type = filters.subject_type
    }
    return this.listOpportunityScores(where, {
      order: { composite: "DESC" },
      take: filters?.limit || 20,
      skip: filters?.offset || 0,
    })
  }
}

export default OpportunityEngineService
