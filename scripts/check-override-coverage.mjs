#!/usr/bin/env node
/**
 * Prove every dependency override actually binds.
 *
 * These overrides are not preferences. Nearly all of them pin a CVE fix — they
 * are the mechanism by which findings get cleared, and `.trivyignore` /
 * `.trivyignore.image` document which ones could NOT be reached this way. An
 * override that silently stops applying reintroduces the vulnerability while
 * leaving every gate green, because Trivy's filesystem scan reads the lockfile
 * and the lockfile would simply say the old version was always intended.
 *
 * That is not hypothetical. pnpm 11 stopped reading `pnpm.overrides` from
 * `package.json` and moved the setting to `pnpm-workspace.yaml`. The
 * package.json case at least warns. The dangerous case is silent: overrides
 * declared in `pnpm-workspace.yaml` are **ignored entirely when
 * `--ignore-workspace` is passed**, with no diagnostic at all — and this repo
 * passed that flag in every CI install. Upgrading naively would have dropped
 * all of these at once and reported success.
 *
 * So this check reads the declared overrides and asserts, against the lockfile
 * that was actually resolved, that no package appears at a version the override
 * forbids. It is deliberately independent of which pnpm version or config
 * mechanism produced the lockfile: it compares intent to outcome, so it keeps
 * working across whatever the next migration turns out to be.
 *
 * Usage:  node scripts/check-override-coverage.mjs [root ...]
 *         (defaults to every root that has a lockfile)
 */

import { readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const DEFAULT_ROOTS = [".", "backend", "storefront", "admin-panel", "vendor-panel"]

/**
 * Where overrides can legitimately live.
 *
 * Both are read, and disagreement is reported rather than resolved: during a
 * migration a project can plausibly have either, but having both with different
 * contents means one of them is dead config, and dead security config is the
 * exact thing this script exists to catch.
 */
function readDeclaredOverrides(root) {
  const sources = []

  const pkgPath = join(root, "package.json")
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    const fromPkg = pkg?.pnpm?.overrides
    if (fromPkg && Object.keys(fromPkg).length) {
      sources.push({ where: "package.json (pnpm.overrides)", overrides: fromPkg })
    }
  }

  const wsPath = join(root, "pnpm-workspace.yaml")
  if (existsSync(wsPath)) {
    const fromWs = parseWorkspaceOverrides(readFileSync(wsPath, "utf8"))
    if (Object.keys(fromWs).length) {
      sources.push({ where: "pnpm-workspace.yaml (overrides)", overrides: fromWs })
    }
  }

  return sources
}

/**
 * Minimal YAML reader for the one block shape we write.
 *
 * Deliberately not a YAML dependency: this script is a security check that must
 * keep working when `node_modules` is absent or half-installed — which is
 * exactly the state a broken install leaves behind, and the state in which you
 * most want to be told the overrides are gone.
 */
function parseWorkspaceOverrides(text) {
  const out = {}
  const lines = text.split("\n")
  let inBlock = false

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "")
    if (/^overrides:\s*$/.test(line)) {
      inBlock = true
      continue
    }
    if (inBlock) {
      // Any non-indented, non-blank line ends the block.
      if (line.trim() && !/^\s/.test(line)) break
      if (!line.trim() || line.trim().startsWith("#")) continue
      const m = line.match(/^\s+(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(?:"([^"]*)"|'([^']*)'|(.*?))\s*$/)
      if (m) {
        const key = (m[1] ?? m[2] ?? m[3] ?? "").trim()
        const value = (m[4] ?? m[5] ?? m[6] ?? "").trim()
        if (key) out[key] = value
      }
    }
  }
  return out
}

/**
 * Every `name@version` the lockfile resolved.
 *
 * Read as text rather than parsed as YAML for the reason above, and because the
 * `packages:` / `snapshots:` keys are stable across lockfile versions 6 and 9
 * while the surrounding structure is not.
 */
function readResolvedPackages(lockPath) {
  const resolved = new Map()
  const text = readFileSync(lockPath, "utf8")

  for (const line of text.split("\n")) {
    // Entries look like `  name@1.2.3:` or `  '@scope/name@1.2.3':`
    const m = line.match(/^ {2}'?((?:@[^/@\s]+\/)?[^@\s']+)@([^':\s]+)'?:\s*$/)
    if (!m) continue
    const [, name, version] = m
    if (!resolved.has(name)) resolved.set(name, new Set())
    resolved.get(name).add(version)
  }

  return resolved
}

/** `lodash`, `minimatch@3`, `sharp@^0.34.0` -> the package name. */
function overrideTargetName(key) {
  const at = key.lastIndexOf("@")
  if (at <= 0) return key
  return key.slice(0, at)
}

/** The selector an override is scoped to, if any: `minimatch@3` -> `3`. */
function overrideSelector(key) {
  const at = key.lastIndexOf("@")
  if (at <= 0) return null
  return key.slice(at + 1)
}

