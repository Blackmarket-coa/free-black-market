import { model } from "@medusajs/framework/utils"
import { IRS_SOURCES } from "../sources"

export const IRS_SNAPSHOT_STATUSES = ["pending", "complete", "failed"] as const
export type IrsSnapshotStatus = (typeof IRS_SNAPSHOT_STATUSES)[number]

/**
 * Per-source bookkeeping for the ingest — one row per source, modelled on
 * hawala-ledger's `IngestCursor`.
 *
 * Two groups of columns with different lifetimes, and the distinction is the
 * whole point of the row:
 *
 * - `as_of`, `etag`, `sha256`, `row_count`, `finished_at` describe the data
 *   that is **live** in the source's table. They are written only inside the
 *   swap transaction, so they can never describe a file that did not finish
 *   loading. `as_of` is the file's `Last-Modified` and is the date every
 *   lookup result carries (legal checkpoint L11: "verified" means verified
 *   against the file published on a given date).
 * - `status`, `started_at`, `error` describe the **last attempt**. A failed
 *   run leaves `status = failed` and an error, with the previous `as_of` and
 *   data untouched and still visible.
 *
 * `etag`/`as_of` double as the `If-None-Match`/`If-Modified-Since` values for
 * the next conditional GET, which is why a failed attempt must not overwrite
 * them: the next run would then skip a file it never loaded.
 */
const IrsIngestSnapshot = model
  .define("irs_ingest_snapshot", {
    id: model.id().primaryKey(),
    source: model.enum([...IRS_SOURCES]),
    as_of: model.dateTime().nullable(),
    etag: model.text().nullable(),
    sha256: model.text().nullable(),
    row_count: model.number().nullable(),
    status: model.enum([...IRS_SNAPSHOT_STATUSES]).default("pending"),
    started_at: model.dateTime().nullable(),
    finished_at: model.dateTime().nullable(),
    error: model.text().nullable(),
    /** Per-URL `{ etag, last_modified }` for multi-file sources, plus the last outcome. */
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["source"],
      name: "UQ_irs_ingest_snapshot_source",
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default IrsIngestSnapshot
