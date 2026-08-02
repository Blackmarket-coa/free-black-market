import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { assignPlaybookWorkflow } from "../workflows/assign-playbook"
import {
  LEGACY_VENDOR_TYPE_TO_PLAYBOOK,
  PLAYBOOK_MODULE,
  type PlaybookId,
} from "../modules/playbook"

/**
 * Backfill `playbook_assignment` rows for legacy sellers still keyed on
 * `seller_metadata.vendor_type`.
 *
 * Mapping (canonical, see `docs/PLAYBOOK_SYSTEM.md`):
 *   producer   → cycle
 *   garden     → harvest
 *   kitchen    → kitchen
 *   restaurant → kitchen
 *   maker      → stall
 *   mutual_aid → grove
 *
 * `creator` and any other unrecognized vendor_type values are skipped
 * (operator must run the picker manually or extend this mapping).
 *
 * Idempotent: rows that already have a `playbook_assignment` are left
 * untouched — a deliberate user choice via the picker is never
 * overwritten.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/backfill-playbook-assignments.ts
 *
 * Dry-run (no writes):
 *   PLAYBOOK_BACKFILL_DRY_RUN=1 pnpm medusa exec ./src/scripts/backfill-playbook-assignments.ts
 */

// Imported rather than restated. The local copy this replaces had drifted —
// it was missing `creator`, so creator sellers were logged as unmapped and
// skipped, silently receiving no playbook assignment.
const LEGACY_VENDOR_TYPE_MAP: Record<string, PlaybookId> =
  LEGACY_VENDOR_TYPE_TO_PLAYBOOK

export default async function backfillPlaybookAssignments({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const playbookService: any = container.resolve(PLAYBOOK_MODULE)
  const dryRun = process.env.PLAYBOOK_BACKFILL_DRY_RUN === "1"

  logger.info("========================================")
  logger.info("Backfill playbook_assignment from legacy vendor_type")
  logger.info(`  dry-run: ${dryRun ? "yes" : "no"}`)
  logger.info("========================================")

  const sellersResult = await pgConnection.raw(`
    SELECT
      sm.seller_id   AS seller_id,
      sm.vendor_type AS vendor_type,
      s.name         AS seller_name
    FROM seller_metadata sm
    INNER JOIN seller s ON s.id = sm.seller_id
    WHERE sm.deleted_at IS NULL
      AND sm.vendor_type IS NOT NULL
    ORDER BY sm.created_at ASC
  `)

  const sellers = sellersResult.rows || []
  logger.info(`Found ${sellers.length} sellers with vendor_type set`)

  let migrated = 0
  let skippedExisting = 0
  let skippedUnmapped = 0
  let errors = 0

  for (const row of sellers) {
    const { seller_id, vendor_type, seller_name } = row
    try {
      const [existing] = await playbookService.listPlaybookAssignments({
        seller_id,
      })
      if (existing) {
        skippedExisting++
        continue
      }

      const recipeId = LEGACY_VENDOR_TYPE_MAP[vendor_type]
      if (!recipeId) {
        logger.warn(
          `?  Unmapped vendor_type "${vendor_type}" for ${seller_id} (${seller_name}) — skip`
        )
        skippedUnmapped++
        continue
      }

      if (dryRun) {
        logger.info(
          `(dry-run) Would assign ${seller_id} (${seller_name}): ${vendor_type} → ${recipeId}`
        )
        migrated++
        continue
      }

      await assignPlaybookWorkflow(container).run({
        input: {
          seller_id,
          recipe_id: recipeId,
          migrated_from: vendor_type,
        },
      })
      logger.info(
        `✅ Migrated ${seller_id} (${seller_name}): ${vendor_type} → ${recipeId}`
      )
      migrated++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`❌ Error processing ${seller_id}: ${message}`)
      errors++
    }
  }

  logger.info("========================================")
  logger.info("Backfill complete")
  logger.info("========================================")
  logger.info(`Migrated:           ${migrated}${dryRun ? " (dry-run, no writes)" : ""}`)
  logger.info(`Skipped (existing): ${skippedExisting}`)
  logger.info(`Skipped (unmapped): ${skippedUnmapped}`)
  logger.info(`Errors:             ${errors}`)
  logger.info("========================================")
}
