import { createHash } from "node:crypto"
import { createReadStream, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Readable } from "node:stream"
import { ContainerRegistrationKeys, MedusaService } from "@medusajs/framework/utils"
import { IrsExemptOrg, IrsIngestSnapshot, IrsPub78Listing, IrsRevocation } from "./models"
import { normalizeEin } from "./ein"
import {
  resolveIrsLookup,
  type BmfRecord,
  type IrsLookupResult,
  type IrsSourcesAsOf,
  type Pub78Record,
  type RevocationRecord,
} from "./lookup"
import { parseEoBmfStream } from "./parsers/eo-bmf"
import { parsePub78Stream } from "./parsers/pub78"
import { parseRevocationStream } from "./parsers/revocation"
import { IRS_SOURCES, IRS_SOURCE_URLS, type IrsSource } from "./sources"
import { openZipEntry } from "./zip-entry"

/** The slice of a knex connection the ingest needs. */
export type PgRaw = {
  raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: unknown[] }>
}
export type PgLike = PgRaw & {
  transaction: <T>(fn: (trx: PgRaw) => Promise<T>) => Promise<T>
}

/** What a conditional download of one URL came back with. */
export type FetchToFileResult = {
  status: 200 | 304
  lastModified: Date | null
  etag: string | null
  /** Hex sha256 of the body; null on 304. */
  sha256: string | null
  bytes: number
}

/**
 * Downloads `url` to `destPath`, sending the conditional headers when given.
 * Injected so the ingest can be driven from fixtures with no network.
 */
export type FetchToFile = (
  url: string,
  opts: { destPath: string; ifNoneMatch?: string | null; ifModifiedSince?: Date | null }
) => Promise<FetchToFileResult>

export type IngestDeps = {
  fetchToFile: FetchToFile
  now?: () => Date
  /** A knex-like connection; resolved from the container when omitted. */
  pg?: PgLike
  tmpDir?: string
  /** Rows per `INSERT … VALUES` statement. */
  batchSize?: number
}

export type IngestOutcome =
  | { source: IrsSource; outcome: "skipped_unchanged"; as_of: Date | null }
  | { source: IrsSource; outcome: "ingested"; row_count: number; as_of: Date }
  | { source: IrsSource; outcome: "failed"; error: string }

export type SnapshotRow = {
  id: string
  source: IrsSource
  as_of: Date | null
  etag: string | null
  sha256: string | null
  row_count: number | null
  status: "pending" | "complete" | "failed"
  started_at: Date | null
  finished_at: Date | null
  error: string | null
  metadata: SnapshotMetadata | null
}

type SnapshotMetadata = {
  files?: Record<string, { etag: string | null; last_modified: string | null }>
  last_outcome?: string
  last_checked_at?: string
}

type Table = {
  live: string
  staging: string
  columns: readonly string[]
  /**
   * The column the batch upsert conflicts on. Rows inside one batch are
   * de-duplicated on it before the INSERT, and the staging table's unique
   * index on it is created by `ensureStagingTable` when missing.
   */
  key: "ein" | "id"
  /**
   * Name of that unique index. For the two `ein`-keyed tables it is the
   * migration's index name, so `CREATE UNIQUE INDEX IF NOT EXISTS` is a no-op
   * in production. For the revocation table the key is the primary key, and
   * the index name is the one Postgres gives a PRIMARY KEY's backing index
   * ("<table>_pkey"): where the migration ran, the name is taken and nothing
   * happens; where only the models exist (the module test harness), a plain
   * unique index of that name is created and serves as the conflict target.
   */
  conflictIndex: string
  conflict: string
}

