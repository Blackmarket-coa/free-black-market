import { spawnSync } from "child_process"
import path from "path"
import { WorkflowManager } from "@medusajs/framework/orchestration"

/**
 * The Blackstar bridge rules in the guard that runs at boot.
 *
 * `scripts/assert-env.mjs` carried them alone (SD-78), and nothing runs that
 * script at boot or in CI; it is not even in the backend image (built with
 * context backend/). `src/shared/config.ts` `loadConfig()` is what refuses a
 * production boot: Medusa's MiddlewareFileLoader evaluates it when it loads
 * `src/api/middlewares.ts` (last describe), as it already did for the
 * FREEBLACKMARKET_* and CREATOR_ATTRIBUTION_IP_SALT rules. So the rules are
 * repeated there, and one table of envs runs through both guards so they
 * cannot drift apart.
 */

const SCRIPT = path.resolve(__dirname, "../../../../scripts/assert-env.mjs")
const SECRET = (c: string) => c.repeat(40)
const BLACKSTAR_KEYS = [
  "FBM_BLACKSTAR_INTEGRATION",
  "BLACKSTAR_REQUIRE_KEY_ID",
  "BLACKSTAR_API_BASE",
  "BLACKSTAR_WEBHOOK_SECRET",
  "BLACKSTAR_OUTBOUND_SECRET",
] as const
type Extra = Partial<Record<(typeof BLACKSTAR_KEYS)[number], string>>

// Valid for both guards' base rules, with every Blackstar key unset.
const BASE_PRODUCTION_ENV: Record<string, string | undefined> = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db.example.com:5432/fbm",
  JWT_SECRET: SECRET("j"),
  COOKIE_SECRET: SECRET("c"),
  MEDUSA_ADMIN_PASSWORD: SECRET("a"),
  CREATOR_ATTRIBUTION_IP_SALT: SECRET("s"),
  FREEBLACKMARKET_WEBHOOK_SECRET: SECRET("f"),
  FREEBLACKMARKET_API_KEY: SECRET("k"),
  ...Object.fromEntries(BLACKSTAR_KEYS.map((k) => [k, undefined])),
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = process.env
  process.env = { ...saved, ...env } as NodeJS.ProcessEnv
  try {
    return fn()
  } finally {
    process.env = saved
  }
}

/** `config.ts` validates at import time; re-require it in isolation. */
function bootGuard(
  extra: Extra,
  base: Record<string, string | undefined> = BASE_PRODUCTION_ENV
): { refused: boolean; message: string } {
  return withEnv({ ...base, ...extra }, () => {
    try {
      jest.isolateModules(() => {
        require("../config")
      })
      return { refused: false, message: "" }
    } catch (e) {
      return { refused: true, message: (e as Error).message }
    }
  })
}

function predeployScript(extra: Extra): { refused: boolean; message: string } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" }
  for (const [k, v] of Object.entries({ ...BASE_PRODUCTION_ENV, ...extra })) {
    if (v !== undefined) env[k] = v
  }
  const run = spawnSync(process.execPath, [SCRIPT, "--app=backend"], { env, encoding: "utf8" })
  return { refused: run.status !== 0, message: `${run.stdout}${run.stderr}` }
}

const named = (message: string) =>
  [...new Set(message.match(/BLACKSTAR_(?:API_BASE|WEBHOOK_SECRET|OUTBOUND_SECRET)\b/g) ?? [])].sort()

const VALID_PAIR = { BLACKSTAR_API_BASE: "https://api.blackstar.example", BLACKSTAR_WEBHOOK_SECRET: SECRET("w") }

