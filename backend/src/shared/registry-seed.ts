/**
 * Seed a code-defined registry table at boot: insert the rows whose key is
 * missing, and leave every row that is there alone.
 *
 * Used by the playbook and listing-type module loaders. Those registries were
 * filled only by `scripts/seed-playbooks.ts`, which nothing ran, so on a fresh
 * database the playbook registry was empty: approval logged the assignment's
 * "not found in registry" error as a warning and dropped the applicant's
 * playbook, and `POST /vendor/playbook/assign` answered 500.
 *
 * - Keyed: a row is present when a row with its key exists, soft-deleted rows
 *   included. A key has a unique constraint, so a deleted row's key cannot be
 *   inserted again anyway, and an operator who deleted a row meant it.
 * - Never overwrites: a row that is present is not compared or updated, so an
 *   operator's edit (deactivating a playbook, rewording its blurb) survives
 *   every restart. `scripts/seed-playbooks.ts` is still the deliberate way to
 *   push the code's values over the table.
 * - Never fails boot: a database that is not migrated yet, or any other
 *   error, is logged and the loader returns. Two processes booting together
 *   insert in one transaction each; the key's unique constraint refuses the
 *   second, which then finds every row present and says so.
 */

/** The slice of a module's internal model service a registry seed uses. */
export type RegistryModelService<Row> = {
  list(
    filters: Record<string, unknown>,
    config: { withDeleted?: boolean }
  ): Promise<Array<Record<string, unknown>>>
  create(rows: Row[]): Promise<unknown>
}

type SeedLogger = {
  info(message: string): void
  warn(message: string): void
}

export type RegistrySeedOutcome =
  /** Missing rows were inserted (none when everything was present). */
  | { status: "seeded"; created: string[] }
  /** Another process inserted the missing rows first. */
  | { status: "seeded_elsewhere"; created: [] }
  /** Nothing was read or written; the reason was logged. */
  | { status: "failed"; error: string }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function seedMissingRegistryRows<
  Row extends Record<string, unknown>,
>(args: {
  /** Log prefix, e.g. "[playbook registry]". */
  label: string
  service: RegistryModelService<Row>
  /** The unique column rows are matched on, e.g. "recipe_id". */
  key: keyof Row & string
  rows: Row[]
  logger: SeedLogger
}): Promise<RegistrySeedOutcome> {
  const { label, service, key, rows, logger } = args
  const keyOf = (row: Record<string, unknown>) => String(row[key])
  const keys = rows.map(keyOf)

  const presentKeys = async () =>
    new Set(
      (await service.list({ [key]: keys }, { withDeleted: true })).map(keyOf)
    )

  let present: Set<string>
  try {
    present = await presentKeys()
  } catch (error) {
    logger.warn(
      `${label} could not read the registry, so nothing was seeded (is the database migrated?): ${messageOf(error)}`
    )
    return { status: "failed", error: messageOf(error) }
  }

  const missing = rows.filter((row) => !present.has(keyOf(row)))
  if (!missing.length) {
    logger.info(`${label} all ${rows.length} rows present; nothing seeded`)
    return { status: "seeded", created: [] }
  }

  try {
    await service.create(missing)
  } catch (error) {
    try {
      const now = await presentKeys()
      if (missing.every((row) => now.has(keyOf(row)))) {
        logger.info(
          `${label} another process seeded the ${missing.length} missing row(s) first`
        )
        return { status: "seeded_elsewhere", created: [] }
      }
    } catch {
      // Reported below with the error that mattered.
    }
    logger.warn(
      `${label} could not seed ${missing.map(keyOf).join(", ")}: ${messageOf(error)}`
    )
    return { status: "failed", error: messageOf(error) }
  }

  const created = missing.map(keyOf)
  logger.info(
    `${label} seeded ${created.length} missing row(s): ${created.join(", ")}`
  )
  return { status: "seeded", created }
}
