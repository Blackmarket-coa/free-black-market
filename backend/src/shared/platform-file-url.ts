/**
 * Whether a URL points at a file this platform's own file storage serves.
 *
 * For a field that is stored and handed back to other people, "any string
 * `z.string().url()` accepts" is far too wide: zod passes `javascript:`,
 * `data:`, `file:` and `x:y`. This narrows it to an https URL under the base
 * the configured file provider writes its uploads to.
 *
 * The bases mirror the provider `medusa-config.ts` (`fileModule`) selects:
 *
 * - MinIO, when MINIO_ENDPOINT, MINIO_ACCESS_KEY and MINIO_SECRET_KEY are all
 *   set. `modules/minio-file/service.ts` returns
 *   `<MINIO_PUBLIC_URL>/<bucket>/<key>`, or, with no public URL,
 *   `<http|https>://<endpoint host>/<bucket>/<key>`. The bucket defaults to
 *   `medusa-media`, as there.
 * - Otherwise the local provider, which serves
 *   `<BACKEND_URL or RAILWAY_STATIC_URL>/static/<key>`.
 *
 * Only https bases count, so an http-only deployment (and the test
 * environment, which configures neither) accepts no URL at all: fail closed.
 *
 * This proves where a file is, not what it shows or who uploaded it.
 */

function parse(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** The https URL prefixes (each ending in "/") uploads are served under. */
export function platformFileUrlBases(env: NodeJS.ProcessEnv = process.env): string[] {
  const bases: string[] = []

  if (env.MINIO_ENDPOINT && env.MINIO_ACCESS_KEY && env.MINIO_SECRET_KEY) {
    const bucket = env.MINIO_BUCKET || "medusa-media"
    if (env.MINIO_PUBLIC_URL) {
      bases.push(`${env.MINIO_PUBLIC_URL.replace(/\/$/, "")}/${bucket}/`)
    } else {
      // The provider's own endpoint parsing: a bare host means https unless
      // MINIO_USE_SSL says otherwise.
      const raw = env.MINIO_ENDPOINT.trim()
      const hasProtocol = /^https?:\/\//i.test(raw)
      const endpoint = parse(hasProtocol ? raw : `https://${raw}`)
      const useSsl = env.MINIO_USE_SSL
        ? env.MINIO_USE_SSL === "true"
        : hasProtocol
          ? endpoint?.protocol === "https:"
          : true
      if (endpoint && useSsl) bases.push(`https://${endpoint.hostname}/${bucket}/`)
    }
  } else {
    const backend = (env.BACKEND_URL || env.RAILWAY_STATIC_URL || "").replace(/\/$/, "")
    if (backend) bases.push(`${backend}/static/`)
  }

  return bases.filter((base) => parse(base)?.protocol === "https:")
}

/**
 * True when `value` is an https URL, with no credentials, naming a file under
 * one of `bases`. Compared on the parsed URL (origin, then the normalised
 * path), so a look-alike host, a `user@host` prefix or a `..` segment does not
 * pass on a string prefix match.
 */
export function isPlatformFileUrl(
  value: string,
  bases: readonly string[] = platformFileUrlBases()
): boolean {
  const url = parse(value)
  if (!url || url.protocol !== "https:" || url.username || url.password) return false
  return bases.some((base) => {
    const prefix = parse(base)
    return (
      !!prefix &&
      url.origin === prefix.origin &&
      url.pathname.startsWith(prefix.pathname) &&
      url.pathname.length > prefix.pathname.length
    )
  })
}
