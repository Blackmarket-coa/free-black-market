import { readdirSync } from "node:fs"
import path from "node:path"

/**
 * Every spec under src/ must live in a `__tests__` directory.
 *
 * jest.config.js collects unit specs with
 * `**\/src/**\/__tests__/**\/*.unit.spec.[jt]s` only. A spec placed beside its
 * route (`route.unit.spec.ts`) is therefore never run by `pnpm test:unit` or CI,
 * and because `medusa build` excludes only `__tests__`, it is compiled into
 * `.medusa/server` and shipped in the backend image instead. Thirteen sat like
 * that until 2026-11-15; five of them asserted the opposite of Medusa's actor
 * model and one hid a route that refused every real admin. This makes the
 * placement a failing test rather than a convention.
 */
const SRC = path.resolve(__dirname, "..")

function specsOutsideTestsDirs(dir: string, insideTests = false, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      specsOutsideTestsDirs(abs, insideTests || entry.name === "__tests__", out)
    } else if (!insideTests && /\.(spec|test)\.[jt]sx?$/.test(entry.name)) {
      out.push(path.relative(SRC, abs))
    }
  }
  return out
}

describe("spec placement", () => {
  it("has no spec file outside a __tests__ directory under src/", () => {
    expect(specsOutsideTestsDirs(SRC)).toEqual([])
  })
})
