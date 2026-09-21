import { createHash } from "crypto"

/**
 * Salted IP hashing for creator-attribution click events.
 *
 * Provenance: PRE_LAUNCH_AUDIT.md item LEG-8. The `/r/:shortCode` redirector
 * and `POST /marketplace/attribution/click` used to each carry a private
 * `hashIp` that fell back to an empty salt when `CREATOR_ATTRIBUTION_IP_SALT`
 * was unset. An unsalted SHA-256 of an IPv4 address is trivially reversible
 * (the whole address space fits in a rainbow table), so that fallback stored
 * what is effectively the raw IP.
 *
 * Rule: when the salt is missing or blank this helper returns `null` and no
 * hash is stored at all. Production boot additionally refuses to start
 * without the salt (see `shared/config.ts`), so the null path only ever
 * applies to dev/test environments that never configured one.
 *
 * Output format is intentionally byte-for-byte what the routes produced
 * before extraction — `sha256("<salt>:<ip>")` hex, first 32 chars — so rows
 * hashed under a real salt remain comparable across the change.
 */
export function hashIpForAttribution(
  ip: string | null | undefined,
  salt: string | undefined = process.env.CREATOR_ATTRIBUTION_IP_SALT
): string | null {
  if (!ip) return null
  if (!salt || salt.trim() === "") return null
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32)
}
