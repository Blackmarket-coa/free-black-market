import { createLogger } from "../shared/logger"
const log = createLogger("jobs/progression-karma-mirror")
import { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import { PROGRESSION_MODULE } from "../modules/progression"
import { mirrorXpEventsToKarma } from "../modules/progression/karma-mirror"

/**
 * W4 (decision D7): mirror the XP log into the canonical karma log.
 *
 * Every `xp_event` row becomes a `karma_event` with
 * `source_module: "progression", source_id: <xp_event.id>`, recorded
 * through the canonical write path (validated, attested, idempotent per
 * source pair — the partial unique index makes re-runs free). Consumers
 * keep reading xp_event; it is now a derived per-context projection whose
 * rows correspond one-to-one with the canonical log's progression slice.
 *
 * Mirroring at a scheduled seam (the asset-graph reconciler precedent)
 * captures every XP writer — subscribers, quest helpers, wellness/grower
 * emitters, and any future path — without touching their call sites.
 * The sweep logic lives in `modules/progression/karma-mirror.ts` so it is
 * testable with fakes; this job is the thin wrapper.
 */
export default async function progressionKarmaMirrorJob(
  container: MedusaContainer
): Promise<void> {
  const progression: any = container.resolve(PROGRESSION_MODULE)
  const hawala: any = container.resolve(HAWALA_LEDGER_MODULE)

  const summary = await mirrorXpEventsToKarma(progression, hawala)

  log.info(
    `[karma-mirror] scanned=${summary.scanned} mirrored=${summary.mirrored} ` +
      `already=${summary.already_mirrored} skipped=${summary.skipped} ` +
      `failed=${summary.failed}`
  )
  for (const error of summary.errors) {
    log.error(`[karma-mirror] FAILED ${error}`)
  }
}

export const config = {
  name: "progression-karma-mirror",
  // Every 15 minutes, offset from the settlement reconciler so the two
  // sweeps don't stack on the same tick.
  schedule: "7,22,37,52 * * * *",
}
