#!/usr/bin/env node
/**
 * Panel feature-flag wiring guard.
 *
 * Vite inlines `import.meta.env.VITE_*` into the SPA bundle at build time, and
 * both panels read flags through `enabled(value, fallback = false)`. So a flag
 * the reader uses but the Dockerfile never declares is not "unset at runtime" —
 * it is compiled into the bundle as `false`, permanently, with no error
 * anywhere.
 *
 * That is exactly what happened: until 2026-10-01 neither panel declared a
 * single `VITE_FF_*` ARG and `docker-build.yml` passed none, so POS, weight
 * pricing, pick/pack, invoicing and channel sync were unreachable in every
 * published image regardless of the backend's `FF_*` vars. Two more flags
 * (vendor advances, investment pools) were correctly dark but by accident
 * rather than by the gate, which meant the gate was not holding the line.
 *
 * This script fails the build when the three lists drift apart:
 *
 *   1. flags the panel's reader consumes
 *   2. flags the panel's Dockerfile declares as ARG *and* re-exports as ENV
 *   3. flags docker-build.yml passes as build-args
 *
 * An ARG without the matching ENV is just as broken as a missing ARG — Vite
 * reads the build environment, not the ARG table.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const FLAG = /VITE_FF_[A-Z0-9_]+/g

const PANELS = ["vendor-panel", "admin-panel"]
const WORKFLOW = ".github/workflows/docker-build.yml"

const read = (p) => readFileSync(join(root, p), "utf8")
const uniq = (xs) => [...new Set(xs)].sort()
const matches = (s, re) => uniq(s.match(re) ?? [])

const failures = []

const workflowFlags = matches(read(WORKFLOW), FLAG)

for (const panel of PANELS) {
  const reader = read(`${panel}/src/lib/phase0-feature-flags.ts`)
  const dockerfile = read(`${panel}/Dockerfile`)

  const used = matches(reader, FLAG)
  const declared = matches(dockerfile, /^ARG (VITE_FF_[A-Z0-9_]+)/gm).map((m) =>
    m.replace(/^ARG /, "")
  )
  // `ENV FOO=$FOO` — the re-export that actually reaches Vite.
  const exported = uniq(
    [...dockerfile.matchAll(/(VITE_FF_[A-Z0-9_]+)=\$\1\b/g)].map((m) => m[1])
  )

  const missingArg = used.filter((f) => !declared.includes(f))
  const missingEnv = declared.filter((f) => !exported.includes(f))
  const missingBuildArg = used.filter((f) => !workflowFlags.includes(f))
  const orphaned = declared.filter((f) => !used.includes(f))

  if (missingArg.length) {
    failures.push(
      `${panel}/Dockerfile is missing ARG for flags the reader uses — these ` +
        `compile to false in every image: ${missingArg.join(", ")}`
    )
  }
  if (missingEnv.length) {
    failures.push(
      `${panel}/Dockerfile declares ARG but never re-exports as ENV, so Vite ` +
        `never sees them: ${missingEnv.join(", ")}`
    )
  }
  if (missingBuildArg.length) {
    failures.push(
      `${WORKFLOW} does not pass build-args for flags ${panel} reads: ` +
        `${missingBuildArg.join(", ")}`
    )
  }
  if (orphaned.length) {
    failures.push(
      `${panel}/Dockerfile declares flags its reader no longer uses ` +
        `(stale, remove them): ${orphaned.join(", ")}`
    )
  }
}

if (failures.length) {
  console.error("Panel feature-flag wiring is broken:\n")
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    "\nA flag that is read but not declared+exported+passed is silently " +
      "false in the published bundle. See scripts/check-panel-feature-flags.mjs."
  )
  process.exit(1)
}

console.log(
  `Panel feature-flag wiring OK (${PANELS.join(", ")}; ` +
    `${workflowFlags.length} flags passed by CI).`
)