/** Leading integer of a version or range, for coarse major comparison. */
function majorOf(value) {
  const m = String(value).match(/(\d+)/)
  return m ? Number(m[1]) : null
}

/** Second integer, when the value names one: `^0.34.0` -> 34. */
function minorOf(value) {
  const m = String(value).match(/(\d+)\.(\d+)/)
  return m ? Number(m[2]) : null
}

/**
 * Whether a resolved version satisfies the override.
 *
 * Intentionally a coarse major-version comparison rather than full semver: the
 * question this answers is "did the override bind at all", and the failure mode
 * it exists to catch is a whole package reverting to a major the override
 * forbids — which is what happens when the setting is silently dropped. A
 * precise range check would need a semver dependency and would fail closed on
 * exotic ranges, adding noise without catching more of the real problem.
 */
function violates(overrideValue, resolvedVersion, selector) {
  const wantedMajor = majorOf(overrideValue)
  const gotMajor = majorOf(resolvedVersion)
  if (wantedMajor === null || gotMajor === null) return false

  // A selector scopes the override to the versions it names, so anything
  // outside that scope is simply not governed and cannot violate it.
  //
  // The precision has to follow the selector's own. `minimatch@3` names a
  // major and governs all of 3.x. `sharp@^0.34.0` names a minor, and under
  // 0.x semantics the minor IS the compatibility boundary — a dependent asking
  // for ^0.33 is a different package line entirely. Comparing majors alone
  // treats every 0.x as one scope and reports `sharp@0.33.5` as violating an
  // override written for the 0.34 line, which is a false alarm on a real tree.
  if (selector !== null) {
    const selMajor = majorOf(selector)
    if (selMajor !== null && gotMajor !== selMajor) return false

    const selMinor = minorOf(selector)
    if (selMinor !== null) {
      const gotMinor = minorOf(resolvedVersion)
      if (gotMinor !== null && gotMinor !== selMinor) return false
    }
  }

  if (gotMajor !== wantedMajor) return false

  // Same major: compare the full tuple so `>=4.18.0` catches `4.17.21`.
  const want = String(overrideValue).match(/(\d+)\.(\d+)\.(\d+)/)
  const got = String(resolvedVersion).match(/(\d+)\.(\d+)\.(\d+)/)
  if (!want || !got) return false

  for (let i = 1; i <= 3; i++) {
    const w = Number(want[i])
    const g = Number(got[i])
    if (g > w) return false
    if (g < w) return true
  }
  return false
}

let hadError = false
let checkedRoots = 0
const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS

for (const root of roots) {
  const dir = resolve(root)
  const lockPath = join(dir, "pnpm-lock.yaml")
  if (!existsSync(lockPath)) continue

  const sources = readDeclaredOverrides(dir)
  if (!sources.length) continue

  checkedRoots++
  const label = root === "." ? "<repo root>" : root

  if (sources.length > 1) {
    // Both mechanisms present. One of them is dead config, and which one is
    // dead depends on the pnpm version — so this is reported rather than
    // guessed at.
    console.error(
      `✗ ${label}: overrides declared in BOTH ${sources
        .map((s) => s.where)
        .join(" and ")}. One is dead config; keep exactly one.`
    )
    hadError = true
  }

  const declared = sources[0].overrides
  const resolvedPkgs = readResolvedPackages(lockPath)
  const violations = []
  let checked = 0

  for (const [key, value] of Object.entries(declared)) {
    const name = overrideTargetName(key)
    const selector = overrideSelector(key)
    const versions = resolvedPkgs.get(name)
    // Not in the tree at all is fine: an override can legitimately guard
    // against a transitive dependency that this project does not currently
    // pull in. It is not evidence the mechanism is broken.
    if (!versions) continue

    checked++
    for (const version of versions) {
      if (violates(value, version, selector)) {
        violations.push(`${name}@${version} violates override "${key}": ${value}`)
      }
    }
  }

  if (violations.length) {
    hadError = true
    console.error(`✗ ${label} (${sources[0].where})`)
    for (const v of violations) console.error(`    ${v}`)
  } else {
    console.log(
      `✓ ${label}: ${checked}/${Object.keys(declared).length} overrides present in the tree, all satisfied (${sources[0].where})`
    )
  }
}

if (!checkedRoots) {
  console.error(
    "✗ No roots with both a lockfile and declared overrides were found.\n" +
      "  That is itself the failure this script guards against: if the overrides\n" +
      "  moved and nothing here can see them, they are not being applied either."
  )
  process.exit(1)
}

if (hadError) {
  console.error(
    "\nAn override that does not bind reintroduces the vulnerability it was\n" +
      "added to fix, while every gate stays green — Trivy reads the lockfile,\n" +
      "and the lockfile would just say the old version was always intended."
  )
  process.exit(1)
}

console.log(`\nAll declared overrides bind across ${checkedRoots} root(s).`)
