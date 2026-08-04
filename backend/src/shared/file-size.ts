import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createLogger } from "./logger"

const log = createLogger("shared/file-size")

/** How long to wait for the object store before giving up on a size. */
const HEAD_TIMEOUT_MS = 3_000

/**
 * How many bytes an uploaded file occupies, measured server-side.
 *
 * A storage cap is only worth having if the number it counts is one the seller
 * cannot choose. Medusa's `FileDTO` is `{ id, url }` — the file module
 * abstraction carries no size at all — so the only options were to trust a
 * client-supplied figure or to go and look. A cap enforced against a number the
 * client sends is not a cap; it is a formality that the one person motivated to
 * exceed it can set to zero.
 *
 * So this issues a `HEAD` against the file's own URL and reads `Content-Length`.
 * One request, no download, and the answer comes from the object store rather
 * than from the uploader.
 *
 * **Not `shared/safe-fetch.ts`, deliberately.** That guard exists to stop
 * *user-supplied* URLs reaching internal addresses, and it would reject exactly
 * the deployments this needs to work in — a self-hosted MinIO usually sits on a
 * private address. The URL here is constructed by our own file provider from
 * our own configured endpoint; an uploader influences the object key, never the
 * host. It is also GET-only and body-capped, which would mean downloading a
 * file to find out it is too large.
 *
 * **Returns `null` rather than throwing, and callers must treat `null` as
 * "unknown", never as "zero".** A measurement failure is not evidence of an
 * empty file. Failing an upload because the object store was briefly slow would
 * turn a metering feature into an availability problem on somebody else's
 * document, and the amount at stake — one file's contribution to a quota — does
 * not justify that.
 */
export async function measureFileBytes(
  container: MedusaContainer,
  fileId: string | null | undefined
): Promise<number | null> {
  if (!fileId) return null

  try {
    const files = container.resolve(Modules.FILE) as unknown as {
      retrieveFile: (id: string) => Promise<{ url?: string } | null>
    }
    const file = await files.retrieveFile(fileId)
    const url = file?.url
    if (!url) return null

    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const header = response.headers.get("content-length")
    if (!header) return null

    const bytes = Number(header)
    // A non-finite or negative length is a broken response, not a small file.
    if (!Number.isFinite(bytes) || bytes < 0) return null

    return Math.floor(bytes)
  } catch (err) {
    log.warn(`[file-size] could not measure ${fileId}`, err)
    return null
  }
}

/** Bytes as something a person can read. `1.5 GB`, not `1610612736`. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = Math.max(0, bytes)
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  // Whole bytes read oddly as "1.0 B"; everything above gets one decimal, which
  // is the resolution a quota conversation actually needs.
  const rendered = unit === 0 ? String(Math.round(value)) : value.toFixed(1)
  return `${rendered} ${units[unit]}`
}