// [case, extra env, keys that must be refused ([] = boots)]
const CASES: [string, Extra, string[]][] = [
  ["bridge off, nothing set", {}, []],
  ["bridge off, the template's empty values", { BLACKSTAR_API_BASE: "", BLACKSTAR_WEBHOOK_SECRET: "" }, []],
  [
    "flag on, nothing set",
    { FBM_BLACKSTAR_INTEGRATION: "1" },
    ["BLACKSTAR_API_BASE", "BLACKSTAR_OUTBOUND_SECRET", "BLACKSTAR_WEBHOOK_SECRET"],
  ],
  ["flag on, all three valid", { FBM_BLACKSTAR_INTEGRATION: "1", ...VALID_PAIR, BLACKSTAR_OUTBOUND_SECRET: SECRET("o") }, []],
  ["flag on, per-partner keys required", { FBM_BLACKSTAR_INTEGRATION: "1", BLACKSTAR_REQUIRE_KEY_ID: "1", ...VALID_PAIR }, []],
  [
    "flag on, BLACKSTAR_REQUIRE_KEY_ID=0 keeps the global secret",
    { FBM_BLACKSTAR_INTEGRATION: "1", BLACKSTAR_REQUIRE_KEY_ID: "0", ...VALID_PAIR },
    ["BLACKSTAR_OUTBOUND_SECRET"],
  ],
  [
    "flag off, outbound pair with a placeholder secret (the reviewer's repro)",
    { FBM_BLACKSTAR_INTEGRATION: "0", BLACKSTAR_API_BASE: "https://b.example", BLACKSTAR_WEBHOOK_SECRET: "changeme" },
    ["BLACKSTAR_WEBHOOK_SECRET"],
  ],
  [
    "flag unset, a short secret alone",
    { BLACKSTAR_WEBHOOK_SECRET: "short" },
    ["BLACKSTAR_API_BASE", "BLACKSTAR_WEBHOOK_SECRET"],
  ],
  ["flag unset, the destination alone", { BLACKSTAR_API_BASE: "https://b.example" }, ["BLACKSTAR_WEBHOOK_SECRET"]],
  ["flag unset, a valid pair", { ...VALID_PAIR }, []],
  [
    "a banned literal long enough to pass the length rule",
    { ...VALID_PAIR, BLACKSTAR_WEBHOOK_SECRET: "dev-only-secret-change-in-production-32chars" },
    ["BLACKSTAR_WEBHOOK_SECRET"],
  ],
  ["http:// destination", { ...VALID_PAIR, BLACKSTAR_API_BASE: "http://blackstar.example" }, ["BLACKSTAR_API_BASE"]],
  ["destination with no scheme", { ...VALID_PAIR, BLACKSTAR_API_BASE: "blackstar.example" }, ["BLACKSTAR_API_BASE"]],
  ["destination with no host", { ...VALID_PAIR, BLACKSTAR_API_BASE: "https://" }, ["BLACKSTAR_API_BASE"]],
  ["destination with a space in the host", { ...VALID_PAIR, BLACKSTAR_API_BASE: "https://b c" }, ["BLACKSTAR_API_BASE"]],
  [
    "destination with a non-numeric port",
    { ...VALID_PAIR, BLACKSTAR_API_BASE: "https://b.example:notaport" },
    ["BLACKSTAR_API_BASE"],
  ],
  ["destination with a query", { ...VALID_PAIR, BLACKSTAR_API_BASE: "https://b.example?x=1" }, ["BLACKSTAR_API_BASE"]],
  ["https destination with a port and a path", { ...VALID_PAIR, BLACKSTAR_API_BASE: "https://b.example:8443/bridge/" }, []],
  [
    "placeholder destination",
    { ...VALID_PAIR, BLACKSTAR_API_BASE: "CHANGE_ME_https://api.blackstar.example" },
    ["BLACKSTAR_API_BASE"],
  ],
  [
    "flag on, short webhook secret and placeholder inbound secret",
    {
      FBM_BLACKSTAR_INTEGRATION: "1",
      BLACKSTAR_API_BASE: "https://api.blackstar.example",
      BLACKSTAR_WEBHOOK_SECRET: "too-short",
      BLACKSTAR_OUTBOUND_SECRET: `CHANGE_ME_${SECRET("o")}`,
    },
    ["BLACKSTAR_OUTBOUND_SECRET", "BLACKSTAR_WEBHOOK_SECRET"],
  ],
]

describe("config boot: the Blackstar bridge, and parity with the pre-deploy script", () => {
  it.each(CASES)("%s", (_name, extra, refusedKeys) => {
    const boot = bootGuard(extra)
    const script = predeployScript(extra)

    expect({ refused: boot.refused, keys: named(boot.message) }).toEqual({
      refused: refusedKeys.length > 0,
      keys: refusedKeys,
    })
    expect({ refused: script.refused, keys: named(script.message) }).toEqual({
      refused: refusedKeys.length > 0,
      keys: refusedKeys,
    })
    if (boot.refused) {
      expect(boot.message).toMatch(/^Blackstar bridge configuration is invalid in production: /)
    }
  })

  it("does not apply the Blackstar rules outside production", () => {
    const local: Extra = {
      FBM_BLACKSTAR_INTEGRATION: "1",
      BLACKSTAR_API_BASE: "http://localhost:4000",
      BLACKSTAR_WEBHOOK_SECRET: "dev",
    }
    expect(bootGuard(local).refused).toBe(true)
    expect(bootGuard(local, { ...BASE_PRODUCTION_ENV, NODE_ENV: "development" }).refused).toBe(false)
  })
})

describe("config boot: the guard runs where Medusa boots", () => {
  // Medusa's start path loads `src/api/middlewares.ts` through this loader
  // (@medusajs/framework/http ApiLoader). middlewares.ts reaches config.ts
  // through middlewares/seller-context-v1 -> shared/auth-helpers ->
  // shared/config, so a production boot with a bad Blackstar config fails
  // here, before the server listens. If that chain is ever cut, the first
  // case fails and the guard needs an explicit import in middlewares.ts.
  const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
  const API_DIR = path.resolve(__dirname, "../../api")

  async function scanApiUnder(extra: Extra): Promise<{ refused: boolean; message: string }> {
    // Workflow definitions register on a process-global manager; a second
    // scan would otherwise refuse them as duplicates before reaching config.
    WorkflowManager.getWorkflows().clear()
    const saved = process.env
    process.env = { ...saved, ...BASE_PRODUCTION_ENV, ...extra } as NodeJS.ProcessEnv
    try {
      let outcome = { refused: false, message: "" }
      await jest.isolateModulesAsync(async () => {
        const { MiddlewareFileLoader } = require(path.join(httpDir, "middleware-file-loader")) as {
          MiddlewareFileLoader: new () => { scanDir(dir: string): Promise<void> }
        }
        try {
          await new MiddlewareFileLoader().scanDir(API_DIR)
        } catch (e) {
          outcome = { refused: true, message: (e as Error).message }
        }
      })
      return outcome
    } finally {
      process.env = saved
    }
  }

  it("refuses to load the API with the flag off and a placeholder outbound secret", async () => {
    const outcome = await scanApiUnder({
      FBM_BLACKSTAR_INTEGRATION: "0",
      BLACKSTAR_API_BASE: "https://b.example",
      BLACKSTAR_WEBHOOK_SECRET: "changeme",
    })
    expect(outcome.refused).toBe(true)
    expect(outcome.message).toMatch(/Blackstar bridge configuration is invalid in production: BLACKSTAR_WEBHOOK_SECRET/)
  }, 120_000)

  it("loads the API with a valid production config", async () => {
    expect(await scanApiUnder({ ...VALID_PAIR })).toEqual({ refused: false, message: "" })
  }, 120_000)
})