const TABLES: Record<IrsSource, Table> = {
  eo_bmf: {
    live: "irs_exempt_org",
    staging: "irs_exempt_org_staging",
    columns: [
      "id", "ein", "name", "city", "state", "zip5", "subsection", "classification",
      "ruling", "deductibility", "foundation", "status", "ntee_cd", "sort_name",
    ],
    key: "ein",
    conflictIndex: "UQ_irs_exempt_org_staging_ein",
    conflict: `ON CONFLICT ("ein") DO UPDATE SET
      "name" = EXCLUDED."name", "city" = EXCLUDED."city", "state" = EXCLUDED."state",
      "zip5" = EXCLUDED."zip5", "subsection" = EXCLUDED."subsection",
      "classification" = EXCLUDED."classification", "ruling" = EXCLUDED."ruling",
      "deductibility" = EXCLUDED."deductibility", "foundation" = EXCLUDED."foundation",
      "status" = EXCLUDED."status", "ntee_cd" = EXCLUDED."ntee_cd",
      "sort_name" = EXCLUDED."sort_name"`,
  },
  pub78: {
    live: "irs_pub78_listing",
    staging: "irs_pub78_listing_staging",
    columns: ["id", "ein", "name", "city", "state", "country", "deductibility_codes"],
    key: "ein",
    conflictIndex: "UQ_irs_pub78_listing_staging_ein",
    conflict: `ON CONFLICT ("ein") DO UPDATE SET
      "name" = EXCLUDED."name", "city" = EXCLUDED."city", "state" = EXCLUDED."state",
      "country" = EXCLUDED."country", "deductibility_codes" = EXCLUDED."deductibility_codes"`,
  },
  revocation: {
    live: "irs_revocation",
    staging: "irs_revocation_staging",
    columns: [
      "id", "ein", "legal_name", "dba_name", "city", "state", "country",
      "exemption_type", "revocation_date", "posting_date", "reinstatement_date",
    ],
    // One row per (ein, posting, revocation) event; an exact duplicate line in
    // the file is the same event and is dropped, not doubled.
    key: "id",
    conflictIndex: "irs_revocation_staging_pkey",
    conflict: `ON CONFLICT ("id") DO NOTHING`,
  },
}

const DEFAULT_BATCH = 2_000
const ymd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, "")
const errorMessage = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err)

/**
 * IRS exempt-organisation data: ingest and lookup.
 *
 * **Moves no money.** This service reads three public IRS bulk files and
 * answers "what did the file dated X say about EIN Y". It never touches a
 * cart, order, payout or ledger entry.
 *
 * Ingest shape, per source:
 *
 *   conditional GET → (304: stop) → stream to temp file → parse line by line
 *   → batched `INSERT … ON CONFLICT` into the staging table → one transaction:
 *   `TRUNCATE live; INSERT INTO live SELECT FROM staging; snapshot = complete`
 *
 * Nothing is buffered beyond one batch of rows. Jobs run in the API process
 * (medusa-config.ts has no workerMode), so every batch is awaited and the
 * event loop gets a turn between them. A failure at any step leaves the
 * previous live rows and their `as_of` untouched and marks the snapshot
 * `failed` with the error. Never the row-at-a-time shape of hawala's
 * `ingestExternalRecords`: at 1.9M rows that is 3.8M round trips.
 */
