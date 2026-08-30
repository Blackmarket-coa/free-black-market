/**
 * Pure semver compatibility logic for the plugin install gate. Hand-rolled (no
 * `semver` dependency at the top level) — it parses `major.minor.patch`,
 * ignoring any pre-release/build suffix, which is all the host-version range
 * check needs. Kept free of I/O so it is unit-testable.
 */

export type Semver = { major: number; minor: number; patch: number }

/** Parse `X.Y.Z` (optional leading `v`, ignoring `-pre`/`+build`), else null. */
export function parseSemver(input: string | null | undefined): Semver | null {
  if (!input) {
    return null
  }
  const cleaned = input.trim().replace(/^v/i, "").split(/[-+]/)[0]
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(cleaned)
  if (!m) {
    return null
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/**
 * -1 | 0 | 1 comparing only the numeric core of a vs b, or null if either is
 * unparseable. Prerelease/build suffixes are ignored HERE — use
 * `compareSemverPrecedence` (below) for full SemVer §11 ordering. Kept as the
 * core comparator so `compareSemverPrecedence` can delegate to it.
 */
function compareSemverCore(
  a: string | null | undefined,
  b: string | null | undefined
): -1 | 0 | 1 | null {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) {
    return null
  }
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) {
      return pa[key] < pb[key] ? -1 : 1
    }
  }
  return 0
}

/**
 * -1 | 0 | 1 comparing a vs b, or null if either is unparseable. Since W3
 * this is prerelease-aware (full SemVer §11): `1.0.0-rc.1` sorts BELOW
 * `1.0.0`, where it previously compared equal. Runtime consequence for the
 * install gate: a prerelease FBM_PLATFORM_VERSION no longer satisfies an
 * exact release bound — stricter and SemVer-correct. Fail-open bound
 * semantics in `isInstallable` are unchanged (unparseable still → null →
 * "no bound").
 */
export function compareSemver(
  a: string | null | undefined,
  b: string | null | undefined
): -1 | 0 | 1 | null {
  return compareSemverPrecedence(a, b)
}

export type PluginCompat = {
  status?: string | null
  min_host_version?: string | null
  max_host_version?: string | null
}

export type InstallableResult =
  | { ok: true }
  | { ok: false; code: "deprecated" | "incompatible"; message: string }

const DEPRECATED = "DEPRECATED"

/**
 * Whether a plugin may be installed against the given host version. A deprecated
 * plugin is never installable. Otherwise the host version must fall within the
 * plugin's inclusive `[min_host_version, max_host_version]` range; an
 * unparseable or absent bound is treated as "no bound" (fail-open) so a bad
 * catalog value can't wedge installs.
 */
export function isInstallable(
  plugin: PluginCompat,
  hostVersion: string
): InstallableResult {
  if ((plugin.status ?? "").toUpperCase() === DEPRECATED) {
    return {
      ok: false,
      code: "deprecated",
      message: "This plugin is deprecated and can no longer be installed",
    }
  }

  const belowMin = compareSemver(hostVersion, plugin.min_host_version)
  if (belowMin === -1) {
    return {
      ok: false,
      code: "incompatible",
      message: `Plugin requires host version >= ${plugin.min_host_version} (host is ${hostVersion})`,
    }
  }

  const aboveMax = compareSemver(hostVersion, plugin.max_host_version)
  if (aboveMax === 1) {
    return {
      ok: false,
      code: "incompatible",
      message: `Plugin supports host version <= ${plugin.max_host_version} (host is ${hostVersion})`,
    }
  }

  return { ok: true }
}

/** Strict shape check for registry writes (same rule the listings routes use). */
const SEMVER_WRITE_RE = /^v?\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i

export function isValidSemverString(input: string | null | undefined): boolean {
  return typeof input === "string" && SEMVER_WRITE_RE.test(input.trim())
}

/**
 * Split off the prerelease identifiers (`1.2.3-rc.1` → ["rc","1"]). Build
 * metadata (`+build`) is ignored per SemVer §10. Returns null identifiers for
 * a release version. Internal shape — `parseSemver`'s return type is frozen
 * (exact-equality assertions pin it), so prerelease data lives here instead.
 */
function splitPrerelease(input: string): string[] | null {
  const cleaned = input.trim().replace(/^v/i, "").split("+")[0]
  const dash = cleaned.indexOf("-")
  if (dash === -1) {
    return null
  }
  const identifiers = cleaned.slice(dash + 1)
  if (!identifiers) {
    return null
  }
  return identifiers.split(".")
}

const NUMERIC_RE = /^\d+$/

/**
 * Full SemVer §11 precedence: numeric core, then release > prerelease, then
 * prerelease identifiers compared left-to-right (numeric < alphanumeric,
 * numerics numerically, alphanumerics lexically, more identifiers wins a
 * shared prefix). Same fail-null contract as `compareSemver` — either side
 * unparseable → null, so fail-open call sites keep their semantics.
 */
export function compareSemverPrecedence(
  a: string | null | undefined,
  b: string | null | undefined
): -1 | 0 | 1 | null {
  const core = compareSemverCore(a, b)
  if (core === null || core !== 0) {
    return core
  }
  const preA = splitPrerelease(a as string)
  const preB = splitPrerelease(b as string)
  if (!preA && !preB) {
    return 0
  }
  if (!preA) {
    return 1 // release > any prerelease
  }
  if (!preB) {
    return -1
  }
  const len = Math.min(preA.length, preB.length)
  for (let i = 0; i < len; i += 1) {
    const idA = preA[i]
    const idB = preB[i]
    if (idA === idB) {
      continue
    }
    const numA = NUMERIC_RE.test(idA)
    const numB = NUMERIC_RE.test(idB)
    if (numA && numB) {
      return Number(idA) < Number(idB) ? -1 : 1
    }
    if (numA !== numB) {
      return numA ? -1 : 1 // numeric identifiers sort below alphanumeric
    }
    return idA < idB ? -1 : 1
  }
  if (preA.length === preB.length) {
    return 0
  }
  return preA.length < preB.length ? -1 : 1
}
