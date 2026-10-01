const { readdirSync, rmSync, statSync } = require("fs")
const { join } = require("path")

/**
 * Delete the per-test-database schema snapshots MikroORM leaves behind.
 *
 * Every integration run boots a fresh database named `medusa-<something>-integration-N`,
 * and MikroORM writes one `.snapshot-<dbname>.json` per module into that module's
 * `migrations/` directory — around 90 files and 650 MB for a single suite. Nothing
 * ever removes them, so a full `test:integration:http` pass leaks close to 7 GB and
 * successive runs simply accumulate. On a workstation or runner with ~20 GB spare,
 * three passes fill the disk; when that happened here Postgres refused to restart
 * mid-run and an unrelated repo's file-backed store was truncated by the same ENOSPC.
 *
 * Scoped to the `medusa-*-integration-*` database naming on purpose: two snapshots
 * in this tree are named for their module rather than a test database
 * (`.snapshot-order-cycle-module.json`, `.snapshot-ticket-booking.json`) and are
 * checked into git. A broader `.snapshot-*` glob deletes those too.
 *
 * Deleting these is always safe — they are derived state, regenerated on next boot,
 * and already covered by backend/.gitignore.
 */
const SNAPSHOT = /^\.snapshot-medusa-.*-integration-.*\.json$/

module.exports = async () => {
  const modulesDir = join(__dirname, "..", "src", "modules")
  let removed = 0
  let bytes = 0
  let moduleNames = []
  try {
    moduleNames = readdirSync(modulesDir)
  } catch {
    return
  }
  for (const name of moduleNames) {
    const migrations = join(modulesDir, name, "migrations")
    let entries = []
    try {
      entries = readdirSync(migrations)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!SNAPSHOT.test(entry)) continue
      const target = join(migrations, entry)
      try {
        bytes += statSync(target).size
        rmSync(target)
        removed += 1
      } catch {
        // A parallel worker may have removed it already; nothing to do.
      }
    }
  }
  if (removed > 0) {
    const mb = Math.round(bytes / (1024 * 1024))
    console.log(`[prune-orm-snapshots] removed ${removed} test-database snapshots (${mb} MB)`)
  }
}
