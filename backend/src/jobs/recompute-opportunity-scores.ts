import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OPPORTUNITY_ENGINE_MODULE } from "../modules/opportunity-engine"
import type OpportunityEngineService from "../modules/opportunity-engine/service"
import { gatherCategorySignals } from "../modules/opportunity-engine/_signals"
import { OpportunitySubjectType } from "../modules/opportunity-engine/models/opportunity-score"

/**
 * Scheduled job: recompute materialized opportunity scores (§5/§15).
 *
 * For each tracked category subject it gathers live demand/competition/
 * startup-cost signals (`gatherCategorySignals`) and upserts the 0..10
 * composite. The category set is the union of the startup-guide focus areas
 * and any categories that currently have open demand posts, so new demand
 * surfaces automatically.
 */
const SEED_CATEGORIES = [
  "agriculture",
  "gardening",
  "food",
  "home-goods",
  "manufacturing",
  "technology",
  "services",
  "preparedness",
]

export default async function recomputeOpportunityScoresJob(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const engine = container.resolve<OpportunityEngineService>(
    OPPORTUNITY_ENGINE_MODULE
  )

  logger.info("[opportunity-engine] recompute starting")

  const categories = new Set<string>(SEED_CATEGORIES)

  // Pull any additional categories that have live demand.
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "demand_post",
      fields: ["category"],
      filters: { status: ["OPEN", "THRESHOLD_MET"] },
      pagination: { take: 1000 },
    })
    for (const d of data || []) {
      if (d?.category) {
        categories.add(String(d.category))
      }
    }
  } catch {
    // fall back to the seed set
  }

  let upserts = 0
  for (const category of categories) {
    try {
      const snapshot = await gatherCategorySignals(container, {
        category,
        region: "US",
      })
      await engine.upsertOpportunityScore({
        subject_type: OpportunitySubjectType.CATEGORY,
        subject_key: category,
        subject_label: category,
        region: "US",
        demand_score: snapshot.normalized.demand,
        competition_score: snapshot.normalized.competition,
        startup_cost_score: snapshot.normalized.startupCost,
        composite: snapshot.score.composite,
        signals: snapshot as unknown as Record<string, unknown>,
      })
      upserts++
    } catch (e) {
      logger.warn(
        `[opportunity-engine] failed to score "${category}": ${
          (e as Error).message
        }`
      )
    }
  }

  logger.info(`[opportunity-engine] recompute done — ${upserts} scores upserted`)
}

export const config = {
  name: "recompute-opportunity-scores",
  // Every 6 hours.
  schedule: "0 */6 * * *",
}
