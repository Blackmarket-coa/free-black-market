import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

/**
 * Stream a large file from a code-fixed host to disk, with conditional GET.
 *
 * **Not `shared/safe-fetch.ts`, deliberately** — the same reasoning as
 * `shared/file-size.ts`. That guard exists for *vendor-supplied* URLs: it
 * caps bodies at 2MB and buffers them as a string, which rules out a 30–50MB
 * zip and a multi-hundred-MB CSV. The URLs here are constants in
 * `modules/irs-exempt-org/sources.ts`; no user input reaches this function,
 * and the host allow-list below is enforced before any request is made,
 * including on every redirect hop.
 *
 * Sends `If-None-Match` / `If-Modified-Since` when the caller has them, so an
 * unchanged file costs one round trip and no download. Streams
 * `response.body` to `destPath` through a sha256 tap; nothing is held in
 * memory. Never touches TLS settings or `HTTPS_PROXY`.
 */

export const IRS_DOWNLOAD_HOSTS: readonly string[] = ["apps.irs.gov", "www.irs.gov"]

/** Whole-transfer budget; the largest IRS file is a few hundred MB. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000
const MAX_REDIRECTS = 3

export type StreamDownloadResult = {
  status: 200 | 304
  lastModified: Date | null
  etag: string | null
  sha256: string | null
  bytes: number
}

export type StreamDownloadOptions = {
  destPath: string
  ifNoneMatch?: string | null
  ifModifiedSince?: Date | null
  timeoutMs?: number
  /** Defaults to the IRS hosts. Tests pass their own. */
  allowedHosts?: readonly string[]
  /** Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

export class StreamDownloadError extends Error {
  constructor(
    message: string,
    readonly code: "host_not_allowed" | "http_status" | "too_many_redirects" | "no_body"
  ) {
    super(message)
    this.name = "StreamDownloadError"
  }
}

function assertAllowed(url: string, allowed: readonly string[]): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new StreamDownloadError(`stream-download: not a URL: ${url}`, "host_not_allowed")
  }
  if (parsed.protocol !== "https:" || !allowed.includes(parsed.hostname)) {
    throw new StreamDownloadError(
      `stream-download: refusing ${parsed.protocol}//${parsed.hostname} (not in the allow-list)`,
      "host_not_allowed"
    )
  }
  return parsed
}

function parseLastModified(header: string | null): Date | null {
  if (!header) return null
  const d = new Date(header)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function streamDownloadToFile(
  url: string,
  opts: StreamDownloadOptions
): Promise<StreamDownloadResult> {
  const allowed = opts.allowedHosts ?? IRS_DOWNLOAD_HOSTS
  const fetchImpl = opts.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const headers: Record<string, string> = { accept: "*/*" }
  if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch
  if (opts.ifModifiedSince) headers["if-modified-since"] = opts.ifModifiedSince.toUTCString()

  let current = assertAllowed(url, allowed)
  let response: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(current.toString(), { method: "GET", headers, redirect: "manual", signal })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location")
      if (!location) throw new StreamDownloadError("stream-download: redirect without location", "http_status")
      // Each hop is checked against the same list before it is followed.
      current = assertAllowed(new URL(location, current).toString(), allowed)
      await res.body?.cancel().catch(() => undefined)
      continue
    }
    response = res
    break
  }
  if (!response) {
    throw new StreamDownloadError("stream-download: too many redirects", "too_many_redirects")
  }

  const lastModified = parseLastModified(response.headers.get("last-modified"))
  const etag = response.headers.get("etag")

  if (response.status === 304) {
    await response.body?.cancel().catch(() => undefined)
    return { status: 304, lastModified, etag, sha256: null, bytes: 0 }
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined)
    throw new StreamDownloadError(
      `stream-download: ${current.hostname} answered ${response.status}`,
      "http_status"
    )
  }
  if (!response.body) throw new StreamDownloadError("stream-download: empty body", "no_body")

  const hash = createHash("sha256")
  let bytes = 0
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk)
      bytes += chunk.length
      cb(null, chunk)
    },
  })
  // `Readable.fromWeb` wants the DOM-typed stream; node's lib typing differs.
  const body = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream)
  await pipeline(body, tap, createWriteStream(opts.destPath))

  return { status: 200, lastModified, etag, sha256: hash.digest("hex"), bytes }
}
