import { lookup } from "dns/promises"
import { isIP } from "net"

/**
 * SSRF-hardened HTTP fetching.
 *
 * Any code path that fetches a URL the *vendor* supplied (the online-store
 * reference scraper, WooCommerce store validation, …) must go through here so
 * an attacker cannot point the server at `localhost`, RFC-1918 hosts, or the
 * cloud metadata endpoint (169.254.169.254) and read the response back.
 *
 * The guard resolves DNS and rejects private/loopback/link-local/reserved
 * targets *before* connecting, and `safeFetch` re-validates every redirect hop
 * (so a public host cannot 302 into an internal one), enforces a timeout, and
 * caps the response body.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedUrlError"
  }
}

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const DEFAULT_MAX_REDIRECTS = 4

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    value = value * 256 + n
  }
  return value >>> 0
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)
  if (baseInt === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

// Non-public IPv4 ranges: unspecified, private, CGNAT, loopback, link-local
// (incl. cloud metadata 169.254.169.254), benchmarking, TEST-NET, multicast,
// and reserved.
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]

function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip)
  if (ipInt === null) return true // unparseable → treat as unsafe
  return BLOCKED_V4.some(([base, bits]) => inCidr(ipInt, base, bits))
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0] // drop zone id

  // IPv4-mapped / -embedded (::ffff:a.b.c.d, ::a.b.c.d) → validate the v4 part.
  const mapped = addr.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/)
  if (mapped) return isBlockedIpv4(mapped[1])

  if (addr === "::" || addr === "::1") return true // unspecified / loopback
  if (addr.startsWith("fe80") || addr.startsWith("fec0")) return true // link-local / site-local
  if (addr.startsWith("ff")) return true // multicast
  // Unique local addresses fc00::/7 (fc.. and fd..)
  const firstByte = parseInt(addr.split(":")[0]?.slice(0, 2) || "", 16)
  if (!Number.isNaN(firstByte) && (firstByte & 0xfe) === 0xfc) return true

  return false
}

function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return isBlockedIpv4(ip)
  if (kind === 6) return isBlockedIpv6(ip)
  return true // not a valid IP literal → unsafe
}

/**
 * Parse and validate a user-supplied URL for outbound fetching. Rejects
 * non-http(s) schemes, embedded credentials, and any hostname that resolves to
 * a private/loopback/link-local/reserved address. Returns the parsed URL.
 *
 * @param raw the URL string to validate
 * @param opts.allowHttp allow `http:` in addition to `https:` (default false)
 */
export async function assertPublicHttpUrl(
  raw: string,
  opts: { allowHttp?: boolean } = {}
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedUrlError("Invalid URL")
  }

  const allowedProtocols = opts.allowHttp ? ["http:", "https:"] : ["https:"]
  if (!allowedProtocols.includes(url.protocol)) {
    throw new BlockedUrlError(
      opts.allowHttp
        ? "Only http(s) URLs are allowed"
        : "Only https URLs are allowed"
    )
  }

  if (url.username || url.password) {
    throw new BlockedUrlError("URLs with embedded credentials are not allowed")
  }

  const host = url.hostname
  if (!host) {
    throw new BlockedUrlError("URL host is required")
  }

  // Literal IP host → check directly (no DNS).
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new BlockedUrlError("URL host resolves to a non-public address")
    }
    return url
  }

  // Hostname → resolve all A/AAAA records and reject if *any* is private, so a
  // DNS record that returns multiple addresses can't smuggle an internal one.
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new BlockedUrlError(`Could not resolve host "${host}"`)
  }

  if (!addresses.length) {
    throw new BlockedUrlError(`Could not resolve host "${host}"`)
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new BlockedUrlError("URL host resolves to a non-public address")
    }
  }

  return url
}

export type SafeFetchResult = {
  url: string
  status: number
  ok: boolean
  headers: Headers
  text: string
}

export type SafeFetchOptions = {
  headers?: Record<string, string>
  allowHttp?: boolean
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

/**
 * Fetch a user-supplied URL with SSRF protection: every hop (including
 * redirects) is validated with {@link assertPublicHttpUrl}, the request times
 * out, and the response body is capped. Only GET is issued.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    headers = {},
    allowHttp = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
  } = options

  let current = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertPublicHttpUrl(current, { allowHttp })

    const response = await fetch(validated.toString(), {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    })

    // Follow redirects manually so each Location is re-validated.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) {
        return {
          url: validated.toString(),
          status: response.status,
          ok: false,
          headers: response.headers,
          text: "",
        }
      }
      current = new URL(location, validated).toString()
      continue
    }

    const contentLength = Number(response.headers.get("content-length") || "")
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new BlockedUrlError("Response exceeds maximum allowed size")
    }

    const text = await readCapped(response, maxBytes)

    return {
      url: validated.toString(),
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      text,
    }
  }

  throw new BlockedUrlError("Too many redirects")
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) {
      throw new BlockedUrlError("Response exceeds maximum allowed size")
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          throw new BlockedUrlError("Response exceeds maximum allowed size")
        }
        chunks.push(value)
      }
    }
  } finally {
    reader.releaseLock?.()
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8")
}
