import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { APPLY_OR_DRY_RUN, parseScriptArgs } from "../shared/exec-args"
import { VENDOR_PLAN_MODULE } from "../modules/vendor-plan"
import { getPlanDefinition } from "../modules/vendor-plan/catalog"
import { VendorPlanAssignedBy } from "../modules/vendor-plan/models"

/**
 * Give every existing seller a plan assignment.
 *
 * `default-plan=<code>` is REQUIRED and deliberately has no fallback.
 *
 * The rollout decision for this work is "enforce immediately, no
 * grandfathering", which means whichever plan is chosen here is what every
 * existing vendor drops to the moment the gate goes live. Defaulting that to
 * `free` in code would bury the single highest-blast-radius decision in this
 * whole change inside a script. Making it an explicit argument forces a human
 * to make it at run time, with the consequence in front of them.
 *
 * To keep FBM's own vendors whole, pass `default-plan=internal` (the
 * operator-assigned plan carrying every feature). That is a plan assignment,
 * not a grandfather clause, and stays consistent with the chosen rollout.
 *
 * A dry run unless given `apply`, so the preview really comes first:
 *   pnpm medusa exec ./src/scripts/backfill-vendor-plan-assignments.ts default-plan=free
 *   pnpm medusa exec ./src/scripts/backfill-vendor-plan-assignments.ts default-plan=free apply
 *
 * `dry-run` may be given to say so; `apply dry-run` is refused, and
 * `PLAN_BACKFILL_DRY_RUN=1` in the environment forces a dry run even with
 * `apply`.
 *
 * Bare words. This used to document `-- --default-plan=free --dry-run`, and the
 * script could not be run at all: `medusa exec` drops everything after `--`
 * (so the plan never arrived and the script refused), and refuses
 * `--default-plan=…` on its own as an unknown option. Any other argument, or a
 * `--` separator, is refused (`shared/exec-args.ts`).
 */
export default async function backfillVendorPlanAssignments({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const plans: any = container.resolve(VENDOR_PLAN_MODULE)

  const parsed = parseScriptArgs(args, {
    ...APPLY_OR_DRY_RUN,
    options: ["default-plan"],
  })
  if (!parsed.ok) {
    // Thrown, so `medusa exec` exits non-zero: nothing was read or written.
    logger.error(`[backfill-vendor-plan] refused: ${parsed.message}`)
    throw new Error(`backfill-vendor-plan refused: ${parsed.message}`)
  }
  const defaultPlan = parsed.options.get("default-plan")
  const dryRun =
    !parsed.flags.has("apply") || process.env.PLAN_BACKFILL_DRY_RUN === "1"

  if (!defaultPlan) {
    logger.error(
      "[backfill-vendor-plan] default-plan=<code> is required. " +
        "Every seller without an assignment will be placed on this plan, and " +
        "with enforcement live that is what they are limited to. " +
        "Use default-plan=internal to keep existing vendors whole."
    )
    throw new Error("default-plan=<code> is required")
  }

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
  if (dryRun) {
    logger.info(
      process.env.PLAN_BACKFILL_DRY_RUN === "1"
        ? "[backfill-vendor-plan] dry run forced by PLAN_BACKFILL_DRY_RUN=1, nothing written"
        : `[backfill-vendor-plan] dry run, nothing written: re-run with \`default-plan=${def.code} apply\` to assign`
    )
  }
}
