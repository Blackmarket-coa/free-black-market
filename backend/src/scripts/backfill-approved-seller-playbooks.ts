import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { backfillApprovedSellerPlaybooks } from "../shared/approved-playbook-backfill"
import { APPLY_OR_DRY_RUN, parseScriptArgs } from "../shared/exec-args"

/**
 * Give sellers approved while the playbook registry was empty the playbook
 * their approved application recorded (`shared/approved-playbook-backfill.ts`).
 *
 *     npx medusa exec ./src/scripts/backfill-approved-seller-playbooks.ts
 *     npx medusa exec ./src/scripts/backfill-approved-seller-playbooks.ts apply
 *
 * The first is a dry run: it writes nothing and lists, for every approved
 * seller application, what it would assign or why it would not. Writing
 * needs the word `apply`; `dry-run` says the default out loud; anything else
 * is refused before anything is read (`shared/exec-args.ts`).
 *
 * A seller who already has an assignment is refused and left as it is, so a
 * second run writes nothing. The registry must be seeded first: the backend
 * does that on every start, so start it once after deploying.
 */
export default async function run({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const tag = "[backfill-approved-seller-playbooks]"
  const parsed = parseScriptArgs(args, APPLY_OR_DRY_RUN)
  if (!parsed.ok) {
    // Thrown, so `medusa exec` exits non-zero: nothing was read or written.
    logger.error(`${tag} refused: ${parsed.message}`)
    throw new Error(`backfill-approved-seller-playbooks refused: ${parsed.message}`)
  }
  const apply = parsed.flags.has("apply")
  const summary = await backfillApprovedSellerPlaybooks(container, { apply })

  for (const entry of apply ? summary.assigned : summary.would_assign) {
    logger.info(
      `${tag} ${apply ? "assigned" : "would assign"} seller ${entry.seller_id} "${entry.recipe_id}" (roles: ${(entry.roles ?? []).join(", ")}) from request ${entry.request_id}`
    )
  }
  for (const entry of summary.review) {
    logger.warn(`${tag} not assigned: request ${entry.request_id}${entry.seller_id ? ` (seller ${entry.seller_id})` : ""}: ${entry.reason}`)
  }
  logger.info(
    `${tag}${apply ? "" : " (dry run: nothing written; add `apply` to write)"} ` +
      `${apply ? "assigned" : "would_assign"}=${apply ? summary.assigned.length : summary.would_assign.length} ` +
      `already_assigned=${summary.already_assigned.length} review=${summary.review.length}`
  )
}
