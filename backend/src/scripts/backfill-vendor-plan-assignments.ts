import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import { getPlanDefinition } from "../modules/vendor-plan/catalog"
import { VendorPlanAssignedBy } from "../modules/vendor-plan/models"

/**
 * Give every existing seller a plan assignment.
 *
 * `--default-plan=<code>` is REQUIRED and deliberately has no fallback.
 *
 * The rollout decision for this work is "enforce immediately, no
 * grandfathering", which means whichever plan is chosen here is what every
 * existing vendor drops to the moment the gate goes live. Defaulting that to
 * `free` in code would bury the single highest-blast-radius decision in this
 * whole change inside a script. Making it an explicit argument forces a human
 * to make it at run time, with the consequence in front of them.
 *
 * To keep FBM's own vendors whole, pass `--default-plan=internal` (the
 * operator-assigned plan carrying every feature). That is a plan assignment,
 * not a grandfather clause, and stays consistent with the chosen rollout.
 *
 * Run (dry run first):
 *   pnpm medusa exec ./src/scripts/backfill-vendor-plan-assignments.ts -- --default-plan=free --dry-run
 *   pnpm medusa exec ./src/scripts/backfill-vendor-plan-assignments.ts -- --default-plan=free
 */
export default async function backfillVendorPlanAssignments({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const plans: any = container.resolve(VENDOR_PLAN_MODULE)

  const argv = args ?? []
  const planArg = argv.find((a) => a.startsWith("--default-plan="))
  const dryRun =
    argv.includes("--dry-run") || process.env.PLAN_BACKFILL_DRY_RUN === "1"

  if (!planArg) {
    logger.error(
      "[backfill-vendor-plan] --default-plan=<code> is required. " +
        "Every seller without an assignment will be placed on this plan, and " +
        "with enforcement live that is what they are limited to. " +
        "Use --default-plan=internal to keep existing vendors whole."
    )
    throw new Error("--default-plan is required")
  }

  const defaultPlan = planArg.split("=")[1]?.trim()
  const def = getPlanDefinition(defaultPlan)
  if (!def) {
    logger.error(`[backfill-vendor-plan] unknown plan code "${defaultPlan}"`)
    throw new Error(`unknown plan code "${defaultPlan}"`)
  }

  logger.info(
    `[backfill-vendor-plan] default plan "${def.code}" grants ${def.feature_keys.length} feature key(s)` +
      (dryRun ? " — DRY RUN, no writes" : "")
  )

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id"],
  })

  let assigned = 0
  let skipped = 0

  for (const seller of sellers ?? []) {
    const sellerId = (seller as { id?: string })?.id
    if (!sellerId) continue

    const [existing] = await plans.listVendorPlanAssignments({
      seller_id: sellerId,
    })
    if (existing) {
      skipped++
      continue
    }

    if (dryRun) {
      assigned++
      continue
    }

    const now = new Date()
    await plans.createVendorPlanAssignments({
      seller_id: sellerId,
      plan_code: def.code,
      status: "active",
      started_at: now,
      activated_at: now,
      assigned_by: VendorPlanAssignedBy.MIGRATION,
    })
    assigned++
  }

  logger.info(
    `[backfill-vendor-plan] ${assigned} assigned, ${skipped} already had an assignment` +
      (dryRun ? " (dry run)" : "")
  )
}
