#!/usr/bin/env node
// One-shot codemod: rewrite relative parent-going imports (../...) inside
// admin-panel/src/** to TS path-alias imports (@hooks/..., @components/...,
// @lib/..., etc.). Closes the bulk of the `no-restricted-imports` warnings
// tracked under LR-1 in docs/AUDIT_DEBT.md.
//
// Strategy:
//   * Walk every .ts/.tsx file under src/ (excluding *.d.ts).
//   * For each ES import/export-from/dynamic-import/require, if the target
//     starts with `../`, resolve it against the file's directory.
//   * If the resolved path falls under a directory we have an alias for,
//     rewrite to the alias form. Otherwise leave it alone.
//   * Sibling-only (`./...`) imports are left alone — they don't trip the
//     no-restricted-imports rule's parent-import pattern.

import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const srcRoot = resolve(__dirname, "..", "src")

// Order matters — longer prefixes first so `@custom-types` wins over `@/types`.
const aliases = [
  { prefix: "components", alias: "@components" },
  { prefix: "hooks", alias: "@hooks" },
  { prefix: "routes", alias: "@routes" },
  { prefix: "utils", alias: "@utils" },
  { prefix: "assets", alias: "@assets" },
  { prefix: "styles", alias: "@styles" },
  { prefix: "lib", alias: "@lib" },
  { prefix: "providers", alias: "@providers" },
  { prefix: "types", alias: "@custom-types" },
]

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (/\.(t|j)sx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

function rewriteSpecifier(spec, fileDir) {
  // Also rewrite sibling `./<aliased-dir>/…` paths because the rule's
  // second pattern (`./**/{hooks,components,routes,utils,assets,types}/*`)
  // bans them too. Pure-sibling paths that don't traverse into an
  // aliased subtree (e.g. `./form-helpers`) stay relative.
  if (!spec.startsWith("..") && !spec.startsWith("./")) {
    return null
  }
  const resolved = resolve(fileDir, spec)
  const rel = relative(srcRoot, resolved)
  if (rel.startsWith("..") || rel.startsWith(sep)) {
    return null // points outside src/
  }
  const parts = rel.split(sep)
  if (parts.length < 1) {
    return null
  }
  const head = parts[0]
  const match = aliases.find((a) => a.prefix === head)
  const rest = parts.slice(1).join("/")
  if (match) {
    // Bare-directory imports (no subpath, e.g. `../types`) only resolve
    // under the `@/<dir>` catch-all alias because the prefixed aliases
    // are all declared with `/*`. Use the catch-all in that case.
    if (!rest) {
      return `@/${head}`
    }
    return `${match.alias}/${rest}`
  }
  // For `./...` sibling imports that don't traverse into an aliased
  // subtree (head is not one of our prefixes), leave them alone — the
  // no-restricted-imports rule only bans sibling traversal into the
  // aliased dirs.
  if (spec.startsWith("./")) {
    return null
  }
  // Fall back to the catch-all `@/` alias for src-rooted parent paths.
  return `@/${parts.join("/")}`
}

// Patterns to scan; capture group #1 is the specifier.
const patterns = [
  // import ... from "..."
  /\bimport\s+(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']/g,
  // export ... from "..."
  /\bexport\s+[^"'`]+?\s+from\s+["']([^"']+)["']/g,
  // export * from "..."
  /\bexport\s*\*\s*(?:as\s+\w+\s*)?from\s+["']([^"']+)["']/g,
  // dynamic import()
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  // require()
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
]

let filesChanged = 0
let importsRewritten = 0

for (const file of walk(srcRoot, [])) {
  const original = readFileSync(file, "utf8")
  const fileDir = dirname(file)
  let updated = original

  for (const re of patterns) {
    updated = updated.replace(re, (match, spec) => {
      const rewritten = rewriteSpecifier(spec, fileDir)
      if (rewritten === null || rewritten === spec) {
        return match
      }
      importsRewritten += 1
      return match.replace(spec, rewritten)
    })
  }

  if (updated !== original) {
    writeFileSync(file, updated)
    filesChanged += 1
  }
}

console.log(`rewrote ${importsRewritten} imports across ${filesChanged} files`)
