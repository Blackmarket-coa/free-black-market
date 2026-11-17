import fs from "fs"
import os from "os"
import path from "path"
import { readRouteFileExports } from "./route-file-exports"

/**
 * Nested middleware files are dead unless the root file imports them.
 *
 * Medusa's MiddlewareFileLoader checks exactly one path per api source dir —
 * `<dir>/middlewares.ts`, else `<dir>/middlewares.js` — and never walks
 * subdirectories (node_modules/@medusajs/framework/dist/http/
 * middleware-file-loader.js, `scanDir`). Nine nested `middlewares.ts` files
 * under src/api sat there for months declaring auth and rate limits that never
 * ran, including the only auth `/deliveries/:id/*` had.
 *
 * The convention now: a surface may keep its declarations beside its routes in
 * a nested `_middlewares.ts` that exports a `...MiddlewareRoutes` array, and
 * `src/api/middlewares.ts` imports it and spreads it into `routes`. This spec
 * fails on anything else:
 *   - a nested file named `middlewares.ts|js` (the loader's name, so it LOOKS
 *     live, and is not);
 *   - a nested `_middlewares.ts|js` the root does not import;
 *   - an exported route array the root does not spread (by text, and by
 *     identity in the middleware set the real loader builds from the root),
 *     or an exported `defineMiddlewares`-shaped config (`{ routes: [...] }`)
 *     whose routes it does not load, default or named;
 *   - a default export in a nested file, however it is spelled (a
 *     `defineMiddlewares` default nobody loads is the same dead declaration
 *     under another name), and any export whose names the file's text does
 *     not show (`export =`, `export *`, a CommonJS write). Read from the
 *     syntax tree by route-file-exports.ts, which reports each of these as
 *     `unreadable`; a regex for `export default` let
 *     `export { config as default }` through.
 */

// Requiring the route sets creates the rate limiters; pin the in-memory store
// first, as the chain spec does.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
})

const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
const { MiddlewareFileLoader } = require(path.join(httpDir, "middleware-file-loader")) as {
  MiddlewareFileLoader: new () => {
    scanDir(dir: string): Promise<void>
    getMiddlewares(): Array<{ matcher: string; handler: unknown }>
  }
}

const API_DIR = path.resolve(__dirname, "..")
const ROOT_FILE = path.join(API_DIR, "middlewares.ts")

type Found = { abs: string; rel: string; base: string }

function walk(dir: string, out: Found[] = []): Found[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(abs, out)
    } else if (/^_?middlewares\.(ts|js)$/.test(entry.name)) {
      out.push({ abs, rel: path.relative(API_DIR, abs), base: entry.name })
    }
  }
  return out
}

const found = walk(API_DIR)
const rootSource = fs.readFileSync(ROOT_FILE, "utf8")
const nested = found.filter((f) => f.abs !== ROOT_FILE)

function importSpecifier(f: Found): string {
  return "./" + f.rel.replace(/\\/g, "/").replace(/\.(ts|js)$/, "")
}

/**
 * Each export in a nested file that is not a plain named one: a default
 * export in any spelling, and every form whose names the text does not show.
 */
const exportProblems = (rel: string, source: string): string[] =>
  readRouteFileExports(rel, source).unreadable.map((why) => `${rel}: ${why}`)

/** The routes an exported value declares: a route array, or a `defineMiddlewares` config holding one. */
function routesIn(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  const routes = value && typeof value === "object" ? (value as { routes?: unknown }).routes : undefined
  return Array.isArray(routes) ? routes : undefined
}

