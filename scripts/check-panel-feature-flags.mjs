#!/usr/bin/env node
/**
 * Frontend feature-flag wiring guard.
 *
 * Vite inlines `import.meta.env.VITE_*` into the SPA bundle at build time, and
 * Next.js inlines `process.env.NEXT_PUBLIC_*` the same way. Every frontend
 * reads its flags through `enabled(value, fallback = false)`. So a flag the
 * reader uses but the Dockerfile never declares is not "unset at runtime" —
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
 * Until 2026-10-04 the storefront had the same failure mode and no guard at
 * all: a `NEXT_PUBLIC_FF_*` reader line with no ARG/ENV/build-arg behind it
 * compiles to `false` in every image just as silently. It is now a target
 * here with its own prefix, reader, Dockerfile and build-args block.
 *
 * This script fails the build when the three lists drift apart for any
 * target:
 *
 *   1. flags the target's reader consumes
 *   2. flags the target's Dockerfile declares as ARG *and* re-exports as ENV
 *   3. flags docker-build.yml passes as build-args in that target's block
 *
 * An ARG without the matching ENV is just as broken as a missing ARG — the
 * bundler reads the build environment, not the ARG table. And an ARG with no
 * reader is stale: it suggests a flag exists that nothing consumes.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const WORKFLOW = ".github/workflows/docker-build.yml"

/**
 * One entry per frontend image. `block` is the heredoc marker of the
 * `Resolve ... build args` step in docker-build.yml that owns that image's
 * flags. docker-build.yml passes BOTH heredoc outputs to every matrix build,
 * so a flag echoed in the wrong block would still reach the image today; the
 * per-block check exists so each step keeps owning its own flags and a flag
 * added to the wrong step is caught before someone narrows what each build
 * receives.
 */
const TARGETS = [
  {
    name: "vendor-panel",
    reader: "vendor-panel/src/lib/phase0-feature-flags.ts",
    dockerfile: "vendor-panel/Dockerfile",
    prefix: "VITE_FF_",
    block: "PANELARGS_EOF",
  },
  {
    name: "admin-panel",
    reader: "admin-panel/src/lib/phase0-feature-flags.ts",
    dockerfile: "admin-panel/Dockerfile",
    prefix: "VITE_FF_",
    block: "PANELARGS_EOF",
  },
  {
    name: "storefront",
    reader: "storefront/src/lib/feature-flags.ts",
    dockerfile: "storefront/Dockerfile",
    prefix: "NEXT_PUBLIC_FF_",
    block: "SFARGS_EOF",
  },
]

const read = (p) => readFileSync(join(root, p), "utf8")
const uniq = (xs) => [...new Set(xs)].sort()
const matches = (s, re) => uniq(s.match(re) ?? [])
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The lines between `echo 'args<<MARKER'` and `echo MARKER` in the workflow. */
const workflowBlock = (workflow, marker) => {
  const start = workflow.indexOf(`args<<${marker}`)
  const end = workflow.indexOf(`echo ${marker}`, start + 1)
  if (start === -1 || end === -1) {
    throw new Error(`${WORKFLOW}: could not find the build-args block delimited by ${marker}`)
  }
  return workflow.slice(start, end)
}

const failures = []
const workflow = read(WORKFLOW)
const summary = []

for (const target of TARGETS) {
  const flagRe = new RegExp(`${escape(target.prefix)}[A-Z0-9_]+`, "g")
  const reader = read(target.reader)
  const dockerfile = read(target.dockerfile)
  const passed = matches(workflowBlock(workflow, target.block), flagRe)

  const used = matches(reader, flagRe)
  const declared = matches(
    dockerfile,
    new RegExp(`^ARG (${escape(target.prefix)}[A-Z0-9_]+)`, "gm")
  ).map((m) => m.replace(/^ARG /, ""))
  // `ENV FOO=$FOO` — the re-export that actually reaches the bundler.
  const exported = uniq(
    [
      ...dockerfile.matchAll(
        new RegExp(`(${escape(target.prefix)}[A-Z0-9_]+)=\\$\\1\\b`, "g")
      ),
    ].map((m) => m[1])
  )

  const missingArg = used.filter((f) => !declared.includes(f))
  const missingEnv = declared.filter((f) => !exported.includes(f))
  const missingBuildArg = used.filter((f) => !passed.includes(f))
  const orphaned = declared.filter((f) => !used.includes(f))

  if (missingArg.length) {
    failures.push(
      `${target.dockerfile} is missing ARG for flags the reader uses — these ` +
        `compile to false in every image: ${missingArg.join(", ")}`
    )
  }
  if (missingEnv.length) {
    failures.push(
      `${target.dockerfile} declares ARG but never re-exports as ENV, so the ` +
        `bundler never sees them: ${missingEnv.join(", ")}`
    )
  }
  if (missingBuildArg.length) {
    failures.push(
      `${WORKFLOW} (${target.block} block) does not pass build-args for flags ` +
        `${target.name} reads: ${missingBuildArg.join(", ")}`
    )
  }
  if (orphaned.length) {
    failures.push(
      `${target.dockerfile} declares flags its reader no longer uses ` +
        `(stale, remove them): ${orphaned.join(", ")}`
    )
  }

  summary.push(`${target.name}: ${used.length} flags`)
}

if (failures.length) {
  console.error("Frontend feature-flag wiring is broken:\n")
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    "\nA flag that is read but not declared+exported+passed is silently " +
      "false in the published bundle. See scripts/check-panel-feature-flags.mjs."
  )
  process.exit(1)
}

console.log(`Frontend feature-flag wiring OK — all flags passed (${summary.join("; ")}).`)
