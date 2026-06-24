import { createLogger } from "../shared/logger"
const log = createLogger("jobs/xp-demurrage")
import { MedusaContainer } from "@medusajs/framework/types"
import { PROGRESSION_MODULE } from "../modules/progression"
import type ProgressionModuleService from "../modules/progression/service"

/**
 * Weekly demurrage sweep on **spendable** XP.
 *
 * A small recurring decay keeps spendable XP circulating rather than hoarded
 * (Sarafu / Gesell precedent). Lifetime `total_xp`, role levels, and titles are
 * never touched — only the spendable allowance, and only the portion above the
 * grace floor (ADR-0003).
 *
 * Rate and grace floor are configurable via env:
 *   - XP_DEMURRAGE_RATE      (default 0.02 = 2% of the above-floor balance/week)
 *   - XP_DEMURRAGE_MIN_BALANCE (default 100 XP grace floor)
 *
 * The work is delegated to the service's `applyDemurrage` so the decay logic is
 * unit-tested there; this job is just the scheduled, container-bound shell.
 */
function readConfig() {
  const rate = Number(process.env.XP_DEMURRAGE_RATE)
  const minBalance = Number(process.env.XP_DEMURRAGE_MIN_BALANCE)
  return {
    rate: Number.isFinite(rate) ? rate : 0.02,
    minBalance: Number.isFinite(minBalance) ? minBalance : 100,
  }
}

export async function runXpDemurrage(
  progression: ProgressionModuleService,
  opts: { rate: number; minBalance: number }
) {
  return progression.applyDemurrage(opts)
}

export default async function xpDemurrageJob(
  container: MedusaContainer
): Promise<void> {
  const progression =
    container.resolve<ProgressionModuleService>(PROGRESSION_MODULE)
  const opts = readConfig()

  log.info(
    `[xp-demurrage] Starting demurrage sweep (rate=${opts.rate}, floor=${opts.minBalance})`
  )

  const results = await runXpDemurrage(progression, opts)

  const touched = results.filter((r) => r.decayed > 0).length
  const totalDecayed = results.reduce((sum, r) => sum + r.decayed, 0)
  const failed = results.filter((r) => r.error)

  log.info(
    `[xp-demurrage] Swept ${results.length} sheets: ` +
      `decayed=${touched}, totalXp=${totalDecayed}, failed=${failed.length}`
  )

  for (const f of failed) {
    log.error(`[xp-demurrage] FAILED ${f.customer_id}: ${f.error}`)
  }
}

export const config = {
  name: "xp-demurrage",
  // Weekly, Sunday 03:00 — off-peak, well clear of redemption traffic.
  schedule: "0 3 * * 0",
}
