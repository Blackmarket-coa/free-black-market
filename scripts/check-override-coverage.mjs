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
 * What an override forbids (SD-55 (h)):
 *
 *   "pkg": "<target>"        Every resolved pkg satisfies <target>. A bare key
 *                            rewrites every request for pkg, so a version
 *                            outside the target, on whatever major, is one the
 *                            override did not reach.
 *   "pkg@<sel>": "<target>"  Every resolved pkg from the lower of the two
 *                            floors, <sel>'s and <target>'s, up to the higher
 *                            of their ceilings satisfies <target>.
 *   "pkg": "-"               No pkg is resolved; with a selector, none in it.
 *
 * A version inside another override's selector for the same package, and
 * outside this one's, is that override's to judge. Exact pins are exact, and
 * 0.x follows semver's caret rules, so "^0.35.5" admits the 0.35 line only.
 *
 * The scoped rule is written in versions because versions are all a lockfile
 * shows. pnpm applies "pkg@<sel>" to every request whose range intersects
 * <sel> (pnpm 11's `isIntersectingRange`), so the rule one wants is "every
 * version a matching request produced satisfies <target>". But a v9 lockfile
 * records which version each dependent resolved, not the range it asked for:
 * only importers keep their specifiers, and a peer range is stored as the
 * override rewrote it. So, for an override that lifts <sel> to a <target> on
 * a later major, as "toml@3": "^5.0.1" lifts the Stellar SDK's ^3.0.0:
 *
 *   - Inside <sel> (toml 3.x), a version can only have come from a request
 *     pnpm rewrites, so one that misses <target> means it did not bind.
 *   - Between <sel> and <target>'s floor (4.x, 5.0.0), a version is either a
 *     governed request resolved stale or below the fix, or a request for a
 *     line the override skips. The lockfile cannot tell them apart, so it is
 *     reported. A dependent that legitimately wants that line needs its own
 *     "pkg@<line>" override, which then judges it.
 *   - Outside both (2.x, 6.x), nothing the override produces resolves, and a
 *     request it failed to rewrite lands there only if it was wider than
 *     <sel>, and then above <target>, past the fix. Nothing there is judged:
 *     storybook's own sharp 0.33.5 beside "sharp@^0.34.0" stays legal.
 *
 * What this cannot see, it reports rather than passes: a value or selector in
 * a form `rangeOf` does not read, and a parent>child key whose child is in the
 * tree (asserting one would need the edges between resolved packages, which
 * this does not read). It also reads each version under its package's real
 * name, while pnpm matches an override on the dependency's own key, so a
 * version reached only through an `npm:` alias would be judged although no
 * override reaches it; no overridden package was reached that way on
 * 2026-10-24.
 *
 * Usage:  node scripts/check-override-coverage.mjs [root ...]
 *         (defaults to every root that has a lockfile)
 */

import { readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

// Every directory that is its own pnpm workspace root AND carries a lockfile.
// `mobile` was missing here until 2026-10-01: Trivy's filesystem scan reads its
// lockfile like any other, so a CVE pin declared there was shipped unasserted —
// the precise blind spot this script exists to close.
const DEFAULT_ROOTS = [".", "backend", "storefront", "admin-panel", "vendor-panel", "mobile"]

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
 * Every `name@version` the lockfile resolved, without a snapshot's peer suffix.
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
    resolved.get(name).add(version.replace(/\(.*$/, ""))
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

/**
 * A resolved version as a sortable tuple: `1.2.3` -> [1, 2, 3, 1]. A
 * prerelease sorts below its release (`1.2.3-rc.1` -> [1, 2, 3, 0]), and the
 * peer suffix of a snapshot key (`1.2.3(react@18.3.1)`) is ignored. null for
 * anything that is not a plain version.
 */
function parseVersion(text) {
  const m = String(text).match(/^(\d+)\.(\d+)\.(\d+)(-[^(]+)?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? 0 : 1] : null
}

function compare(a, b) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/**
 * The versions a range admits, as `{ from, to }`: `to` is exclusive, and null
 * when the range has no ceiling. Reads the forms these override blocks use —
 * `3`, `3.1`, `3.1.4`, and each of those after `^`, `~` or `>=`, with semver's
 * caret rules for 0.x — and returns null for anything else (`||`, `<`, a
 * compound range, `npm:`, `link:`, a dist-tag), which the caller reports.
 */
function rangeOf(spec) {
  const m = String(spec).trim().match(/^(\^|~|>=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (!m) return null
  const op = m[1] ?? ""
  const [maj, min, pat] = [m[2], m[3], m[4]].map((s) => (s === undefined ? null : Number(s)))
  const from = [maj, min ?? 0, pat ?? 0, 1]
  if (op === ">=") return { from, to: null }
  if (op === "^") {
    if (maj > 0 || min === null) return { from, to: [maj + 1, 0, 0, 0] }
    if (min > 0 || pat === null) return { from, to: [0, min + 1, 0, 0] }
    return { from, to: [0, 0, pat + 1, 0] }
  }
  // `~`, or a partial version: the last part given is the one that may move.
  if (op === "~" || pat === null) {
    return { from, to: min === null ? [maj + 1, 0, 0, 0] : [maj, min + 1, 0, 0] }
  }
  return { from, to: [maj, min, pat, 2] } // an exact version: that release alone
}

function within(version, range) {
  return compare(version, range.from) >= 0 && (range.to === null || compare(version, range.to) < 0)
}

/**
 * Whether one resolved version breaks one override, by the rule in the header.
 * `siblings` are the selectors of the same package's other overrides.
 *
 * null means the value or selector is in a form `rangeOf` does not read, and
 * the caller fails on it. Passing what it could not read is how the coarse
 * major comparison this replaces left every override that changes major
 * unasserted (SD-55 (h)). Failing is not noise: the forms these blocks use are
 * few and all read, so a new form fails once, for whoever writes it. It needs
 * no semver dependency either, for the reason `parseWorkspaceOverrides` gives.
 */
function violates(overrideValue, resolvedVersion, selector, siblings) {
  const got = parseVersion(resolvedVersion)
  if (!got) return false // not a registry version: nothing to compare

  const removal = overrideValue === "-"
  const want = removal ? null : rangeOf(overrideValue)
  const sel = selector === null ? null : rangeOf(selector)
  if ((!removal && !want) || (selector !== null && !sel)) return null

  // Inside its own selector, an instance is this override's: pnpm rewrites
  // every request whose range meets the selector, so nothing there can have
  // come from a request it left alone.
  if (sel && within(got, sel)) return removal || !within(got, want)

  // Outside it, an instance another override of the same package scopes is
  // that override's to judge.
  if (siblings.some((s) => rangeOf(s) !== null && within(got, rangeOf(s)))) return false

  if (removal) return sel === null
  if (within(got, want)) return false
  // A bare key rewrites every request for the package, so nothing may resolve
  // outside its target.
  if (sel === null) return true

  // A scoped override answers for everything from the lower of its selector's
  // and target's floors to the higher of their ceilings: the versions between
  // a selector and a target on a later major are the ones the override skips.
  const from = compare(sel.from, want.from) <= 0 ? sel.from : want.from
  const to = sel.to === null || want.to === null ? null : compare(sel.to, want.to) >= 0 ? sel.to : want.to
  return within(got, { from, to })
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
  const unreadable = []
  let checked = 0

  for (const [key, value] of Object.entries(declared)) {
    // `parent>child` scopes an override to one dependent's requests. Asserting
    // it would need the edges between resolved packages, which this script
    // does not read, so a key whose child is in the tree is refused rather
    // than counted as absent.
    const parentAt = key.search(/[^ |@]>/) // pnpm's own delimiter
    if (parentAt !== -1) {
      if (resolvedPkgs.has(overrideTargetName(key.slice(parentAt + 2)))) {
        unreadable.push(`"${key}": ${value} cannot be asserted: this script does not read parent>child keys`)
      }
      continue
    }

    const name = overrideTargetName(key)
    const selector = overrideSelector(key)
    const versions = resolvedPkgs.get(name)
    // Not in the tree at all is fine: an override can legitimately guard
    // against a transitive dependency that this project does not currently
    // pull in. It is not evidence the mechanism is broken.
    if (!versions) continue

    checked++
    const siblings = Object.keys(declared)
      .filter((k) => k !== key && overrideTargetName(k) === name)
      .map(overrideSelector)
      .filter((s) => s !== null)
    for (const version of versions) {
      const verdict = violates(value, version, selector, siblings)
      if (verdict === null) {
        unreadable.push(`"${key}": ${value} cannot be asserted: this script does not read that range`)
        break
      }
      if (verdict) violations.push(`${name}@${version} violates override "${key}": ${value}`)
    }
  }

  if (violations.length || unreadable.length) {
    hadError = true
    console.error(`✗ ${label} (${sources[0].where})`)
    for (const v of [...violations, ...unreadable]) console.error(`    ${v}`)
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