class IrsExemptOrgModuleService extends MedusaService({
  IrsExemptOrg,
  IrsPub78Listing,
  IrsRevocation,
  IrsIngestSnapshot,
}) {
  /**
   * A knex connection with `.raw` and `.transaction`, or undefined when none
   * is reachable (unit tests without DI).
   *
   * `__container__` is the module's awilix **cradle** (modules-sdk
   * `load-internal`: `new moduleService(localContainer.cradle, …)`), which
   * registers `PG_CONNECTION` for every module. On a cradle every property
   * read is a resolve, so reading `.resolve` on it *throws* (there is no
   * registration named "resolve"). The property read therefore has to come
   * first: `container?.resolve?.(…) ?? container?.[key]` never reaches the
   * `??` on a cradle, and everything silently rode the EntityManager
   * fallback. Order here: cradle property read, then a real container's
   * `.resolve`, then the EntityManager's knex (what the module
   * integration-test harness exposes).
   */
  resolvePgConnection(): PgLike | undefined {
    const container = (this as unknown as { __container__?: Record<string, unknown> & {
      resolve?: (key: string) => unknown
    } }).__container__
    const looksLikePg = (c: unknown): c is PgLike =>
      !!c &&
      typeof (c as PgLike).raw === "function" &&
      typeof (c as PgLike).transaction === "function"
    try {
      const pg = container?.[ContainerRegistrationKeys.PG_CONNECTION]
      if (looksLikePg(pg)) return pg
    } catch {
      // an awilix cradle throws on an unregistered key; fall through
    }
    try {
      const pg = container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION)
      if (looksLikePg(pg)) return pg
    } catch {
      // fall through
    }
    try {
      const self = this as unknown as {
        baseRepository_?: { getActiveManager?: () => unknown }
      }
      const em = (self.baseRepository_?.getActiveManager?.() ?? container?.manager) as
        | { getConnection?: () => { getKnex?: () => unknown } }
        | undefined
      const knex = em?.getConnection?.()?.getKnex?.()
      if (looksLikePg(knex)) return knex
    } catch {
      // no reachable connection
    }
    return undefined
  }

  // ---------------------------------------------------------------- snapshots

  async readSnapshot(pg: PgRaw, source: IrsSource): Promise<SnapshotRow | null> {
    const result = await pg.raw(
      `SELECT id, source, as_of, etag, sha256, row_count, status, started_at, finished_at, error, metadata
         FROM irs_ingest_snapshot
        WHERE source = ? AND deleted_at IS NULL
        LIMIT 1`,
      [source]
    )
    const row = result?.rows?.[0] as SnapshotRow | undefined
    return row ?? null
  }

  /** Every source's snapshot row, keyed by source; missing sources are null. */
  async getSnapshots(): Promise<Record<IrsSource, SnapshotRow | null>> {
    const rows = (await this.listIrsIngestSnapshots({})) as unknown as SnapshotRow[]
    const out = Object.fromEntries(IRS_SOURCES.map((s) => [s, null])) as Record<
      IrsSource,
      SnapshotRow | null
    >
    for (const row of rows) {
      if (row && (IRS_SOURCES as readonly string[]).includes(row.source)) out[row.source] = row
    }
    return out
  }

  private async markAttempt(pg: PgRaw, source: IrsSource, startedAt: Date): Promise<void> {
    await pg.raw(
      `INSERT INTO irs_ingest_snapshot (id, source, status, started_at, finished_at, error, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, NULL, NULL, NOW(), NOW())
       ON CONFLICT ("source") WHERE deleted_at IS NULL
       DO UPDATE SET status = 'pending', started_at = EXCLUDED.started_at,
                     finished_at = NULL, error = NULL, updated_at = NOW()`,
      [`irssnap_${source}`, source, startedAt]
    )
  }

  private async markFailed(pg: PgRaw, source: IrsSource, finishedAt: Date, error: string): Promise<void> {
    await pg.raw(
      `UPDATE irs_ingest_snapshot
          SET status = 'failed', finished_at = ?, error = ?, updated_at = NOW()
        WHERE source = ? AND deleted_at IS NULL`,
      [finishedAt, error.slice(0, 2_000), source]
    )
  }

  private async markUnchanged(
    pg: PgRaw,
    source: IrsSource,
    finishedAt: Date,
    metadata: SnapshotMetadata
  ): Promise<void> {
    await pg.raw(
      `UPDATE irs_ingest_snapshot
          SET status = 'complete', finished_at = ?, error = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb, updated_at = NOW()
        WHERE source = ? AND deleted_at IS NULL`,
      [finishedAt, JSON.stringify(metadata), source]
    )
  }

  // ------------------------------------------------------------------ ingest

  /**
   * Ingest one source. Returns the outcome; throws only when no database
   * connection can be found at all (a configuration error, not a data one).
   */
  async ingestSource(source: IrsSource, deps: IngestDeps): Promise<IngestOutcome> {
    if (!TABLES[source]) throw new Error(`irs-exempt-org: unknown source ${String(source)}`)
    const pg = deps.pg ?? this.resolvePgConnection()
    if (!pg) throw new Error("irs-exempt-org: no database connection reachable for ingest")
    const now = deps.now ?? (() => new Date())
    const table = TABLES[source]
    const startedAt = now()

    const previous = await this.readSnapshot(pg, source)
    await this.markAttempt(pg, source, startedAt)

    const tmpDir = await fs.mkdtemp(path.join(deps.tmpDir ?? os.tmpdir(), `irs-${source}-`))
    try {
      const urls = IRS_SOURCE_URLS[source]
      const previousFiles = previous?.metadata?.files ?? {}
      const files: Array<{ url: string; path: string; result: FetchToFileResult }> = []

      for (const [i, url] of urls.entries()) {
        const dest = path.join(tmpDir, `part-${i}`)
        const prior = previousFiles[url]
        const ifNoneMatch = prior?.etag ?? null
        const ifModifiedSince = prior?.last_modified ? new Date(prior.last_modified) : null
        const result = await deps.fetchToFile(url, { destPath: dest, ifNoneMatch, ifModifiedSince })
        // A 304 is only an answer to a conditional request. On the first ever
        // run there is nothing to compare against, so a 304 here would be
        // treated as "unchanged" and the snapshot marked complete with no
        // data and `as_of` NULL. Same guard as the re-fetch below.
        if (result.status === 304 && !ifNoneMatch && !ifModifiedSince) {
          throw new Error(`irs-exempt-org: ${url} answered 304 to an unconditional request`)
        }
        files.push({ url, path: dest, result })
      }

      const unchanged = files.every((f) => f.result.status === 304)
      if (unchanged) {
        const finishedAt = now()
        await this.markUnchanged(pg, source, finishedAt, {
          last_outcome: "unchanged",
          last_checked_at: finishedAt.toISOString(),
        })
        return { source, outcome: "skipped_unchanged", as_of: previous?.as_of ?? null }
      }

      // A multi-file source is one snapshot: if any part changed, every part
      // is reloaded, so a part that answered 304 is fetched again without
      // conditions. Mixed-vintage files would make `as_of` a lie.
      for (const f of files) {
        if (f.result.status === 304) {
          f.result = await deps.fetchToFile(f.url, { destPath: f.path })
          if (f.result.status !== 200) {
            throw new Error(`irs-exempt-org: ${f.url} answered 304 to an unconditional request`)
          }
        }
      }

      await this.ensureStagingTable(pg, table)
      await pg.raw(`TRUNCATE "${table.staging}"`)
      let rowCount = 0
      for (const f of files) {
        rowCount += await this.loadIntoStaging(source, f.path, pg, deps.batchSize ?? DEFAULT_BATCH)
      }

      const lastModified = files
        .map((f) => f.result.lastModified)
        .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
      const asOf = lastModified.length
        ? lastModified.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
        : startedAt
      const etag = files.map((f) => f.result.etag ?? "").join(",")
      const sha256 = files.length === 1 ? files[0].result.sha256 : combineHashes(files.map((f) => f.result.sha256))
      const finishedAt = now()
      const metadata: SnapshotMetadata = {
        files: Object.fromEntries(
          files.map((f) => [
            f.url,
            { etag: f.result.etag, last_modified: f.result.lastModified?.toISOString() ?? null },
          ])
        ),
        last_outcome: "ingested",
        last_checked_at: finishedAt.toISOString(),
      }

      const cols = table.columns.map((c) => `"${c}"`).join(", ")
      await pg.transaction(async (trx) => {
        await trx.raw(`TRUNCATE "${table.live}"`)
        await trx.raw(
          `INSERT INTO "${table.live}" (${cols}, created_at, updated_at)
           SELECT ${cols}, created_at, updated_at FROM "${table.staging}"`
        )
        await trx.raw(
          `UPDATE irs_ingest_snapshot
              SET status = 'complete', as_of = ?, etag = ?, sha256 = ?, row_count = ?,
                  finished_at = ?, error = NULL, metadata = ?::jsonb, updated_at = NOW()
            WHERE source = ? AND deleted_at IS NULL`,
          [asOf, etag || null, sha256, rowCount, finishedAt, JSON.stringify(metadata), source]
        )
      })
      // Release the staging space now rather than at the next run.
      await pg.raw(`TRUNCATE "${table.staging}"`)

      return { source, outcome: "ingested", row_count: rowCount, as_of: asOf }
    } catch (err) {
      const message = errorMessage(err)
      try {
        await this.markFailed(pg, source, now(), message)
      } catch {
        // The failure itself is what gets reported; losing the bookkeeping
        // write on top of it must not hide the original error.
      }
      return { source, outcome: "failed", error: message }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /**
   * The service owns its staging tables. The migration creates them too, but
   * `@medusajs/test-utils` builds a module's schema from its models
   * (`schema.refreshDatabase()`, no migrations path), so in that harness the
   * UNLOGGED twins do not exist and the first `TRUNCATE` would fail every
   * ingest. Both statements are `IF NOT EXISTS`: where the migration ran they
   * are no-ops. `LIKE live INCLUDING DEFAULTS` keeps the column set and the
   * `now()` defaults in step with the live table and copies no constraint or
   * index, so the only unique index on staging is the batch upsert's conflict
   * target, created here.
   */
  private async ensureStagingTable(pg: PgRaw, table: Table): Promise<void> {
    await pg.raw(
      `CREATE UNLOGGED TABLE IF NOT EXISTS "${table.staging}" (LIKE "${table.live}" INCLUDING DEFAULTS)`
    )
    await pg.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${table.conflictIndex}" ON "${table.staging}" ("${table.key}")`
    )
  }

  /**
   * Stream-parse one downloaded file into the source's staging table.
   *
   * Each batch is de-duplicated on the conflict column before it is flushed
   * (last row wins): a multi-row `INSERT … ON CONFLICT DO UPDATE` that meets
   * the same key twice fails whole with "cannot affect row a second time".
   * Duplicates across batches are handled by the upsert itself. The returned
   * count is rows flushed, so an EIN repeated across two batches counts twice.
   */
  private async loadIntoStaging(
    source: IrsSource,
    filePath: string,
    pg: PgRaw,
    batchSize: number
  ): Promise<number> {
    const table = TABLES[source]
    const keyAt = table.columns.indexOf(table.key)
    const rows = this.rowsFrom(source, filePath)
    let batch = new Map<string, unknown[]>()
    let count = 0
    for await (const values of rows) {
      batch.set(String(values[keyAt]), values)
      if (batch.size >= batchSize) {
        await this.flush(pg, table, [...batch.values()])
        count += batch.size
        batch = new Map()
        // Let request handling get a turn: this runs in the API process.
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    if (batch.size) {
      await this.flush(pg, table, [...batch.values()])
      count += batch.size
    }
    return count
  }

  private async *rowsFrom(source: IrsSource, filePath: string): AsyncGenerator<unknown[]> {
    if (source === "eo_bmf") {
      const stream: Readable = createReadStream(filePath)
      for await (const r of parseEoBmfStream(stream)) {
        yield [
          `irsorg_${r.ein}`, r.ein, r.name, r.city, r.state, r.zip5, r.subsection,
          r.classification, r.ruling, r.deductibility, r.foundation, r.status,
          r.ntee_cd, r.sort_name,
        ]
      }
      return
    }
    const { stream } = await openZipEntry(filePath)
    if (source === "pub78") {
      for await (const r of parsePub78Stream(stream)) {
        yield [
          `irsp78_${r.ein}`, r.ein, r.name, r.city, r.state, r.country,
          r.deductibility_codes.join(","),
        ]
      }
      return
    }
    for await (const r of parseRevocationStream(stream)) {
      yield [
        `irsrev_${r.ein}_${ymd(r.posting_date)}_${ymd(r.revocation_date)}`, r.ein,
        r.legal_name, r.dba_name, r.city, r.state, r.country, r.exemption_type,
        r.revocation_date, r.posting_date, r.reinstatement_date,
      ]
    }
  }

  private async flush(pg: PgRaw, table: Table, batch: unknown[][]): Promise<void> {
    const width = table.columns.length
    const tuple = `(${new Array(width).fill("?").join(", ")})`
    const placeholders = new Array(batch.length).fill(tuple).join(",\n")
    const cols = table.columns.map((c) => `"${c}"`).join(", ")
    await pg.raw(
      `INSERT INTO "${table.staging}" (${cols})
       VALUES ${placeholders}
       ${table.conflict}`,
      batch.flat()
    )
  }

  // ------------------------------------------------------------------ lookup

  /**
   * What the IRS files we hold say about an EIN. Never a boolean; see
   * `lookup.ts` for the four states and the precedence between them.
   */
  async lookupEin(input: string | number): Promise<IrsLookupResult> {
    const ein = normalizeEin(input)
    const snapshots = await this.getSnapshots()
    const asOf = Object.fromEntries(
      IRS_SOURCES.map((s) => {
        const v = snapshots[s]?.as_of
        return [s, v ? new Date(v) : null]
      })
    ) as IrsSourcesAsOf

    if (!ein) {
      const dates = Object.values(asOf).filter((d): d is Date => d instanceof Date)
      return {
        state: "not_found",
        ein: String(input),
        as_of: dates.length ? dates.reduce((a, b) => (a >= b ? a : b)) : null,
        sources_as_of: asOf,
      }
    }

    const [pub78Rows, revocationRows, bmfRows] = await Promise.all([
      this.listIrsPub78Listings({ ein }, { take: 1 }) as unknown as Promise<Pub78Record[]>,
      this.listIrsRevocations({ ein }) as unknown as Promise<RevocationRecord[]>,
      this.listIrsExemptOrgs({ ein }, { take: 1 }) as unknown as Promise<BmfRecord[]>,
    ])

    return resolveIrsLookup({
      ein,
      pub78: pub78Rows[0] ?? null,
      revocations: revocationRows,
      bmf: bmfRows[0] ?? null,
      asOf,
    })
  }
}

/** One hash over several files' hashes, order-independent. */
function combineHashes(hashes: Array<string | null>): string | null {
  const present = hashes.filter((h): h is string => !!h).sort()
  if (!present.length) return null
  return createHash("sha256").update(present.join("\n")).digest("hex")
}

export default IrsExemptOrgModuleService
