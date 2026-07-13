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

/** -1 | 0 | 1 comparing a vs b, or null if either is unparseable. */
export function compareSemver(
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