describe("nested middleware files (src/api)", () => {
  it("the walk finds the root file, so an empty result cannot pass by accident", () => {
    expect(found.map((f) => f.abs)).toContain(ROOT_FILE)
    // There are nested route sets today; a walk that saw none is broken.
    expect(nested.length).toBeGreaterThanOrEqual(6)
  })

  it("no nested file is named middlewares.ts or middlewares.js — Medusa would not load it", () => {
    const dead = nested.filter((f) => /^middlewares\.(ts|js)$/.test(f.base)).map((f) => f.rel)
    expect(dead).toEqual([])
  })

  it("the root file imports every nested _middlewares file", () => {
    const unimported = nested
      .filter((f) => {
        const spec = importSpecifier(f)
        return !rootSource.includes(`from "${spec}"`) && !rootSource.includes(`from '${spec}'`)
      })
      .map((f) => f.rel)
    expect(unimported).toEqual([])
  })

  it("every exported route array in a nested file is spread into the root's routes", () => {
    const unspread: string[] = []
    for (const f of nested) {
      const src = fs.readFileSync(f.abs, "utf8")
      for (const m of src.matchAll(/export const (\w+)\s*:\s*MiddlewareRoute\[\]/g)) {
        if (!new RegExp(`\\.\\.\\.${m[1]}\\b`).test(rootSource)) unspread.push(`${f.rel}:${m[1]}`)
      }
    }
    expect(unspread).toEqual([])
  })

  it("every exported route array in a nested file is registered, by identity, in what Medusa loads", async () => {
    // The text checks above can be satisfied by a commented-out import, and
    // only see `export const X: MiddlewareRoute[]`. This one asks the loader:
    // require each nested module, take EVERY exported array of
    // `{ matcher, middlewares }` however it is declared or exported, and the
    // routes of every exported `{ routes }` config (a `defineMiddlewares`
    // default nobody loads, under any key and in any spelling), and find
    // each middleware function with its matcher in the root file's loaded set.
    const loader = new MiddlewareFileLoader()
    await loader.scanDir(API_DIR)
    const loaded = loader.getMiddlewares()

    const missing: string[] = []
    let checked = 0
    for (const f of nested) {
      const mod = require(f.abs) as Record<string, unknown>
      for (const [name, value] of Object.entries(mod)) {
        const routes = routesIn(value)
        if (!routes) continue
        for (const r of routes) {
          if (!r || typeof r !== "object") continue
          const route = r as { matcher?: unknown; middlewares?: unknown }
          if (typeof route.matcher !== "string" || !Array.isArray(route.middlewares)) continue
          for (const mw of route.middlewares) {
            checked++
            if (!loaded.some((l) => l.handler === mw && l.matcher === route.matcher)) {
              missing.push(`${f.rel}:${name}:${route.matcher}`)
            }
          }
        }
      }
    }
    // A walk that checked nothing proves nothing.
    expect(checked).toBeGreaterThan(20)
    expect(missing).toEqual([])
  }, 60_000)

  it("no nested file has a default export, however it is spelled, or an export its text does not name (nobody would load it)", () => {
    expect(nested.flatMap((f) => exportProblems(f.rel, fs.readFileSync(f.abs, "utf8")))).toEqual([])
  })

  it("a default export is found in every spelling, so the check above cannot be passed by re-spelling it", () => {
    const rel = path.join("deliveries", "[id]", "_middlewares.ts")
    const config = 'const deadConfig = { routes: [{ matcher: "/deliveries/:id/scratch", middlewares: [] }] }'
    const spellings: Record<string, string> = {
      "export default deadConfig": "export default (line 2)",
      "export default defineMiddlewares(deadConfig)": "export default (line 2)",
      "export { deadConfig as default }": "export { ... as default } (line 2)",
      'export { default } from "./other"': "export { ... as default } (line 2)",
      'export { deadConfig as default } from "./other"': "export { ... as default } (line 2)",
    }
    for (const [spelling, why] of Object.entries(spellings)) {
      expect([spelling, exportProblems(rel, `${config}\n${spelling}`)]).toEqual([spelling, [`${rel}: ${why}`]])
    }
    // The convention, a named route array, is not a problem.
    expect(exportProblems(rel, `${config}\nexport const deliveryMiddlewareRoutes: MiddlewareRoute[] = deadConfig.routes`)).toEqual([])
  })

  it("names the route sets this slice made live", () => {
    // Pinned so a rename that drops one from the root cannot slip past the
    // generic checks above by also dropping the export.
    for (const name of [
      "storeHawalaMiddlewareRoutes",
      "vendorHawalaMiddlewareRoutes",
      "vendorWellnessMiddlewareRoutes",
      "storeCollectiveMiddlewareRoutes",
      "mutualAidMiddlewareRoutes",
      "deliveryMiddlewareRoutes",
    ]) {
      expect(rootSource).toMatch(new RegExp(`\\.\\.\\.${name}\\b`))
    }
  })
})

describe("Medusa's middleware loader is not recursive (pins the premise)", () => {

  let tmp: string
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-mw-loader-"))
    const file = (matcher: string) =>
      `module.exports = { default: { routes: [{ matcher: ${JSON.stringify(matcher)}, middlewares: [function m(_q, _s, n) { n() }] }] } }\n`
    fs.writeFileSync(path.join(tmp, "middlewares.js"), file("/root-only"))
    fs.mkdirSync(path.join(tmp, "sub"))
    fs.writeFileSync(path.join(tmp, "sub", "middlewares.js"), file("/nested-never-loaded"))
  })
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("loads the root middlewares file and ignores a nested one", async () => {
    const loader = new MiddlewareFileLoader()
    await loader.scanDir(tmp)
    expect(loader.getMiddlewares().map((m) => m.matcher)).toEqual(["/root-only"])
  })
})
