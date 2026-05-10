import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { readFileSync, existsSync } from "node:fs"

/**
 * Backfill `seller_metadata.mxid` per AGGRESSIVE_OPERATIONS_GUIDE.md §2.1
 * and §5.1.
 *
 * Resolution order for each seller:
 *   1. Manual override CSV (if `MXID_BACKFILL_CSV` env var points to one).
 *      Format: one `email,mxid` pair per line. Comments start with `#`.
 *   2. Synapse user-directory lookup over the matrix-js-sdk client API
 *      (if `MATRIX_HOMESERVER_URL` and `MATRIX_BACKFILL_TOKEN` are set).
 *   3. Best-effort `@<localpart>:<homeserver_default>` synthesis when
 *      `MXID_BACKFILL_DEFAULT_HOMESERVER` is set. Skipped otherwise.
 *
 * The script is **idempotent**: rows with a non-null `mxid` are left
 * untouched. Rows whose resolved MXID already belongs to a different
 * seller are reported and skipped (operator must resolve manually).
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/backfill-mxid.ts
 *
 * Dry-run (no writes):
 *   MXID_BACKFILL_DRY_RUN=1 pnpm medusa exec ./src/scripts/backfill-mxid.ts
 *
 * See `docs/runbooks/MXID_VENDOR_BACKFILL.md` for the operator runbook.
 */
export default async function backfillMxid({ container }: ExecArgs) {
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const dryRun = process.env.MXID_BACKFILL_DRY_RUN === "1"
  const overrides = loadOverrideCsv(process.env.MXID_BACKFILL_CSV)
  const defaultHomeserver = process.env.MXID_BACKFILL_DEFAULT_HOMESERVER || null

  console.log("\n========================================")
  console.log("Backfill seller_metadata.mxid")
  console.log(`  dry-run: ${dryRun ? "yes" : "no"}`)
  console.log(`  overrides: ${overrides.size} email→mxid pairs`)
  console.log(`  default homeserver: ${defaultHomeserver ?? "(none — synthesis disabled)"}`)
  console.log("========================================\n")

  const sellersResult = await pgConnection.raw(`
    SELECT
      sm.id              AS seller_metadata_id,
      sm.seller_id       AS seller_id,
      sm.mxid            AS existing_mxid,
      m.email            AS member_email,
      s.name             AS seller_name
    FROM seller_metadata sm
    INNER JOIN seller   s ON s.id        = sm.seller_id
    INNER JOIN member   m ON m.seller_id = s.id
    WHERE sm.deleted_at IS NULL
    ORDER BY sm.created_at ASC
  `)

  const sellers = sellersResult.rows || []
  console.log(`Found ${sellers.length} seller_metadata rows to consider\n`)

  let updated = 0
  let alreadySet = 0
  let conflict = 0
  let unresolved = 0
  let errors = 0

  const seenMxids = new Map<string, string>() // mxid -> seller_metadata_id

  for (const row of sellers) {
    const { seller_metadata_id, seller_id, existing_mxid, member_email, seller_name } = row
    try {
      if (existing_mxid) {
        seenMxids.set(existing_mxid, seller_metadata_id)
        console.log(`✓  Already set: ${member_email} -> ${existing_mxid}`)
        alreadySet++
        continue
      }

      const resolved = await resolveMxid({
        email: member_email,
        overrides,
        defaultHomeserver,
      })

      if (!resolved) {
        console.log(`?  Unresolved: ${member_email} (${seller_name}) — skip`)
        unresolved++
        continue
      }

      const owner = seenMxids.get(resolved)
      if (owner && owner !== seller_metadata_id) {
        console.log(`!  Conflict: ${resolved} already mapped to ${owner}; ${member_email} skipped`)
        conflict++
        continue
      }

      if (dryRun) {
        console.log(`(dry-run) Would set ${member_email} -> ${resolved}`)
      } else {
        await pgConnection.raw(
          `UPDATE seller_metadata SET mxid = ? WHERE id = ? AND mxid IS NULL`,
          [resolved, seller_metadata_id]
        )
        console.log(`✅ Updated: ${member_email} -> ${resolved} (${seller_name})`)
      }
      seenMxids.set(resolved, seller_metadata_id)
      updated++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`❌ Error processing ${member_email}: ${message}`)
      errors++
    }
  }

  console.log("\n========================================")
  console.log("Backfill complete")
  console.log("========================================")
  console.log(`Updated:     ${updated}${dryRun ? " (dry-run, no writes)" : ""}`)
  console.log(`Already set: ${alreadySet}`)
  console.log(`Conflicts:   ${conflict}`)
  console.log(`Unresolved:  ${unresolved}`)
  console.log(`Errors:      ${errors}`)
  console.log("========================================\n")
}

function loadOverrideCsv(path: string | undefined): Map<string, string> {
  if (!path || !existsSync(path)) return new Map()
  const out = new Map<string, string>()
  const text = readFileSync(path, "utf8")
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const [emailRaw, mxidRaw] = line.split(",")
    const email = (emailRaw || "").trim().toLowerCase()
    const mxid = (mxidRaw || "").trim()
    if (!email || !mxid) continue
    if (!isValidMxid(mxid)) {
      console.warn(`(override CSV) ignoring invalid MXID for ${email}: ${mxid}`)
      continue
    }
    out.set(email, mxid)
  }
  return out
}

const MXID_PATTERN = /^@[A-Za-z0-9._=/-]+:[A-Za-z0-9.-]+$/

function isValidMxid(value: string): boolean {
  return MXID_PATTERN.test(value)
}

async function resolveMxid(args: {
  email: string
  overrides: Map<string, string>
  defaultHomeserver: string | null
}): Promise<string | null> {
  const lowered = args.email.toLowerCase()

  // 1. Manual override CSV.
  const override = args.overrides.get(lowered)
  if (override) return override

  // 2. Synapse user-directory lookup. Optional dependency on matrix-js-sdk;
  //    we lazy-import so the script still runs in environments without it.
  if (process.env.MATRIX_HOMESERVER_URL && process.env.MATRIX_BACKFILL_TOKEN) {
    try {
      // matrix-js-sdk is an optional peer-dep; fall through to synthesis
      // when it isn't installed in the operator's environment.
      const sdkModule: { createClient?: (opts: unknown) => unknown } = await import(
        /* @vite-ignore */ "matrix-js-sdk" as unknown as string
      )
      if (typeof sdkModule.createClient === "function") {
        const client = sdkModule.createClient({
          baseUrl: process.env.MATRIX_HOMESERVER_URL,
          accessToken: process.env.MATRIX_BACKFILL_TOKEN,
        }) as { searchUserDirectory?: (q: { term: string; limit?: number }) => Promise<{ results?: Array<{ user_id?: string }> }> }
        if (typeof client.searchUserDirectory === "function") {
          const result = await client.searchUserDirectory({ term: lowered, limit: 1 })
          const first = result?.results?.[0]?.user_id
          if (first && isValidMxid(first)) return first
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`(matrix-js-sdk) lookup failed for ${lowered}: ${message}`)
    }
  }

  // 3. Best-effort synthesis from email localpart.
  if (args.defaultHomeserver) {
    const localpart = lowered.split("@")[0]?.replace(/[^a-z0-9._=/-]/g, "_")
    if (localpart) {
      const synthetic = `@${localpart}:${args.defaultHomeserver}`
      if (isValidMxid(synthetic)) return synthetic
    }
  }

  return null
}
