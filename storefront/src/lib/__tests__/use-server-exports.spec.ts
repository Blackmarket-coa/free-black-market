import { readFileSync, readdirSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

/**
 * A `"use server"` module may export **only async functions**. Exporting a
 * constant from one is a hard `next build` failure — and neither
 * `tsc --noEmit` nor ESLint catches it, so `pnpm release:check` passes while
 * the build is broken.
 *
 * That is not hypothetical: `lib/data/order-claims.ts` and
 * `lib/data/fee-schedule.ts` both shipped exporting plain constants, and the
 * storefront image failed to build for several commits while local checks
 * reported green. The constants now live in `lib/constants/`.
 *
 * This is the cheap guard for that class. A full `next build` catches it too,
 * but takes minutes; this takes milliseconds, so there is no excuse for the
 * fast loop missing it again.
 */
describe('"use server" modules export only async functions', () => {
  const dataDir = path.join(__dirname, "..", "data")

  const serverModules = readdirSync(dataDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
    .map((file) => ({
      file: `lib/data/${file}`,
      source: readFileSync(path.join(dataDir, file), "utf8"),
    }))
    .filter(({ source }) => /^\s*["']use server["']/.test(source))

  it("finds the server modules to check", () => {
    // Guards the filter: if the directory moved, every assertion below would
    // vacuously pass over an empty list.
    expect(serverModules.length).toBeGreaterThan(0)
  })

  it("exports no values, only async functions and types", () => {
    // Legal: `export async function`, `export const x = async () => {}` (the
    // dominant style in this directory), and `export type` / `export interface`
    // (erased before the check runs).
    //
    // Illegal: any other `export const/let/var/class/enum`, and a plain
    // `export function` with no `async`.
    const offenders = serverModules.flatMap(({ file, source }) => {
      const lines = source.split("\n")

      return lines
        .map((line, index) => ({
          line: line.trim(),
          number: index + 1,
          // `export const retrieveCustomer =` puts `async` on the next line, so
          // the initializer has to be read across the break.
          withNext: `${line.trim()} ${(lines[index + 1] ?? "").trim()}`,
        }))
        .filter(({ line, withNext }) => {
          // An arrow or function expression assigned to a const is still an
          // async function, so it is fine — only a non-async initializer isn't.
          if (/^export\s+(const|let|var)\s+\w+.*=\s*async[\s(]/.test(withNext)) {
            return false
          }
          return (
            /^export\s+(const|let|var|class|enum)\s/.test(line) ||
            /^export\s+function\s/.test(line)
          )
        })
        .map(({ line, number }) => `${file}:${number} → ${line}`)
    })

    expect(offenders).toEqual([])
  })
})
