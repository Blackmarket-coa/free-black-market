import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { OPPORTUNITY_ENGINE_MODULE } from "../modules/opportunity-engine"
import {
  STARTUP_GUIDES,
  STARTUP_GUIDE_IDS,
} from "../modules/opportunity-engine/startup-guides"

/**
 * Seed the Opportunity Engine: upsert the startup-guide registry from the
 * in-code catalog and lay down a baseline of price observations so the Price
 * Tracker and Economic-Intelligence trends render before live data arrives.
 *
 * Idempotent — re-running upserts any code↔DB drift. Mirrors seed-playbooks.ts.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-opportunity-engine.ts
 */
export default async function seedOpportunityEngine({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const engine: any = container.resolve(OPPORTUNITY_ENGINE_MODULE)

  logger.info("[seed-opportunity-engine] starting")

  // ── Startup guides (§12) ──
  let guidesUpserted = 0
  for (const id of STARTUP_GUIDE_IDS) {
    const g = STARTUP_GUIDES[id]
    const [existing] = await engine.listStartupGuides({ guide_id: g.id })
    const payload = {
      guide_id: g.id,
      slug: g.slug,
      title: g.title,
      category: g.category,
      summary: g.summary,
      estimated_startup_cost_cents: g.estimated_startup_cost_cents,
      difficulty: g.difficulty,
      required_equipment: g.required_equipment,
      production_suggestions: g.production_suggestions,
      related_archetypes: g.related_archetypes,
      related_opportunity_key: g.related_opportunity_key,
      is_active: true,
    }
    if (existing) {
      await engine.updateStartupGuides({ id: existing.id, ...payload })
    } else {
      await engine.createStartupGuides(payload)
    }
    guidesUpserted++
  }
  logger.info(`[seed-opportunity-engine] upserted ${guidesUpserted} startup guides`)

  // ── Baseline price observations (§5 Price Tracker / §15 trends) ──
  // A small synthetic series per focus category so the tracker has shape.
  // Skipped entirely if observations already exist (don't duplicate on re-run).
  const focus: Array<{ category: string; base: number; unit: string }> = [
    { category: "food", base: 320, unit: "lb" },
    { category: "gardening", base: 450, unit: "each" },
    { category: "agriculture", base: 1800, unit: "cubic-yard" },
    { category: "home-goods", base: 650, unit: "each" },
  ]
  const regions = ["US", "CA", "TX", "NY"]
  let obsCreated = 0
  for (const f of focus) {
    const [existing] = await engine.listPriceObservations({
      category: f.category,
    })
    if (existing) {
      continue
    }
    for (const region of regions) {
      // 6 monthly points with a mild upward drift + per-region offset.
      for (let m = 5; m >= 0; m--) {
        const observed = new Date()
        observed.setMonth(observed.getMonth() - m)
        const drift = 1 + (5 - m) * 0.02
        const regionOffset =
          region === "US" ? 1 : 1 + (region.charCodeAt(0) % 7) / 100
        await engine.recordPriceObservation({
          category: f.category,
          region,
          unit: f.unit,
          price_cents: Math.round(f.base * drift * regionOffset),
          source: "seed",
          observed_at: observed,
        })
        obsCreated++
      }
    }
  }
  logger.info(
    `[seed-opportunity-engine] created ${obsCreated} baseline price observations`
  )
  logger.info("[seed-opportunity-engine] done")
}
