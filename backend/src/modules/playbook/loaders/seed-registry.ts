import type { LoaderOptions } from "@medusajs/framework/types"
import { createLogger } from "../../../shared/logger"
import {
  seedMissingRegistryRows,
  type RegistryModelService,
} from "../../../shared/registry-seed"
import { playbookRegistryRows, type PlaybookRegistryRow } from "../registry"

/**
 * The key Medusa registers the `Playbook` model's internal service under in
 * this module's own container: `lowerCaseFirst(<entity name>) + "Service"`
 * (modules-sdk's container loader), and `model.define("playbook")` names the
 * entity `Playbook`. Module loaders run in that container, before the module
 * service is registered in the app's; Medusa's own currency module seeds its
 * currencies the same way. Pinned on Postgres by
 * `integration-tests/http/vendor-onboarding-journey.spec.ts`.
 */
export const PLAYBOOK_MODEL_SERVICE_KEY = "playbookService"

/**
 * Seed the `playbook` registry from the recipes in code on every boot,
 * inserting only the recipes it lacks (`shared/registry-seed.ts`).
 *
 * The assign workflow refuses a recipe the registry has no row for, and only
 * `scripts/seed-playbooks.ts` filled the table, which neither the start
 * script nor the seed runs. A module loader, not `src/loaders/`: Medusa 2.14
 * runs module loaders when it loads the module (at `medusa start`,
 * `develop` and `exec`, not in `db:migrate`), and nothing in Medusa 2.14
 * loads a project's `src/loaders` directory.
 */
export default async function seedPlaybookRegistry({
  container,
  logger,
}: LoaderOptions): Promise<void> {
  const log = logger ?? createLogger("modules/playbook/seed-registry")
  let service: RegistryModelService<PlaybookRegistryRow>
  try {
    service = container.resolve(PLAYBOOK_MODEL_SERVICE_KEY)
  } catch (error) {
    log.warn(
      `[playbook registry] no "${PLAYBOOK_MODEL_SERVICE_KEY}" in the module container, so nothing was seeded: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return
  }
  await seedMissingRegistryRows({
    label: "[playbook registry]",
    service,
    key: "recipe_id",
    rows: playbookRegistryRows(),
    logger: log,
  })
}
